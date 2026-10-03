import { StatsAggregator } from './aggregator';
import { UsageRecord } from './types';

describe('StatsAggregator - Summary Cards and Today Usage', () => {
    const mockContext: any = {
        globalState: {
            get: jest.fn(),
            update: jest.fn(),
        },
    };

    it('should compute todayConsumed correctly for empty records', () => {
        const aggregator = new StatsAggregator(mockContext);
        const cards = (aggregator as any).computeSummaryCards([]);
        expect(cards.todayConsumed).toBe(0);
        expect(cards.totalConsumed).toBe(0);
        expect(cards.peakDailyConsumed).toBe(0);
    });

    it('should compute todayConsumed accurately for records matching today', () => {
        const aggregator = new StatsAggregator(mockContext);
        const now = Date.now();
        const yesterday = now - 24 * 60 * 60 * 1000;

        const records: UsageRecord[] = [
            {
                ts: now,
                model: 'gemini-2.5-pro',
                label: 'Gemini 2.5 Pro',
                consumed: 50000,
                remainingFraction: 0.8,
            },
            {
                ts: now - 1000,
                model: 'claude-3-5-sonnet',
                label: 'Claude 3.5 Sonnet',
                consumed: 30000,
                remainingFraction: 0.7,
            },
            {
                ts: yesterday,
                model: 'gemini-2.5-pro',
                label: 'Gemini 2.5 Pro',
                consumed: 120000,
                remainingFraction: 0.5,
            },
        ];

        const cards = (aggregator as any).computeSummaryCards(records);
        expect(cards.todayConsumed).toBe(80000);
        expect(cards.totalConsumed).toBe(200000);
        expect(cards.peakDailyConsumed).toBe(120000);
    });
});
