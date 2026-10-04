import * as path from 'path';
import * as fs from 'fs';
import * as childProcess from 'child_process';
import { pathToFileURL } from 'url';
// 使用 sql.js 的 wasm 版本（需要 .wasm 文件）
import initSqlJs, { Database } from 'sql.js/dist/sql-wasm.js';
import { credentialStorage } from './credential_storage';
import { oauthService } from './oauth_service';
import { OAuthCredential } from './types';
import { logger } from '../shared/log_service';
import { getAntigravityStateDbPath, getAntigravityStateDbCandidates, getAntigravityUserDataDir } from '../shared/antigravity_paths';

const LEGACY_STATE_KEY = 'jetskiStateSync.agentManagerInitState';
const UNIFIED_STATE_KEY = 'antigravityUnifiedStateSync.oauthToken';

// sql.js 初始化缓存
let sqlJsPromise: ReturnType<typeof initSqlJs> | null = null;

export async function getSqlJs(): Promise<Awaited<ReturnType<typeof initSqlJs>>> {
    if (!sqlJsPromise) {
        sqlJsPromise = initSqlJs({
            locateFile: (file: string) => {
                const candidate1 = path.join(__dirname, file);
                if (fs.existsSync(candidate1)) {
                    return pathToFileURL(candidate1).href;
                }
                const candidate2 = path.join(__dirname, '..', '..', 'out', file);
                if (fs.existsSync(candidate2)) {
                    return pathToFileURL(candidate2).href;
                }
                const candidate3 = path.join(__dirname, '..', 'out', file);
                if (fs.existsSync(candidate3)) {
                    return pathToFileURL(candidate3).href;
                }
                try {
                    const candidate4 = require.resolve(`sql.js/dist/${file}`);
                    if (fs.existsSync(candidate4)) {
                        return pathToFileURL(candidate4).href;
                    }
                } catch {
                    // ignore
                }
                return pathToFileURL(candidate1).href;
            },
        }).catch((err: unknown) => {
            // 初始化失败时重置缓存，避免后续调用永远使用已失败的 Promise
            sqlJsPromise = null;
            throw err;
        });
    }
    return sqlJsPromise;
}

interface LocalTokenInfo {
    accessToken?: string;
    refreshToken?: string;
    tokenType?: string;
    expirySeconds?: number;
    email?: string;
}

interface PendingLocalCredential {
    credential: OAuthCredential;
    createdAt: number;
}

const PENDING_CREDENTIAL_TTL_MS = 2 * 60 * 1000;
let pendingLocalCredential: PendingLocalCredential | null = null;

// 注意：state.vscdb 路径统一由 shared/antigravity_paths 提供，避免多处维护。

function extractStringFromRow(val: unknown): string {
    if (val === null || val === undefined) {
        return '';
    }
    if (typeof val === 'string') {
        return val.trim();
    }
    if (val instanceof Uint8Array || Buffer.isBuffer(val)) {
        return Buffer.from(val).toString('utf8').trim();
    }
    return String(val).trim();
}

async function readStateValuesByKeys(dbPath: string, keys: string[]): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    try {
        await fs.promises.access(dbPath);
    } catch {
        return results;
    }

    const SQL = await getSqlJs();
    const fileBuffer = await fs.promises.readFile(dbPath);
    let db: Database | null = null;

    try {
        db = new SQL.Database(fileBuffer);
        for (const key of keys) {
            try {
                const stmt = db.prepare('SELECT value FROM ItemTable WHERE key = ?');
                stmt.bind([key]);
                if (stmt.step()) {
                    const row = stmt.get();
                    stmt.free();
                    if (row && row[0] !== null && row[0] !== undefined) {
                        const str = extractStringFromRow(row[0]);
                        if (str.length > 0) {
                            results.set(key, str);
                        }
                    }
                } else {
                    stmt.free();
                }
            } catch {
                // ignore single key error
            }
        }
    } finally {
        if (db) {
            db.close();
        }
    }
    return results;
}

