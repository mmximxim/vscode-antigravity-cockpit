import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { safeWriteFileAtomic, cleanupOrphanedTmpFiles } from './atomic_write';

describe('atomic_write', () => {
    let testDir: string;

    beforeEach(async () => {
        testDir = path.join(os.tmpdir(), `cockpit_atomic_test_${Date.now()}_${Math.random().toString(16).slice(2)}`);
        await fs.promises.mkdir(testDir, { recursive: true });
    });

    afterEach(async () => {
        try {
            await fs.promises.rm(testDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });

    it('should write file safely and leave zero .tmp files behind', async () => {
        const targetFile = path.join(testDir, 'data.json');
        const content = JSON.stringify({ hello: 'world', time: 12345 });

        await safeWriteFileAtomic(targetFile, content);

        const readBack = await fs.promises.readFile(targetFile, 'utf8');
        expect(readBack).toBe(content);

        const files = await fs.promises.readdir(testDir);
        expect(files.filter(f => f.endsWith('.tmp')).length).toBe(0);
        expect(files).toEqual(['data.json']);
    });

    it('should handle concurrent writes to the same file without data corruption or tmp leakage', async () => {
        const targetFile = path.join(testDir, 'concurrent.json');
        const writes = Array.from({ length: 10 }, (_, i) =>
            safeWriteFileAtomic(targetFile, JSON.stringify({ index: i })),
        );

        await Promise.all(writes);

        const readBack = await fs.promises.readFile(targetFile, 'utf8');
        const parsed = JSON.parse(readBack);
        expect(typeof parsed.index).toBe('number');

        const files = await fs.promises.readdir(testDir);
        const tmpFiles = files.filter(f => f.endsWith('.tmp'));
        expect(tmpFiles.length).toBe(0);
    });

    it('should clean up orphaned .tmp files correctly while leaving other files intact', async () => {
        const keepJson = path.join(testDir, 'keep.json');
        const oldTmp = path.join(testDir, 'old.tmp');
        const freshTmp = path.join(testDir, 'fresh.tmp');

        await fs.promises.writeFile(keepJson, '{}', 'utf8');
        await fs.promises.writeFile(oldTmp, 'temporary', 'utf8');
        await fs.promises.writeFile(freshTmp, 'temporary', 'utf8');

        // Set mtime of oldTmp to 1 hour ago
        const oneHourAgo = new Date(Date.now() - 3600 * 1000);
        await fs.promises.utimes(oldTmp, oneHourAgo, oneHourAgo);

        const deleted = await cleanupOrphanedTmpFiles(testDir, 60 * 1000);
        expect(deleted).toBe(1);

        const files = await fs.promises.readdir(testDir);
        expect(files).toContain('keep.json');
        expect(files).toContain('fresh.tmp');
        expect(files).not.toContain('old.tmp');
    });
});

