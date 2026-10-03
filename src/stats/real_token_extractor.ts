/**
 * Antigravity Cockpit - Real Token Extractor
 * Parses local conversation SQLite databases (~/.gemini/antigravity/conversations/*.db)
 * to retrieve exact token usage metadata (input, output, reasoning, cache read/creation)
 * with mtime-based disk caching for sub-millisecond incremental reads.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { UsageRecord } from './types';
import { getSqlJs } from '../auto_trigger/local_auth_importer';
import { logger } from '../shared/log_service';

const CACHE_VERSION = 2;

type WireValue = number | Uint8Array;
type ProtobufFields = Map<number, WireValue[]>;

interface SqlStatement {
    step(): boolean;
    get(): unknown[];
    free(): void;
}

interface SqlDb {
    prepare(sql: string): SqlStatement;
    close(): void;
}

interface SqlJsInstance {
    Database: new (data: Buffer | Uint8Array) => SqlDb;
}

interface UsageMetadata {
    mid: number | null;
    input: number;
    out: number;
    cc: number;
    cr: number;
    reason: number;
    vis: number;
    resp: string | null;
    pmsg: string | null;
    msg: string | null;
}

interface DiskCacheEntry {
    m: number;
    s: number;
    days: Record<string, [number, number, number, number]>;
}

interface DiskCacheFile {
    v: number;
    files: Record<string, DiskCacheEntry>;
}

export interface RealTokenExtractionResult {
    records: UsageRecord[];
    apiCost: number;
    todayApiCost: number;
}

const MODEL_MAP = new Map<number, string>([
    [246, 'gemini-2.5-pro'],
    [312, 'gemini-2.5-flash'],
    [313, 'gemini-2.5-flash-thinking'],
    [329, 'gemini-2.5-flash-thinking'],
    [330, 'gemini-2.5-flash-lite'],
    [281, 'claude-4-sonnet'],
    [282, 'claude-4-sonnet'],
    [290, 'claude-4-opus'],
    [291, 'claude-4-opus'],
    [333, 'claude-4.5-sonnet'],
    [334, 'claude-4.5-sonnet'],
    [340, 'claude-4.5-haiku'],
    [341, 'claude-4.5-haiku'],
    [342, 'gpt-oss-120b'],
    [1318, 'gemini-3.8-flash-high'],
    [1319, 'gemini-3.8-flash-medium'],
    [1320, 'gemini-3.8-flash-low'],
    [1298, 'gemini-3.7-flash-high'],
    [1299, 'gemini-3.7-flash-medium'],
    [1300, 'gemini-3.7-flash-low'],
    [1071, 'gemini-3.6-flash-high'],
    [1072, 'gemini-3.6-flash-medium'],
    [1073, 'gemini-3.6-flash-low'],
]);

function readVarint(buf: Uint8Array, startIndex: number): [number, number] {
    let v = 0;
    let s = 0;
    let i = startIndex;
    for (;;) {
        const b = buf[i];
        v += (b & 127) * Math.pow(2, s);
        if (!(b & 128)) {
            return [v, i + 1];
        }
        s += 7;
        i++;
    }
}

function decodeFields(buf: Uint8Array): ProtobufFields {
    const out: ProtobufFields = new Map();
    let i = 0;
    const n = buf.length;
    while (i < n) {
        const [k, i2] = readVarint(buf, i);
        i = i2;
        const fn = k >>> 3;
        const wt = k & 7;
        if (wt === 0) {
            const [v, i3] = readVarint(buf, i);
            i = i3;
            let list = out.get(fn);
            if (!list) {
                list = [];
                out.set(fn, list);
            }
            list.push(v);
        } else if (wt === 2) {
            const [ln, i3] = readVarint(buf, i);
            i = i3;
            let list = out.get(fn);
            if (!list) {
                list = [];
                out.set(fn, list);
            }
            list.push(buf.slice(i, i + ln));
            i += ln;
        } else if (wt === 5) {
            i += 4;
        } else if (wt === 1) {
            i += 8;
        } else {
            throw new Error(`wt${wt}`);
        }
    }
    return out;
}

function getFirstBytes(f2: ProtobufFields, no: number): Uint8Array | null {
    const a = f2.get(no);
    for (const v of a || []) {
        if (v instanceof Uint8Array) {
            return v;
        }
    }
    return null;
}

function getAllBytes(f2: ProtobufFields, no: number): Uint8Array[] {
    const res: Uint8Array[] = [];
    for (const v of f2.get(no) || []) {
        if (v instanceof Uint8Array) {
            res.push(v);
        }
    }
    return res;
}

function getFirstNumber(f2: ProtobufFields, no: number): number | null {
    const a = f2.get(no);
    for (const v of a || []) {
        if (typeof v === 'number') {
            return v;
        }
    }
    return null;
}

function getFirstText(f2: ProtobufFields, nos: number[]): string | null {
    for (const no of nos) {
        for (const v of f2.get(no) || []) {
            if (v instanceof Uint8Array) {
                try {
                    const s = Buffer.from(v).toString('utf-8');
                    if (s && [...s].every(ch => ch.charCodeAt(0) >= 32 || ch === '\n' || ch === '\t')) {
                        return s;
                    }
                } catch {
                    // ignore decode error
                }
            }
        }
    }
    return null;
}

function mid2name(id: number): string {
    const mapped = MODEL_MAP.get(id);
    if (mapped) {
        return mapped;
    }
    if (id >= 1000) {
        return 'model_placeholder_m' + (id - 1000);
    }
    return 'antigravity-model-' + id;
}

function normModel(raw: string | null): string | null {
    if (!raw) {
        return null;
    }
    const t = String(raw).trim().toLowerCase();
    if (!t) {
        return null;
    }
    const m = t.match(/gemini 3\.(\d) flash \((high|medium|low)\)/);
    if (m) {
        return 'gemini-3.' + m[1] + '-flash-' + m[2];
    }
    return t.split('(')[0].trim().replace(/\s+/g, '-') || null;
}

function extractTimestamp(buf: Uint8Array): number | null {
    const f2 = decodeFields(buf);
    let sec = getFirstNumber(f2, 1);
    if (sec === null) {
        const inner = getFirstBytes(f2, 4);
        if (!inner) {
            return null;
        }
        const f3 = decodeFields(inner);
        sec = getFirstNumber(f3, 1);
        if (sec === null) {
            return null;
        }
    }
    if (sec <= 0 || sec > 4102444800) {
        return null;
    }
    return sec * 1000;
}

function parseUsage(blob: Uint8Array): UsageMetadata | null {
    const f2 = decodeFields(blob);
    const u: UsageMetadata = {
        mid: getFirstNumber(f2, 1),
        input: getFirstNumber(f2, 2) || 0,
        out: getFirstNumber(f2, 3) || 0,
        cc: getFirstNumber(f2, 4) || 0,
        cr: getFirstNumber(f2, 5) || 0,
        reason: getFirstNumber(f2, 9) || 0,
        vis: getFirstNumber(f2, 10) || 0,
        resp: getFirstText(f2, [11]),
        pmsg: getFirstText(f2, [12]),
        msg: getFirstText(f2, [7]),
    };
    if (u.input || u.out || u.cc || u.cr || u.reason || u.vis) {
        return u;
    }
    return null;
}

function getUsageIds(u: UsageMetadata): string[] {
    const k: string[] = [];
    if (u.resp) {
        k.push('response:' + u.resp);
    }
    if (u.pmsg) {
        k.push('provider:' + u.pmsg);
    }
    if (u.msg) {
        k.push('message:' + u.msg);
    }
    return k;
}

function rateOf(model?: string): { i: number; o: number; c: number } {
    const m = String(model || '').toLowerCase();
    if (m.includes('claude')) {
        return { i: 3.0, o: 15.0, c: 0.30 };
    }
    return { i: 0.75, o: 3.75, c: 0.075 };
}

let memoryDiskCache: Record<string, DiskCacheEntry> | null = null;
let lastSerializedCache = '';
let skipPersist = false;

export async function extractRealTokenRecords(): Promise<RealTokenExtractionResult> {
    const homeDir = os.homedir();
    const dir = path.join(homeDir, '.gemini', 'antigravity', 'conversations');
    const cacheFile = path.join(homeDir, '.antigravity_cockpit', 'real_tokens_cache.json');

    if (!memoryDiskCache) {
        try {
            if (fs.existsSync(cacheFile)) {
                const j = JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as DiskCacheFile;
                if (j && j.v === CACHE_VERSION && j.files) {
                    memoryDiskCache = j.files;
                }
            }
        } catch {
            // ignore cache read error
        }
        if (!memoryDiskCache) {
            memoryDiskCache = {};
        }
    }

    let files: string[] = [];
    try {
        if (fs.existsSync(dir)) {
            files = fs.readdirSync(dir).filter(f => f.endsWith('.db'));
        }
    } catch {
        return { records: [], apiCost: 0, todayApiCost: 0 };
    }

    if (files.length === 0) {
        return { records: [], apiCost: 0, todayApiCost: 0 };
    }

    // Check which files have changed
    const todo: Array<[string, string, number, number]> = [];
    for (const f of files) {
        const p = path.join(dir, f);
        try {
            const st = fs.statSync(p);
            const c = memoryDiskCache[f];
            if (c && c.m === st.mtimeMs && c.s === st.size) {
                continue;
            }
            todo.push([f, p, st.mtimeMs, st.size]);
        } catch {
            continue;
        }
    }

    if (todo.length > 0) {
        let sqlInstance: SqlJsInstance | null = null;
        try {
            sqlInstance = (await getSqlJs()) as SqlJsInstance;
        } catch (err) {
            logger.warn(`[RealTokenExtractor] Failed to initialize sql-wasm: ${err}`);
            throw err;
        }

        for (const [f, p, mtime, size] of todo) {
            const days: Record<string, [number, number, number, number]> = {};
            let db: SqlDb | null = null;
            try {
                db = new sqlInstance.Database(fs.readFileSync(p));
                const seen = new Set<string>();

                const bucket = (ts: number, model: string, i: number, o: number, cc: number, cr: number) => {
                    const d = new Date(ts);
                    d.setHours(0, 0, 0, 0);
                    const k = d.getTime() + '|' + model;
                    const a = days[k] || (days[k] = [0, 0, 0, 0]);
                    a[0] += i;
                    a[1] += o;
                    a[2] += cc;
                    a[3] += cr;
                };

                const add = (u: UsageMetadata | null, model: string, ts: number | null) => {
                    if (!u) {
                        return;
                    }
                    const keys = getUsageIds(u);
                    if (keys.some(k => seen.has(k))) {
                        return;
                    }
                    keys.forEach(k => seen.add(k));
                    bucket(ts || Date.now(), model, u.input, u.out, u.cc, u.cr);
                };

                const genRows: Uint8Array[] = [];
                const st1 = db.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx');
                while (st1.step()) {
                    genRows.push(st1.get()[1] as Uint8Array);
                }
                st1.free();

                const identityModel = new Map<string, string>();
                const genEvents: Array<[UsageMetadata, string, number | null]> = [];
                let genModel: string | null = null;

                for (const blob of genRows) {
                    if (!blob) {
                        continue;
                    }
                    try {
                        const root = decodeFields(blob);
                        const cm = getFirstBytes(root, 1);
                        if (!cm) {
                            continue;
                        }
                        const cf = decodeFields(cm);
                        let model = normModel(getFirstText(cf, [19, 21]));
                        const mid = getFirstNumber(cf, 3);
                        if (!model && mid) {
                            model = mid2name(mid);
                        }
                        if (model) {
                            genModel = model;
                        }
                        let ts: number | null = null;
                        const tb = getFirstBytes(cf, 9);
                        if (tb) {
                            ts = extractTimestamp(tb);
                        }
                        const blobs: Uint8Array[] = [];
                        const u4 = getFirstBytes(cf, 4);
                        if (u4) {
                            blobs.push(u4);
                        }
                        for (const rb of getAllBytes(cf, 17)) {
                            try {
                                const rf = decodeFields(rb);
                                const u2 = getFirstBytes(rf, 2);
                                if (u2) {
                                    blobs.push(u2);
                                }
                            } catch {
                                // ignore
                            }
                        }
                        for (const ub of blobs) {
                            try {
                                const u = parseUsage(ub);
                                if (!u) {
                                    continue;
                                }
                                const mdl = model || genModel || 'gemini-flash';
                                getUsageIds(u).forEach(k => {
                                    if (!identityModel.has(k)) {
                                        identityModel.set(k, mdl);
                                    }
                                });
                                genEvents.push([u, mdl, ts]);
                            } catch {
                                // ignore
                            }
                        }
                    } catch {
                        // ignore
                    }
                }

                const stepRows: Uint8Array[] = [];
                const st2 = db.prepare('SELECT idx, metadata FROM steps ORDER BY idx');
                while (st2.step()) {
                    stepRows.push(st2.get()[1] as Uint8Array);
                }
                st2.free();

                for (const meta of stepRows) {
                    if (!meta) {
                        continue;
                    }
                    try {
                        const f2 = decodeFields(meta);
                        let ts: number | null = null;
                        for (const tno of [8, 1]) {
                            const tb = getFirstBytes(f2, tno);
                            if (tb) {
                                ts = extractTimestamp(tb);
                                if (ts) {
                                    break;
                                }
                            }
                        }
                        let model: string | null = null;
                        const mi = getFirstBytes(f2, 24);
                        if (mi) {
                            try {
                                const mf = decodeFields(mi);
                                model = normModel(getFirstText(mf, [12, 8]));
                            } catch {
                                // ignore
                            }
                        }
                        const blobs: Uint8Array[] = [];
                        const u9 = getFirstBytes(f2, 9);
                        if (u9) {
                            blobs.push(u9);
                        }
                        for (const rb of getAllBytes(f2, 28)) {
                            try {
                                const rf = decodeFields(rb);
                                const u2 = getFirstBytes(rf, 2);
                                if (u2) {
                                    blobs.push(u2);
                                }
                            } catch {
                                // ignore
                            }
                        }
                        for (const ub of blobs) {
                            try {
                                const u = parseUsage(ub);
                                if (!u) {
                                    continue;
                                }
                                let mdl = model;
                                if (!mdl) {
                                    for (const k of getUsageIds(u)) {
                                        if (identityModel.has(k)) {
                                            mdl = identityModel.get(k)!;
                                            break;
                                        }
                                    }
                                }
                                add(u, mdl || 'gemini-flash', ts);
                            } catch {
                                // ignore
                            }
                        }
                    } catch {
                        // ignore
                    }
                }

                for (const [u, mdl, ts] of genEvents) {
                    add(u, mdl, ts);
                }
            } catch (err) {
                logger.warn(`[RealTokenExtractor] Error parsing DB file ${f}: ${err}`);
            } finally {
                if (db) {
                    try {
                        db.close();
                    } catch {
                        // ignore
                    }
                }
            }

            memoryDiskCache[f] = { m: mtime, s: size, days };
        }

        // Cleanup removed files
        const live = new Set(files);
        for (const k of Object.keys(memoryDiskCache)) {
            if (!live.has(k)) {
                delete memoryDiskCache[k];
            }
        }

        // Persist to disk
        try {
            const serialized = JSON.stringify({ v: CACHE_VERSION, files: memoryDiskCache });
            if (serialized.length > 5 * 1024 * 1024) {
                skipPersist = true;
            } else if (!skipPersist && lastSerializedCache !== serialized) {
                fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
                fs.writeFileSync(cacheFile, serialized);
                lastSerializedCache = serialized;
            }
        } catch {
            // ignore save error
        }
    }

    const merged = new Map<string, [number, number, number, number]>();
    for (const f of files) {
        const c = memoryDiskCache[f];
        if (!c) {
            continue;
        }
        for (const k in c.days) {
            const a = merged.get(k) || (merged.set(k, [0, 0, 0, 0]), merged.get(k)!);
            const b = c.days[k];
            a[0] += b[0];
            a[1] += b[1];
            a[2] += b[2];
            a[3] += b[3];
        }
    }

    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    const todayMs = todayDate.getTime();

    let apiCost = 0;
    let todayApiCost = 0;
    const records: UsageRecord[] = [];

    for (const [k, v] of merged) {
        const p2 = k.indexOf('|');
        const dayMs = Number(k.slice(0, p2));
        const model = k.slice(p2 + 1);
        const [i, o, cc, cr] = v;
        const tok = i + o + cc + cr;
        if (tok <= 0) {
            continue;
        }

        records.push({
            ts: dayMs,
            model,
            label: model,
            consumed: tok,
            remainingFraction: 0,
        });

        const r = rateOf(model);
        const cost = (i * r.i + o * r.o + cr * r.c + cc * r.i) / 1e6;
        apiCost += cost;
        if (dayMs === todayMs) {
            todayApiCost += cost;
        }
    }

    records.sort((a, b) => a.ts - b.ts);

    return {
        records,
        apiCost: Math.round(apiCost * 100) / 100,
        todayApiCost: Math.round(todayApiCost * 100) / 100,
    };
}
