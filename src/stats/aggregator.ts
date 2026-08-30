/**
 * Antigravity Cockpit - Stats Aggregator
 * Persists usage records and computes analytics for the stats dashboard.
 */

import * as vscode from 'vscode';
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

// Max records to keep in storage (~6 months of 2-minute polls = ~130k; cap at 50k)
const MAX_RECORDS = 50_000;
const STORAGE_KEY = 'agCockpit.statsHistory';

// Model color palette (HSL rotation)
const MODEL_COLORS = [
    '#2f81f7', '#3fb950', '#f78166', '#d2a8ff',
    '#ffa657', '#79c0ff', '#56d364', '#ff7b72',
    '#bc8cff', '#ffb86c', '#58a6ff', '#7ee787',
];

export class StatsAggregator {
    private context: vscode.ExtensionContext;
    /** Previous model fractions for delta computation */
    private prevFractions: Map<string, number> = new Map();
    /** Latest seen model display labels */
    private latestLabels: Map<string, string> = new Map();

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Called after each successful quota poll.
     * Computes delta from previous poll and appends records.
     */
    public appendFromModels(models: ModelQuotaInfo[]): void {
        if (!models || models.length === 0) {return;}

        for (const model of models) {
            if (model.modelId && model.label) {
                this.latestLabels.set(model.modelId, model.label);
            }
        }

        const now = Date.now();
        const newRecords: UsageRecord[] = [];

        for (const model of models) {
            const fraction = model.remainingFraction;
            if (fraction === undefined || fraction === null) {continue;}


            const prev = this.prevFractions.get(model.modelId);
            this.prevFractions.set(model.modelId, fraction);

            if (prev === undefined) {continue;} // No previous value to delta against

            const delta = prev - fraction; // Positive = consumed
            if (delta <= 0) {continue;}      // No consumption or reset happened

            // Cap delta at 0.5 to avoid counting quota resets as consumption
            const consumed = Math.min(delta, 0.5) * 1000;
            if (consumed < 0.01) {continue;}

            newRecords.push({
                ts: now,
                model: model.modelId,
                label: model.label,
                consumed: Math.round(consumed * 10) / 10,
                remainingFraction: fraction,
            });
        }

        if (newRecords.length === 0) {return;}

        try {
            const existing = this.loadRecords();
            const merged = [...existing, ...newRecords];
            // Trim to MAX_RECORDS (keep newest)
            const trimmed = merged.length > MAX_RECORDS
                ? merged.slice(merged.length - MAX_RECORDS)
                : merged;
            this.context.globalState.update(STORAGE_KEY, trimmed);
        } catch (err) {
            logger.warn(`[StatsAggregator] Failed to persist records: ${err}`);
        }
    }

    /**
     * Compute the full stats payload for a given range.
     */
    public getStatsPayload(range: '7d' | '30d'): StatsPayload {
        const records = this.loadRecords();
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
    // Private helpers
    // ─────────────────────────────────────────────────────────────

    private loadRecords(): UsageRecord[] {
        try {
            return this.context.globalState.get<UsageRecord[]>(STORAGE_KEY, []);
        } catch {
            return [];
        }
    }

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

        const peakDailyConsumed = Math.max(...dailyMap.values());

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
        if (activeDates.length === 0) {return { current: 0, longest: 0 };}

        const sorted = [...new Set(activeDates)].sort();
        let longest = 1;
        let current = 1;
        let runLen = 1;

        for (let i = 1; i < sorted.length; i++) {
            const prev = new Date(sorted[i - 1]);
            const curr = new Date(sorted[i]);
            const diff = (curr.getTime() - prev.getTime()) / 86_400_000;
            if (Math.abs(diff - 1) < 0.01) {
                runLen++;
                if (runLen > longest) {longest = runLen;}
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
            if (!map.has(d)) {map.set(d, new Map());}
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

        // Aggregate by model
        const modelMap = new Map<string, { label: string; consumed: number }>();
        for (const r of filtered) {
            const entry = modelMap.get(r.model) ?? { label: r.label, consumed: 0 };
            entry.consumed += r.consumed;
            modelMap.set(r.model, entry);
        }

        const total = Array.from(modelMap.values()).reduce((s, e) => s + e.consumed, 0);
        if (total === 0) {return [];}

        const entries: DonutEntry[] = [];
        let colorIdx = 0;
        for (const [modelId, entry] of modelMap) {
            entries.push({
                modelId,
                label: entry.label,
                consumed: Math.round(entry.consumed),
                pct: Math.round((entry.consumed / total) * 1000) / 10,
                color: MODEL_COLORS[colorIdx % MODEL_COLORS.length],
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
        for (const [m, l] of this.latestLabels.entries()) {
            labels[m] = l;
        }
        return labels;
    }
}

