/**
 * Antigravity Cockpit - Stats Aggregator
 * Persists usage records and computes analytics for the stats dashboard
 * by reading directly from quota_history cache and deduplicating shared pools.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ModelQuotaInfo } from '../shared/types';
import {
    UsageRecord,
    StatsPayload,
    DailyModelStat,
    HeatmapCell,
    DonutEntry,
    StatsSummaryCards,
} from './types';
import { logger } from '../shared/log_service';
import { getCockpitToolsSharedDir } from '../shared/antigravity_paths';

function getHistoryRoot(): string {
    return path.join(getCockpitToolsSharedDir(), 'cache', 'quota_history');
}

// Palette for model families
const FAMILY_COLORS: Record<string, string> = {
    Claude: '#2f81f7',
    Gemini: '#3fb950',
    OpenAI: '#f78166',
    DeepSeek: '#d2a8ff',
};

const DEFAULT_COLORS = [
    '#2f81f7', '#3fb950', '#f78166', '#d2a8ff',
    '#ffa657', '#79c0ff', '#56d364', '#ff7b72',
];

interface QuotaHistoryPoint {
    timestamp: number;
    remainingPercentage: number;
    isReset?: boolean;
    isStart?: boolean;
}

interface QuotaHistoryModelRecord {
    modelId: string;
    label: string;
    points: QuotaHistoryPoint[];
}

interface QuotaHistoryFileRecord {
    email: string;
    updatedAt: number;
    models: Record<string, QuotaHistoryModelRecord>;
}

export class StatsAggregator {
    private context: vscode.ExtensionContext;
    private prevFractions: Map<string, number> = new Map();

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Called after each successful quota poll (for real-time delta tracking).
     */
    public appendFromModels(models: ModelQuotaInfo[]): void {
        if (!models || models.length === 0) {
            return;
        }
        for (const model of models) {
            if (model.remainingFraction !== undefined && model.remainingFraction !== null) {
                this.prevFractions.set(model.modelId, model.remainingFraction);
            }
        }
    }

    /**
     * Compute the full stats payload for a given range by reading quota_history asynchronously.
     */
    public async getStatsPayload(range: '7d' | '30d', filterEmail?: string): Promise<StatsPayload> {
        const records = await this.extractRecordsFromQuotaHistory(filterEmail);
        const rangeDays = range === '7d' ? 7 : 30;

        return {
            summaryCards: this.computeSummaryCards(records),
            heatmap: this.computeHeatmap(records),
            trendLines: this.computeTrendLines(records, rangeDays),
            donut: this.computeDonut(records, rangeDays),
            range,
            modelLabels: this.computeModelLabels(records),
        };
    }

    // ─────────────────────────────────────────────────────────────
    // Extraction from Quota History Cache
    // ─────────────────────────────────────────────────────────────

    private async extractRecordsFromQuotaHistory(filterEmail?: string): Promise<UsageRecord[]> {
        const historyFiles = await this.loadAllHistoryFiles(filterEmail);
        if (historyFiles.length === 0) {
            return [];
        }

        // Map: timestamp -> family -> max drop (in units)
        // Taking max per timestamp ensures that shared pools (e.g. g3-pro and g3-flash)
        // are only counted once per interval instead of duplicated 8 times!
        const timeDrops = new Map<number, Map<string, number>>();

        for (const historyRecord of historyFiles) {
            for (const [modelId, model] of Object.entries(historyRecord.models || {})) {
                const label = model.label || modelId;
                const family = this.resolveModelFamily(modelId, label);

                const points = model.points || [];
                for (let i = 1; i < points.length; i++) {
                    const p1 = points[i - 1];
                    const p2 = points[i];

                    // Check for consumption drop
                    if (
                        typeof p1.remainingPercentage === 'number' &&
                        typeof p2.remainingPercentage === 'number' &&
                        p2.remainingPercentage < p1.remainingPercentage &&
                        !p2.isReset &&
                        !p2.isStart
                    ) {
                        const dropPct = p1.remainingPercentage - p2.remainingPercentage;
                        // Filter out quota resets (anything over 50% drop in one interval)
                        if (dropPct > 0 && dropPct <= 50) {
                            // 1% quota drop ≈ 10,000 Tokens (100% full quota window ≈ 1,000,000 Tokens based on Antigravity reverse engineering)
                            const dropUnits = dropPct * 10000;
                            const ts = Math.floor(p2.timestamp / 120000) * 120000;

                            if (!timeDrops.has(ts)) {
                                timeDrops.set(ts, new Map<string, number>());
                            }
                            const entry = timeDrops.get(ts)!;
                            const current = entry.get(family) || 0;
                            entry.set(family, Math.max(current, Math.round(dropUnits)));
                        }
                    }
                }
            }
        }

        const usageRecords: UsageRecord[] = [];
        for (const [ts, drops] of timeDrops.entries()) {
            for (const [family, consumed] of drops.entries()) {
                if (consumed > 0) {
                    usageRecords.push({
                        ts,
                        model: family,
                        label: family,
                        consumed,
                        remainingFraction: 0,
                    });
                }
            }
        }

        usageRecords.sort((a, b) => a.ts - b.ts);
        return usageRecords;
    }

    private resolveModelFamily(modelId: string, label: string): string {
        const lowerId = (modelId || '').toLowerCase();
        const lowerLabel = (label || '').toLowerCase();

        if (lowerId.includes('claude') || lowerLabel.includes('claude')) {
            return 'Claude';
        }
        if (
            lowerId.includes('gemini') ||
            lowerId.startsWith('g3-') ||
            lowerLabel.includes('gemini')
        ) {
            return 'Gemini';
        }
        if (lowerId.includes('gpt') || lowerLabel.includes('gpt') || lowerLabel.includes('openai')) {
            return 'OpenAI';
        }
        if (lowerId.includes('deepseek') || lowerLabel.includes('deepseek')) {
            return 'DeepSeek';
        }

        return label || modelId;
    }

    private async loadAllHistoryFiles(filterEmail?: string): Promise<QuotaHistoryFileRecord[]> {
        const historyRoot = getHistoryRoot();
        try {
            try {
                await fs.promises.access(historyRoot);
            } catch {
                return [];
            }
            const dirEntries = await fs.promises.readdir(historyRoot);
            const files = dirEntries.filter(f => f.endsWith('.json'));
            const list: QuotaHistoryFileRecord[] = [];
            for (const file of files) {
                try {
                    const filePath = path.join(historyRoot, file);
                    const content = await fs.promises.readFile(filePath, 'utf8');
                    const parsed = JSON.parse(content) as QuotaHistoryFileRecord;
                    if (parsed && parsed.models) {
                        if (!filterEmail || filterEmail === 'all' || parsed.email === filterEmail) {
                            list.push(parsed);
                        }
                    }
                } catch (e) {
                    logger.warn(`[StatsAggregator] Error parsing history file ${file}: ${e}`);
                }
            }
            return list;
        } catch (err) {
            logger.warn(`[StatsAggregator] Failed to read history directory: ${err}`);
            return [];
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Metrics & Charts Calculation
    // ─────────────────────────────────────────────────────────────

    private toDateStr(ts: number): string {
        const d = new Date(ts);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    private computeSummaryCards(records: UsageRecord[]): StatsSummaryCards {
        if (records.length === 0) {
            return { totalConsumed: 0, peakDailyConsumed: 0, currentStreak: 0, longestStreak: 0 };
        }

        const totalConsumed = records.reduce((s, r) => s + r.consumed, 0);

        // Daily totals
        const dailyMap = new Map<string, number>();
        for (const r of records) {
            const d = this.toDateStr(r.ts);
            dailyMap.set(d, (dailyMap.get(d) ?? 0) + r.consumed);
        }

        const peakDailyConsumed = Math.max(...Array.from(dailyMap.values()));

        // Streak computation
        const { current, longest } = this.computeStreaks(Array.from(dailyMap.keys()));

        return {
            totalConsumed: Math.round(totalConsumed),
            peakDailyConsumed: Math.round(peakDailyConsumed),
            currentStreak: current,
            longestStreak: longest,
        };
    }

    private computeStreaks(activeDates: string[]): { current: number; longest: number } {
        if (activeDates.length === 0) {
            return { current: 0, longest: 0 };
        }

        const sorted = [...new Set(activeDates)].sort();
        let longest = 1;
        let current = 1;
        let runLen = 1;

        for (let i = 1; i < sorted.length; i++) {
            const prev = new Date(sorted[i - 1]);
            const curr = new Date(sorted[i]);
            const diff = (curr.getTime() - prev.getTime()) / 86_400_000;
            if (Math.abs(diff - 1) < 0.05) {
                runLen++;
                if (runLen > longest) {
                    longest = runLen;
                }
            } else {
                runLen = 1;
            }
        }

        // Check if streak extends to today or yesterday
        const today = this.toDateStr(Date.now());
        const yesterday = this.toDateStr(Date.now() - 86_400_000);
        const lastDate = sorted[sorted.length - 1];
        if (lastDate === today || lastDate === yesterday) {
            current = runLen;
        } else {
            current = 0;
        }

        return { current, longest };
    }

    private computeHeatmap(records: UsageRecord[]): HeatmapCell[] {
        // Last 365 days
        const cutoff = Date.now() - 365 * 86_400_000;
        const filtered = records.filter(r => r.ts >= cutoff);

        const dailyMap = new Map<string, number>();
        for (const r of filtered) {
            const d = this.toDateStr(r.ts);
            dailyMap.set(d, (dailyMap.get(d) ?? 0) + r.consumed);
        }

        // Build full 365-day array (fill 0 for missing days)
        const result: HeatmapCell[] = [];
        const now = Date.now();
        for (let i = 364; i >= 0; i--) {
            const date = this.toDateStr(now - i * 86_400_000);
            result.push({ date, value: Math.round(dailyMap.get(date) ?? 0) });
        }
        return result;
    }

    private computeTrendLines(records: UsageRecord[], days: number): DailyModelStat[] {
        const cutoff = Date.now() - days * 86_400_000;
        const filtered = records.filter(r => r.ts >= cutoff);

        // Map: date -> modelId -> consumed
        const map = new Map<string, Map<string, number>>();
        for (const r of filtered) {
            const d = this.toDateStr(r.ts);
            if (!map.has(d)) {
                map.set(d, new Map());
            }
            const m = map.get(d)!;
            m.set(r.model, (m.get(r.model) ?? 0) + r.consumed);
        }

        // Build full days array
        const result: DailyModelStat[] = [];
        const now = Date.now();
        for (let i = days - 1; i >= 0; i--) {
            const date = this.toDateStr(now - i * 86_400_000);
            const modelMap = map.get(date) ?? new Map();
            const models: Record<string, number> = {};
            for (const [modelId, consumed] of modelMap) {
                models[modelId] = Math.round(consumed);
            }
            result.push({ date, models });
        }
        return result;
    }

    private computeDonut(records: UsageRecord[], days: number): DonutEntry[] {
        const cutoff = Date.now() - days * 86_400_000;
        const filtered = records.filter(r => r.ts >= cutoff);

        // Aggregate by model family
        const modelMap = new Map<string, { label: string; consumed: number }>();
        for (const r of filtered) {
            const entry = modelMap.get(r.model) ?? { label: r.label, consumed: 0 };
            entry.consumed += r.consumed;
            modelMap.set(r.model, entry);
        }

        const total = Array.from(modelMap.values()).reduce((s, e) => s + e.consumed, 0);
        if (total === 0) {
            return [];
        }

        const entries: DonutEntry[] = [];
        let colorIdx = 0;
        for (const [modelId, entry] of modelMap) {
            const color = FAMILY_COLORS[modelId] || DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length];
            entries.push({
                modelId,
                label: entry.label,
                consumed: Math.round(entry.consumed),
                pct: Math.round((entry.consumed / total) * 1000) / 10,
                color,
            });
            colorIdx++;
        }

        // Sort by consumed descending
        entries.sort((a, b) => b.consumed - a.consumed);
        return entries;
    }

    private computeModelLabels(records: UsageRecord[]): Record<string, string> {
        const labels: Record<string, string> = {};
        for (const r of records) {
            if (r.model && r.label) {
                labels[r.model] = r.label;
            }
        }
        return labels;
    }
}
