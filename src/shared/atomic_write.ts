import * as fs from 'fs';
import * as path from 'path';
import { logger } from './log_service';

const pathQueues = new Map<string, Promise<void>>();

/**
 * Perform a resilient atomic write to a target file.
 * Features:
 * 1. Serialized per-file write queue to avoid race conditions.
 * 2. Guaranteed cleanup of temporary files in `finally`.
 * 3. Windows-friendly retry loop for transient EPERM/EBUSY/EACCES locks.
 * 4. Fallback to copyFile if rename is persistently blocked by file locks.
 */
export async function safeWriteFileAtomic(filePath: string, content: string | Buffer): Promise<void> {
    const normalizedPath = path.resolve(filePath);
    const prev = pathQueues.get(normalizedPath) ?? Promise.resolve();

    const current = prev
        .catch(() => {})
        .then(() => performAtomicWrite(normalizedPath, content));

    pathQueues.set(normalizedPath, current);

    try {
        await current;
    } finally {
        if (pathQueues.get(normalizedPath) === current) {
            pathQueues.delete(normalizedPath);
        }
    }
}

async function performAtomicWrite(targetPath: string, content: string | Buffer): Promise<void> {
    const dir = path.dirname(targetPath);
    await fs.promises.mkdir(dir, { recursive: true });

    const tempPath = `${targetPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;

    try {
        await fs.promises.writeFile(tempPath, content, 'utf8');
        await safeRenameWithFallback(tempPath, targetPath);
    } finally {
        // ALWAYS ensure temp file is cleaned up if it still exists
        try {
            await fs.promises.unlink(tempPath);
        } catch (err: any) {
            if (err?.code !== 'ENOENT') {
                logger.debug(`[AtomicWrite] Failed to cleanup temp file ${tempPath}: ${err?.message || err}`);
            }
        }
    }
}

async function safeRenameWithFallback(tempPath: string, targetPath: string): Promise<void> {
    const MAX_RETRIES = 5;
    const RETRY_DELAYS = [25, 50, 100, 200, 400];

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            await fs.promises.rename(tempPath, targetPath);
            return;
        } catch (error: any) {
            const isLockError =
                error?.code === 'EPERM' ||
                error?.code === 'EBUSY' ||
                error?.code === 'EACCES';

            if (!isLockError || attempt >= MAX_RETRIES) {
                // On Windows, if rename is blocked, fallback to copyFile (which overwrites cleanly)
                try {
                    await fs.promises.copyFile(tempPath, targetPath);
                    return;
                } catch (copyError) {
                    logger.warn(`[AtomicWrite] Both rename and copyFile failed for ${targetPath}: ${error?.message || error}`);
                    throw error;
                }
            }

            const delay = RETRY_DELAYS[attempt] || 100;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/**
 * Scan a directory and remove any orphaned temporary files (*.tmp).
 * @param dirPath Directory to scan
 * @param maxAgeMs Files older than this threshold will be deleted (defaults to 30 seconds)
 * @returns Number of deleted temporary files
 */
export async function cleanupOrphanedTmpFiles(dirPath: string, maxAgeMs: number = 30 * 1000): Promise<number> {
    try {
        await fs.promises.mkdir(dirPath, { recursive: true });
        const entries = await fs.promises.readdir(dirPath);
        const now = Date.now();
        let deleted = 0;

        for (const entry of entries) {
            if (!entry.endsWith('.tmp')) {
                continue;
            }
            const fullPath = path.join(dirPath, entry);
            try {
                const stat = await fs.promises.stat(fullPath);
                if (now - stat.mtimeMs >= maxAgeMs) {
                    await fs.promises.unlink(fullPath);
                    deleted++;
                }
            } catch {
                // File might have already been cleaned up by another operation
            }
        }
        return deleted;
    } catch {
        return 0;
    }
}

