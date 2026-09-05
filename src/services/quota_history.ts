import { promises as fs } from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { QuotaSnapshot } from '../shared/types';
import { logger } from '../shared/log_service';
import { AUTH_RECOMMENDED_MODEL_IDS } from '../shared/recommended_models';
import { getCockpitToolsSharedDir } from '../shared/antigravity_paths';
import { safeWriteFileAtomic, cleanupOrphanedTmpFiles } from '../shared/atomic_write';

export interface QuotaHistoryPoint {
    timestamp: number;
    remainingPercentage: number;
    resetTime?: number;
    countdownSeconds?: number;
    isStart?: boolean;
    isReset?: boolean;
}

export interface QuotaHistoryModelRecord {
    modelId: string;
    label: string;
    points: QuotaHistoryPoint[];
    hasCountdownDropAt100?: boolean;
}

export interface QuotaHistoryRecord {
    email: string;
    updatedAt: number;
    models: Record<string, QuotaHistoryModelRecord>;
}

export interface QuotaHistoryModelOption {
    modelId: string;
    label: string;
}

export interface QuotaHistoryResult {
    email: string;
    rangeDays: number;
    modelId: string | null;
    models: QuotaHistoryModelOption[];
    points: QuotaHistoryPoint[];
}

const HISTORY_DAYS_LIMIT = 30;
const HISTORY_MAX_POINTS_PER_MODEL = 5000;
function getHistoryRoot(): string {
    return path.join(getCockpitToolsSharedDir(), 'cache', 'quota_history');
}
const RECOMMENDED_MODEL_ID_SET = new Set(AUTH_RECOMMENDED_MODEL_IDS);

type HistoryGroupMatchInput = {
    modelIdLower: string;
    labelText: string;
};

type HistoryGroupDefinition = {
    groupId: string;
    label: string;
    modelIds: string[];
    matcher: (input: HistoryGroupMatchInput) => boolean;
};

function normalizeModelMatchText(value: string | undefined): string {
    return (value || '')
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const isGeminiProTier = ({ modelIdLower, labelText }: HistoryGroupMatchInput): boolean =>
    /^gemini-\d+(?:\.\d+)?-pro-(high|low)(?:-|$)/.test(modelIdLower) ||
    /^gemini \d+(?:\.\d+)? pro(?: \((high|low)\)| (high|low))\b/.test(labelText);

const isGeminiFlash = ({ modelIdLower, labelText }: HistoryGroupMatchInput): boolean =>
    /^gemini-\d+(?:\.\d+)?-flash(?:-|$)/.test(modelIdLower) ||
    /^gemini \d+(?:\.\d+)? flash\b/.test(labelText);

const isGeminiImage = ({ modelIdLower, labelText }: HistoryGroupMatchInput): boolean =>
    /^gemini-\d+(?:\.\d+)?-pro-image(?:-|$)/.test(modelIdLower) ||
    /^gemini \d+(?:\.\d+)? pro image\b/.test(labelText);

const isClaudeFamily = ({ modelIdLower, labelText }: HistoryGroupMatchInput): boolean =>
    modelIdLower.startsWith('claude-') ||
    modelIdLower.startsWith('model_claude') ||
    labelText.startsWith('claude ');

const HISTORY_GROUPS: HistoryGroupDefinition[] = [
    {
        groupId: 'claude-4-5',
        label: 'Claude',
        modelIds: [
            'MODEL_PLACEHOLDER_M12',
            'MODEL_CLAUDE_4_5_SONNET',
            'MODEL_CLAUDE_4_5_SONNET_THINKING',
            'MODEL_PLACEHOLDER_M26',
            'MODEL_PLACEHOLDER_M35',
            'MODEL_OPENAI_GPT_OSS_120B_MEDIUM',
        ],
        matcher: isClaudeFamily,
    },
    {
        groupId: 'g3-pro',
        label: 'Gemini Pro',
        modelIds: [
            'MODEL_PLACEHOLDER_M7',
            'MODEL_PLACEHOLDER_M8',
            'MODEL_PLACEHOLDER_M36',
            'MODEL_PLACEHOLDER_M37',
        ],
        matcher: isGeminiProTier,
    },
    {
        groupId: 'g3-flash',
        label: 'Gemini Flash',
        modelIds: [
            'MODEL_PLACEHOLDER_M18',
            'MODEL_PLACEHOLDER_M322',
            'MODEL_PLACEHOLDER_M318',
            'MODEL_PLACEHOLDER_M301',
            'MODEL_PLACEHOLDER_M71',
            'MODEL_PLACEHOLDER_M72',
            'MODEL_PLACEHOLDER_M73',
            'MODEL_PLACEHOLDER_M196',
            'gemini-3.8-flash',
            'gemini-3.8-flash-tiered',
            'gemini-3.8-flash-high',
            'gemini-3.8-flash-medium',
            'gemini-3.8-flash-low',
            'gemini-3.7-flash',
            'gemini-3.7-flash-tiered',
            'gemini-3.7-flash-high',
            'gemini-3.7-flash-medium',
            'gemini-3.7-flash-low',
            'gemini-3.6-flash',
            'gemini-3.6-flash-tiered',
            'gemini-3.6-flash-high',
            'gemini-3.6-flash-medium',
            'gemini-3.6-flash-low',
        ],
        matcher: isGeminiFlash,
    },
    {
        groupId: 'g3-image',
        label: 'Gemini Image',
        modelIds: [
            'MODEL_PLACEHOLDER_M9',
        ],
        matcher: isGeminiImage,
    },
];

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

function isValidEmail(email?: string | null): email is string {
    return typeof email === 'string' && email.includes('@');
}

function hashEmail(email: string): string {
    return createHash('sha256').update(normalizeEmail(email)).digest('hex');
}

function getHistoryFilePath(email: string): string {
    return path.join(getHistoryRoot(), `${hashEmail(email)}.json`);
}

function normalizeRangeDays(rangeDays?: number): number {
    if (typeof rangeDays !== 'number' || !Number.isFinite(rangeDays) || rangeDays <= 0) {
        return 7;
    }
    if (rangeDays <= 1) {
        return 1;
    }
    if (rangeDays <= 7) {
        return 7;
    }
    return 30;
}

function normalizeCountdownSeconds(value: Date | undefined, now: number): number | undefined {
    if (!value) {
        return undefined;
    }
    const ms = value.getTime() - now;
    if (!Number.isFinite(ms)) {
        return undefined;
    }
    return Math.max(0, Math.round(ms / 1000));
}

function getCountdownDisplayMinutes(seconds?: number): number | null {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
        return null;
    }
    if (seconds <= 0) {
        return 0;
    }
    return Math.ceil(seconds / 60);
}

