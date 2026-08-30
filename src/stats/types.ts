/**
 * Antigravity Cockpit - Stats Module Types
 * Data structures for usage history and analytics
 */

/** A single usage record stored per quota poll */
export interface UsageRecord {
    /** Unix timestamp (ms) of when this record was captured */
    ts: number;
    /** Model ID */
    model: string;
    /** Model display label */
    label: string;
    /** Consumed quota units this interval (estimated from remainingFraction delta × 1000) */
    consumed: number;
    /** Snapshot of remaining fraction at capture time (0-1) */
    remainingFraction: number;
}

/** Per-day, per-model token consumption */
export interface DailyModelStat {
    date: string;         // ISO date string YYYY-MM-DD
    models: Record<string, number>;  // modelId -> consumed units
}

/** Summary card data */
export interface StatsSummaryCards {
    totalConsumed: number;          // All-time cumulative consumed units
    peakDailyConsumed: number;      // Max consumed in a single day
    currentStreak: number;          // Current consecutive active days
    longestStreak: number;          // Historical longest streak
}

/** Heatmap cell */
export interface HeatmapCell {
    date: string;    // YYYY-MM-DD
    value: number;   // total consumed units that day
}

/** Donut chart segment */
export interface DonutEntry {
    modelId: string;
    label: string;
    consumed: number;
    pct: number;
    color: string;
}

/** Full stats payload sent to webview */
export interface StatsPayload {
    summaryCards: StatsSummaryCards;
    heatmap: HeatmapCell[];          // Last 365 days
    trendLines: DailyModelStat[];    // Last N days (7 or 30)
    donut: DonutEntry[];             // All-time or range
    range: '7d' | '30d';            // Selected range
}