function readVarint(data: Buffer, offset: number): [number, number] {
    let result = 0;
    let shift = 0;
    let pos = offset;
    while (pos < data.length) {
        const byte = data[pos];
        result += (byte & 0x7f) * Math.pow(2, shift);
        pos += 1;
        if ((byte & 0x80) === 0) {
            return [result, pos];
        }
        shift += 7;
    }
    throw new Error('Incomplete varint');
}

function skipField(data: Buffer, offset: number, wireType: number): number {
    if (wireType === 0) {
        const [, newOffset] = readVarint(data, offset);
        return newOffset;
    }
    if (wireType === 1) {
        return offset + 8;
    }
    if (wireType === 2) {
        const [length, contentOffset] = readVarint(data, offset);
        return contentOffset + length;
    }
    if (wireType === 5) {
        return offset + 4;
    }
    throw new Error(`Unknown wire type: ${wireType}`);
}

function findFields(data: Buffer, targetField: number): Buffer[] {
    let offset = 0;
    const results: Buffer[] = [];
    while (offset < data.length) {
        let tag = 0;
        let newOffset = 0;
        try {
            [tag, newOffset] = readVarint(data, offset);
        } catch {
            break;
        }
        const wireType = tag & 7;
        const fieldNum = tag >> 3;
        if (fieldNum === targetField && wireType === 2) {
            const [length, contentOffset] = readVarint(data, newOffset);
            results.push(data.subarray(contentOffset, contentOffset + length));
            offset = contentOffset + length;
        } else {
            try {
                offset = skipField(data, newOffset, wireType);
            } catch {
                break;
            }
        }
    }
    return results;
}

function findField(data: Buffer, targetField: number): Buffer | undefined {
    return findFields(data, targetField)[0];
}

function extractEmailFromUserStatus(stateValue: string): string | null {
    try {
        const raw = Buffer.from(stateValue.trim(), 'base64');
        const inners = findFields(raw, 1);
        for (const inner of inners) {
            const sub2List = findFields(inner, 2);
            for (const sub2 of sub2List) {
                const sub2Str = sub2.toString('utf8');
                try {
                    const decoded = Buffer.from(sub2Str, 'base64').toString('utf8');
                    const match = decoded.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
                    if (match) {
                        return match[1];
                    }
                } catch {
                    // ignore
                }
                const matchDirect = sub2Str.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
                if (matchDirect) {
                    return matchDirect[1];
                }
            }
        }
        const rawText = raw.toString('utf8');
        const matchRaw = rawText.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        if (matchRaw) {
            return matchRaw[1];
        }
    } catch (e) {
        logger.debug(`[LocalAuth] Error extracting email from userStatus: ${e}`);
    }
    return null;
}

function parseTimestamp(data: Buffer): number | undefined {
    let offset = 0;
    while (offset < data.length) {
        const [tag, newOffset] = readVarint(data, offset);
        const wireType = tag & 7;
        const fieldNum = tag >> 3;
        offset = newOffset;
        if (fieldNum === 1 && wireType === 0) {
            const [seconds] = readVarint(data, offset);
            return seconds;
        }
        offset = skipField(data, offset, wireType);
    }
    return undefined;
}

function parseOAuthTokenInfo(data: Buffer): LocalTokenInfo {
    let offset = 0;
    const info: LocalTokenInfo = {};

    while (offset < data.length) {
        const [tag, newOffset] = readVarint(data, offset);
        const wireType = tag & 7;
        const fieldNum = tag >> 3;
        offset = newOffset;

        if (wireType === 2) {
            const [length, contentOffset] = readVarint(data, offset);
            const value = data.subarray(contentOffset, contentOffset + length);
            offset = contentOffset + length;

            if (fieldNum === 1) {
                info.accessToken = value.toString();
            } else if (fieldNum === 2) {
                info.tokenType = value.toString();
            } else if (fieldNum === 3) {
                info.refreshToken = value.toString();
            } else if (fieldNum === 4) {
                info.expirySeconds = parseTimestamp(value);
            }
            continue;
        }
        offset = skipField(data, offset, wireType);
    }

    return info;
}