function extractRecommendedGroups(
    snapshot: QuotaSnapshot,
    now: number,
): Array<{
    groupId: string;
    label: string;
    remainingPercentage: number;
    resetTime?: number;
    countdownSeconds?: number;
}> {
    const sourceModels = snapshot.allModels && snapshot.allModels.length > 0
        ? snapshot.allModels
        : snapshot.models;

    const groups: Array<{
        groupId: string;
        label: string;
        remainingPercentage: number;
        resetTime?: number;
        countdownSeconds?: number;
    }> = [];

    for (const group of HISTORY_GROUPS) {
        const candidates = sourceModels.filter(model => {
            if (!model?.modelId) {
                return false;
            }
            const input: HistoryGroupMatchInput = {
                modelIdLower: model.modelId.toLowerCase(),
                labelText: normalizeModelMatchText(model.label || model.modelId),
            };
            const exactMatch = group.modelIds.includes(model.modelId);
            const prefixMatch = group.matcher(input);
            if (!exactMatch && !prefixMatch) {
                return false;
            }
            // 优先沿用推荐模型白名单，同时放行命中前缀/模式的新版本模型
            return RECOMMENDED_MODEL_ID_SET.has(model.modelId) || prefixMatch;
        });

        if (candidates.length === 0) {
            continue;
        }

        let selected = candidates[0];
        let selectedRemaining = typeof selected.remainingPercentage === 'number'
            ? selected.remainingPercentage
            : Number.POSITIVE_INFINITY;
        for (const model of candidates) {
            const remaining = typeof model.remainingPercentage === 'number'
                ? model.remainingPercentage
                : Number.POSITIVE_INFINITY;
            if (remaining < selectedRemaining) {
                selected = model;
                selectedRemaining = remaining;
            }
        }

        if (!Number.isFinite(selectedRemaining)) {
            continue;
        }

        const resetTimeMs = selected.resetTime?.getTime();
        groups.push({
            groupId: group.groupId,
            label: group.label,
            remainingPercentage: selectedRemaining,
            resetTime: Number.isFinite(resetTimeMs) ? resetTimeMs : undefined,
            countdownSeconds: normalizeCountdownSeconds(selected.resetTime, now),
        });
    }

    return groups;
}

type PointAction = 'add' | 'overwrite' | 'skip';