function parseUnifiedOAuthTokenInfo(stateValue: string): LocalTokenInfo {
    const outerRaw = Buffer.from(stateValue.trim(), 'base64');
    const innerList = findFields(outerRaw, 1);
    if (innerList.length === 0) {
        throw new Error('Unified oauth outer field not found');
    }

    let targetInner: Buffer | undefined;
    for (const inner of innerList) {
        const sentinel = findField(inner, 1)?.toString();
        if (sentinel === 'oauthTokenInfoSentinelKey') {
            targetInner = inner;
            break;
        }
    }

    if (!targetInner) {
        for (const inner of innerList) {
            if (inner.includes('oauthTokenInfoSentinelKey')) {
                targetInner = inner;
                break;
            }
        }
    }

    if (!targetInner) {
        throw new Error('Unified oauth sentinel mismatch');
    }

    const inner2List = findFields(targetInner, 2);
    for (const inner2 of inner2List) {
        // Try field 1 as base64 string
        const sub1 = findField(inner2, 1);
        if (sub1) {
            const oauthInfoB64 = sub1.toString('utf8').trim();
            try {
                const oauthInfoRaw = Buffer.from(oauthInfoB64, 'base64');
                const info = parseOAuthTokenInfo(oauthInfoRaw);
                if (info.refreshToken || info.accessToken) {
                    return info;
                }
            } catch {
                // ignore
            }
        }
        // Try inner2 directly as raw protobuf
        try {
            const info = parseOAuthTokenInfo(inner2);
            if (info.refreshToken || info.accessToken) {
                return info;
            }
        } catch {
            // ignore
        }
    }

    throw new Error('Unified oauth info not found');
}

interface TokenSource {
    tokenInfo: LocalTokenInfo;
    mtimeMs: number;
    source: string;
}

function readWindowsGenericCredential(target: string): TokenSource | null {
    const psScript = `
$code = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class CR {
    [DllImport("Advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredRead(string t, int type, int reservedFlag, out IntPtr p);
    [DllImport("Advapi32.dll", EntryPoint = "CredFree")]
    public static extern void CredFree(IntPtr p);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct C {
        public int Flags; public int Type; public string TargetName; public string Comment;
        public long LastWritten; public int BlobSize; public IntPtr Blob;
        public int Persist; public int AttrCount; public IntPtr Attrs;
        public string TargetAlias; public string UserName;
    }
    public static string Read(string target) {
        IntPtr p;
        if (CredRead(target, 1, 0, out p)) {
            try {
                C c = (C)Marshal.PtrToStructure(p, typeof(C));
                if (c.Blob != IntPtr.Zero && c.BlobSize > 0) {
                    byte[] b = new byte[c.BlobSize];
                    Marshal.Copy(c.Blob, b, 0, c.BlobSize);
                    return c.LastWritten + ":" + Encoding.UTF8.GetString(b);
                }
            } finally { CredFree(p); }
        }
        return "";
    }
}
'@
Add-Type -TypeDefinition $code
[CR]::Read("${target}")
`;

    try {
        const out = childProcess.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
            encoding: 'utf8',
            timeout: 5000,
            windowsHide: true,
        }).trim();
        if (!out) {
            return null;
        }
        const idx = out.indexOf(':');
        if (idx === -1) {
            return null;
        }
        const fileTime = out.substring(0, idx);
        const jsonStr = out.substring(idx + 1);
        const fileTimeBigInt = BigInt(fileTime);
        const unixEpochBigInt = 116444736000000000n;
        const jsMs = Number((fileTimeBigInt - unixEpochBigInt) / 10000n);
        const data = JSON.parse(jsonStr);
        const refreshToken = data?.token?.refresh_token;
        if (refreshToken) {
            return {
                mtimeMs: jsMs,
                source: `WindowsCredential(${target})`,
                tokenInfo: {
                    accessToken: data?.token?.access_token,
                    refreshToken,
                    tokenType: data?.token?.token_type || 'Bearer',
                    expirySeconds: data?.token?.expiry
                        ? Math.floor(new Date(data.token.expiry).getTime() / 1000)
                        : undefined,
                },
            };
        }
    } catch (e) {
        logger.debug(`[LocalAuth] Failed reading Windows Credential Manager (${target}): ${e}`);
    }
    return null;
}

function readSystemCredential(): TokenSource | null {
    if (process.platform === 'win32') {
        const targets = ['gemini:antigravity', 'antigravity', 'google:antigravity'];
        for (const target of targets) {
            const res = readWindowsGenericCredential(target);
            if (res) {
                return res;
            }
        }
    } else if (process.platform === 'darwin') {
        const targets = ['gemini:antigravity', 'antigravity'];
        for (const target of targets) {
            try {
                const out = childProcess.execFileSync('security', ['find-generic-password', '-s', target, '-w'], {
                    encoding: 'utf8',
                    timeout: 3000,
                }).trim();
                if (out) {
                    const data = JSON.parse(out);
                    const refreshToken = data?.token?.refresh_token;
                    if (refreshToken) {
                        return {
                            mtimeMs: Date.now(),
                            source: `macOSKeychain(${target})`,
                            tokenInfo: {
                                accessToken: data?.token?.access_token,
                                refreshToken,
                                tokenType: data?.token?.token_type || 'Bearer',
                                expirySeconds: data?.token?.expiry
                                    ? Math.floor(new Date(data.token.expiry).getTime() / 1000)
                                    : undefined,
                            },
                        };
                    }
                }
            } catch {
                // ignore
            }
        }
    } else if (process.platform === 'linux') {
        const targets = ['gemini:antigravity', 'antigravity'];
        for (const target of targets) {
            try {
                const out = childProcess.execFileSync('secret-tool', ['lookup', 'service', target], {
                    encoding: 'utf8',
                    timeout: 3000,
                }).trim();
                if (out) {
                    const data = JSON.parse(out);
                    const refreshToken = data?.token?.refresh_token;
                    if (refreshToken) {
                        return {
                            mtimeMs: Date.now(),
                            source: `LinuxSecretService(${target})`,
                            tokenInfo: {
                                accessToken: data?.token?.access_token,
                                refreshToken,
                                tokenType: data?.token?.token_type || 'Bearer',
                                expirySeconds: data?.token?.expiry
                                    ? Math.floor(new Date(data.token.expiry).getTime() / 1000)
                                    : undefined,
                            },
                        };
                    }
                }
            } catch {
                // ignore
            }
        }
    }
    return null;
}