function resolvePointAction(
    last: QuotaHistoryPoint | undefined,
    next: QuotaHistoryPoint,
    record: QuotaHistoryModelRecord,
): { action: PointAction; isStart?: boolean; isReset?: boolean } {
    if (!last) {
        return { action: 'add' };
    }
    const lastPct = last.remainingPercentage;
    const nextPct = next.remainingPercentage;

    if (nextPct < 100) {
        record.hasCountdownDropAt100 = false;
        if (lastPct === 100 && nextPct < 100) {
            return { action: 'add', isStart: true };
        }
        if (lastPct === nextPct) {
            return { action: 'skip' };
        }
        if (nextPct > lastPct) {
            return { action: 'add', isReset: true };
        }
        return { action: 'add' };
    }

    if (lastPct < 100) {
        record.hasCountdownDropAt100 = false;
        return { action: 'add', isReset: true };
    }

    const lastDisplay = getCountdownDisplayMinutes(last.countdownSeconds);
    const nextDisplay = getCountdownDisplayMinutes(next.countdownSeconds);
    if (lastDisplay === null || nextDisplay === null) {
        return { action: 'overwrite' };
    }

    const delta = nextDisplay - lastDisplay;
    if (delta > 1) {
        record.hasCountdownDropAt100 = false;
        return { action: 'add', isReset: true };
    }
    if (delta < -2) {
        if (record.hasCountdownDropAt100) {
            return { action: 'overwrite' };
        }
        record.hasCountdownDropAt100 = true;
        return { action: 'add', isStart: true };
    }
    return { action: 'overwrite' };
}

function trimPoints(points: QuotaHistoryPoint[], now: number): QuotaHistoryPoint[] {
    const cutoff = now - HISTORY_DAYS_LIMIT * 24 * 60 * 60 * 1000;
    const filtered = points.filter(point => point.timestamp >= cutoff);
    if (filtered.length <= HISTORY_MAX_POINTS_PER_MODEL) {
        return filtered;
    }
    return filtered.slice(filtered.length - HISTORY_MAX_POINTS_PER_MODEL);
}