async function readLocalTokenInfo(): Promise<LocalTokenInfo> {
    const sources: TokenSource[] = [];

    // 1. 优先检测系统凭证管理器 (Windows Generic Credentials / macOS Keychain / Linux Secret Service)
    try {
        const sysCred = readSystemCredential();
        if (sysCred) {
            sources.push(sysCred);
        }
    } catch (err) {
        logger.debug(`[LocalAuth] readSystemCredential error: ${err}`);
    }

    // 2. 检测所有候选 SQLite 数据库
    const candidates = getAntigravityStateDbCandidates();
    for (const dbPath of candidates) {
        try {
            if (!fs.existsSync(dbPath)) {
                continue;
            }
            const stat = await fs.promises.stat(dbPath);
            const stateValues = await readStateValuesByKeys(dbPath, [
                UNIFIED_STATE_KEY,
                LEGACY_STATE_KEY,
                'antigravityAuthStatus',
                'antigravityUnifiedStateSync.userStatus',
            ]);

            const unifiedValue = stateValues.get(UNIFIED_STATE_KEY);
            const legacyValue = stateValues.get(LEGACY_STATE_KEY);

            let tokenInfo: LocalTokenInfo | null = null;
            if (unifiedValue) {
                try {
                    tokenInfo = parseUnifiedOAuthTokenInfo(unifiedValue);
                    if (!tokenInfo.refreshToken) {
                        tokenInfo = null;
                    }
                } catch (e) {
                    logger.debug(`[LocalAuth] Failed parsing unified token info from ${dbPath}: ${e}`);
                }
            }

            if (!tokenInfo && legacyValue) {
                try {
                    const raw = Buffer.from(legacyValue.trim(), 'base64');
                    const oauthField = findField(raw, 6);
                    if (oauthField) {
                        tokenInfo = parseOAuthTokenInfo(oauthField);
                        if (!tokenInfo.refreshToken) {
                            tokenInfo = null;
                        }
                    }
                } catch (e) {
                    logger.debug(`[LocalAuth] Failed parsing legacy token info from ${dbPath}: ${e}`);
                }
            }

            if (tokenInfo && tokenInfo.refreshToken) {
                let discoveredEmail: string | null = null;
                const authStatusVal = stateValues.get('antigravityAuthStatus');
                if (authStatusVal) {
                    try {
                        const parsed = JSON.parse(authStatusVal);
                        if (parsed && typeof parsed.email === 'string' && parsed.email.includes('@')) {
                            discoveredEmail = parsed.email;
                        }
                    } catch {
                        // ignore
                    }
                }
                if (!discoveredEmail) {
                    const userStatusVal = stateValues.get('antigravityUnifiedStateSync.userStatus');
                    if (userStatusVal) {
                        discoveredEmail = extractEmailFromUserStatus(userStatusVal);
                    }
                }

                if (discoveredEmail && !tokenInfo.email) {
                    tokenInfo.email = discoveredEmail;
                }
                sources.push({
                    tokenInfo,
                    mtimeMs: stat.mtimeMs,
                    source: `SQLite(${dbPath})`,
                });
            }
        } catch (err) {
            logger.debug(`[LocalAuth] Failed reading candidate ${dbPath}: ${err instanceof Error ? err.message : err}`);
        }
    }

    if (sources.length === 0) {
        throw new Error('No local authentication credentials found (checked System Credential Store and state.vscdb)');
    }

    // 按修改时间降序排序，最新写入的凭证源优先
    sources.sort((a, b) => b.mtimeMs - a.mtimeMs);

    logger.info(`[LocalAuth] Available token sources (${sources.length}): ${sources.map(s => `${s.source} [${new Date(s.mtimeMs).toISOString()}]`).join(', ')}`);
    logger.info(`[LocalAuth] Selected primary source: ${sources[0].source}`);

    return sources[0].tokenInfo;
}

async function loadCredentialFromStateDb(): Promise<OAuthCredential | null> {
    const tokenInfo = await readLocalTokenInfo();
    if (!tokenInfo.refreshToken) {
        logger.debug('[LocalAuth] No refresh token found in state.vscdb');
        return null;
    }

    const credential = await oauthService.buildCredentialFromRefreshToken(
        tokenInfo.refreshToken,
        tokenInfo.email,
    );

    if (!credential.email || !credential.accessToken) {
        logger.debug('[LocalAuth] Failed to build credential: missing email or accessToken');
        return null;
    }

    return credential;
}

export async function previewLocalCredential(
    fallbackEmail?: string,
): Promise<{ email: string; exists: boolean }> {
    const tokenInfo = await readLocalTokenInfo();
    const effectiveEmail = fallbackEmail || tokenInfo.email;

    if (!tokenInfo.refreshToken) {
        if (effectiveEmail) {
            const exists = await credentialStorage.hasAccount(effectiveEmail);
            return { email: effectiveEmail, exists };
        }
        throw new Error('refresh_token not found');
    }

    logger.info(`[LocalAuthImport] Found local refresh token (len=${tokenInfo.refreshToken.length})`);

    let credential: OAuthCredential | null = null;
    try {
        credential = await oauthService.buildCredentialFromRefreshToken(
            tokenInfo.refreshToken,
            effectiveEmail,
        );
    } catch (e) {
        logger.warn(`[LocalAuthImport] buildCredentialFromRefreshToken failed: ${e instanceof Error ? e.message : e}`);
        if (effectiveEmail) {
            const exists = await credentialStorage.hasAccount(effectiveEmail);
            return { email: effectiveEmail, exists };
        }
        throw e;
    }

    if (!credential?.email) {
        throw new Error('无法确定账号邮箱');
    }

    logger.info(`[LocalAuthImport] resolved account: ${credential.email}`);
    pendingLocalCredential = {
        credential,
        createdAt: Date.now(),
    };

    const exists = await credentialStorage.hasAccount(credential.email);
    return { email: credential.email, exists };
}

export async function commitLocalCredential(
    options: { overwrite?: boolean; fallbackEmail?: string } = {},
): Promise<{ email: string; existed: boolean }> {
    let credential: OAuthCredential | null = null;
    const now = Date.now();
    if (pendingLocalCredential && now - pendingLocalCredential.createdAt <= PENDING_CREDENTIAL_TTL_MS) {
        credential = pendingLocalCredential.credential;
    }
    pendingLocalCredential = null;

    if (!credential) {
        const tokenInfo = await readLocalTokenInfo();
        const effectiveFallback = options.fallbackEmail || tokenInfo.email;
        if (!tokenInfo.refreshToken) {
            throw new Error('refresh_token not found');
        }
        credential = await oauthService.buildCredentialFromRefreshToken(
            tokenInfo.refreshToken,
            effectiveFallback,
        );
    }

    if (!credential.email) {
        throw new Error('无法确定账号邮箱');
    }

    const existed = await credentialStorage.hasAccount(credential.email);
    if (existed && !options.overwrite) {
        throw new Error('Account already exists');
    }

    await credentialStorage.saveCredential(credential);
    await credentialStorage.clearAccountInvalid(credential.email);
    await credentialStorage.setActiveAccount(credential.email);

    return { email: credential.email, existed };
}

export async function importLocalCredential(fallbackEmail?: string): Promise<{ email: string }> {
    const result = await commitLocalCredential({ overwrite: true, fallbackEmail });
    return { email: result.email };
}

/**
 * 确保本地 Antigravity 账户已导入到 credentialStorage
 * 用于 local 配额模式下通过远端 API 获取配额数据
 * - 如果 credentialStorage 已有有效凭证，直接返回当前账户邮箱
 * - 如果没有，尝试从 state.vscdb 读取并保存到 credentialStorage
 * @returns 账户邮箱或 null
 */
export async function ensureLocalCredentialImported(
    options: { forceReload?: boolean } = {},
): Promise<{ email: string } | null> {
    if (options.forceReload) {
        logger.info('[LocalAuthDebug] Force reload: skip cached credential');
    }

    const instanceDir = getAntigravityUserDataDir();
    if (!options.forceReload && !instanceDir) {
        const hasValid = await credentialStorage.hasValidCredential();
        if (hasValid) {
            const activeEmail = await credentialStorage.getActiveAccount();
            if (activeEmail) {
                logger.debug(`[LocalAuth] Using existing credential: ${activeEmail}`);
                return { email: activeEmail };
            }
        }
    }

    try {
        const credential = await loadCredentialFromStateDb();
        if (!credential || !credential.email) {
            return null;
        }

        // 保存到 credentialStorage（自动导入）
        await credentialStorage.saveCredential(credential);
        logger.info(`[LocalAuth] resolved account: ${credential.email}`);
        logger.info(`[LocalAuth] Auto-imported credential for ${credential.email}`);
        return { email: credential.email };
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.debug(`[LocalAuth] Failed to import local credential: ${err.message}`);
        return null;
    }
}

export async function debugLocalCredentialImport(): Promise<{ email?: string; dbPath: string }> {
    logger.info('[LocalAuthDebug] Starting local credential debug...');
    const dbPath = getAntigravityStateDbPath();
    logger.info(`[LocalAuthDebug] Using state.vscdb: ${dbPath}`);
    logger.info(`[LocalAuthDebug] override user-data-dir: ${getAntigravityUserDataDir() ?? 'null'}`);
    const result = await ensureLocalCredentialImported({ forceReload: true });
    logger.info(`[LocalAuthDebug] Result: ${result?.email ?? 'null'}`);
    return { email: result?.email, dbPath };
}