async function readHistory(email: string): Promise<QuotaHistoryRecord | null> {
    try {
        const content = await fs.readFile(getHistoryFilePath(email), 'utf8');
        const parsed = JSON.parse(content) as QuotaHistoryRecord;
        if (!parsed || !parsed.models || typeof parsed.models !== 'object') {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

async function writeHistory(record: QuotaHistoryRecord): Promise<void> {
    const filePath = getHistoryFilePath(record.email);
    await safeWriteFileAtomic(filePath, JSON.stringify(record, null, 2));
}

export async function clearHistory(email: string): Promise<boolean> {
    try {
        const filePath = getHistoryFilePath(email);
        try {
            await fs.unlink(filePath);
        } catch {
            // Ignore if file doesn't exist
        }
        await cleanupOrphanedTmpFiles(getHistoryRoot(), 0);
        return true;
    } catch {
        return false;
    }
}

export async function clearAllHistory(): Promise<boolean> {
    const historyRoot = getHistoryRoot();
    try {
        await fs.mkdir(historyRoot, { recursive: true });
        const files = await fs.readdir(historyRoot);
        await Promise.all(
            files
                .filter(file => file.endsWith('.json') || file.endsWith('.tmp'))
                .map(file => fs.unlink(path.join(historyRoot, file)).catch(() => {})),
        );
        return true;
    } catch {
        return false;
    }
}

export async function cleanQuotaHistoryTmpFiles(maxAgeMs: number = 30 * 1000): Promise<number> {
    return cleanupOrphanedTmpFiles(getHistoryRoot(), maxAgeMs);
}

function buildModelOptions(record: QuotaHistoryRecord): QuotaHistoryModelOption[] {
    const orderRank = new Map(HISTORY_GROUPS.map((group, index) => [group.groupId, index]));
    return Object.values(record.models || {})
        .map(model => ({
            modelId: model.modelId,
            label: model.label || model.modelId,
        }))
        .sort((a, b) => {
            const rankA = orderRank.get(a.modelId) ?? Number.MAX_SAFE_INTEGER;
            const rankB = orderRank.get(b.modelId) ?? Number.MAX_SAFE_INTEGER;
            if (rankA !== rankB) {
                return rankA - rankB;
            }
            return a.label.localeCompare(b.label);
        });
}

export async function recordQuotaHistory(email: string | null | undefined, snapshot: QuotaSnapshot): Promise<boolean> {
    if (!snapshot.isConnected) {
        return false;
    }
    if (!isValidEmail(email)) {
        return false;
    }

    const now = Date.now();
    const groups = extractRecommendedGroups(snapshot, now);
    if (groups.length === 0) {
        return false;
    }

    try {
        const normalizedEmail = normalizeEmail(email);
        const existing = await readHistory(normalizedEmail);
        const record: QuotaHistoryRecord = existing ?? {
            email: normalizedEmail,
            updatedAt: now,
            models: {},
        };

        let changed = false;

        for (const group of groups) {
            const modelRecord = record.models[group.groupId] ?? {
                modelId: group.groupId,
                label: group.label,
                points: [],
            };

            if (!record.models[group.groupId]) {
                record.models[group.groupId] = modelRecord;
                changed = true;
            }

            if (modelRecord.label !== group.label) {
                modelRecord.label = group.label;
                changed = true;
            }

            const nextPoint: QuotaHistoryPoint = {
                timestamp: now,
                remainingPercentage: group.remainingPercentage,
                resetTime: group.resetTime,
                countdownSeconds: group.countdownSeconds,
            };

            const lastPoint = modelRecord.points[modelRecord.points.length - 1];
            const decision = resolvePointAction(lastPoint, nextPoint, modelRecord);
            if (decision.action === 'skip') {
                continue;
            }
            if (decision.isStart) {
                nextPoint.isStart = true;
            }
            if (decision.isReset) {
                nextPoint.isReset = true;
            }
            if (decision.action === 'overwrite' && modelRecord.points.length > 0) {
                if (lastPoint?.isStart) {
                    nextPoint.isStart = true;
                }
                if (lastPoint?.isReset) {
                    nextPoint.isReset = true;
                }
                modelRecord.points[modelRecord.points.length - 1] = nextPoint;
            } else {
                modelRecord.points.push(nextPoint);
            }

            modelRecord.points = trimPoints(modelRecord.points, now);
            changed = true;
        }

        if (!changed) {
            return false;
        }

        record.updatedAt = now;
        await writeHistory(record);
        return true;
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.debug(`[QuotaHistory] Failed to record history for ${email}: ${err.message}`);
        return false;
    }
}

export async function getAllQuotaHistories(): Promise<QuotaHistoryRecord[]> {
    const historyRoot = getHistoryRoot();
    try {
        const files = await fs.readdir(historyRoot);
        const records: QuotaHistoryRecord[] = [];
        for (const file of files) {
            if (!file.endsWith('.json')) {
                continue;
            }
            try {
                const content = await fs.readFile(path.join(historyRoot, file), 'utf8');
                const parsed = JSON.parse(content) as QuotaHistoryRecord;
                if (parsed && parsed.models && typeof parsed.models === 'object') {
                    records.push(parsed);
                }
            } catch {
                // Ignore individual file parse errors
            }
        }
        return records;
    } catch {
        return [];
    }
}

export async function getQuotaHistory(
    email: string | null | undefined,
    rangeDays?: number,
    modelId?: string,
): Promise<QuotaHistoryResult | null> {
    const normalizedRange = normalizeRangeDays(rangeDays);

    if (email === 'all') {
        const allRecords = await getAllQuotaHistories();
        const modelMap = new Map<string, string>();
        for (const r of allRecords) {
            for (const [mId, mRec] of Object.entries(r.models || {})) {
                if (!modelMap.has(mId)) {
                    modelMap.set(mId, mRec.label || mId);
                }
            }
        }
        const models: QuotaHistoryModelOption[] = Array.from(modelMap.entries()).map(([mId, label]) => ({
            modelId: mId,
            label,
        }));
        models.sort((a, b) => a.label.localeCompare(b.label));

        const availableModelIds = new Set(models.map(model => model.modelId));
        const selectedModelId = modelId && availableModelIds.has(modelId)
            ? modelId
            : (models[0]?.modelId ?? null);

        let points: QuotaHistoryPoint[] = [];
        if (selectedModelId) {
            const now = Date.now();
            const cutoff = now - normalizedRange * 24 * 60 * 60 * 1000;
            const collected: QuotaHistoryPoint[] = [];
            for (const r of allRecords) {
                if (r.models[selectedModelId]) {
                    collected.push(...r.models[selectedModelId].points.filter(point => point.timestamp >= cutoff));
                }
            }
            points = collected.sort((a, b) => a.timestamp - b.timestamp);
        }

        return {
            email: 'all',
            rangeDays: normalizedRange,
            modelId: selectedModelId,
            models,
            points,
        };
    }

    if (!isValidEmail(email)) {
        return null;
    }
    const normalizedEmail = normalizeEmail(email);
    const record = await readHistory(normalizedEmail);

    if (!record) {
        return {
            email: normalizedEmail,
            rangeDays: normalizedRange,
            modelId: null,
            models: [],
            points: [],
        };
    }

    const models = buildModelOptions(record);
    const availableModelIds = new Set(models.map(model => model.modelId));
    const selectedModelId = modelId && availableModelIds.has(modelId)
        ? modelId
        : (models[0]?.modelId ?? null);

    let points: QuotaHistoryPoint[] = [];
    if (selectedModelId && record.models[selectedModelId]) {
        const now = Date.now();
        const cutoff = now - normalizedRange * 24 * 60 * 60 * 1000;
        points = record.models[selectedModelId].points
            .filter(point => point.timestamp >= cutoff)
            .sort((a, b) => a.timestamp - b.timestamp);
    }

    return {
        email: normalizedEmail,
        rangeDays: normalizedRange,
        modelId: selectedModelId,
        models,
        points,
    };
}
