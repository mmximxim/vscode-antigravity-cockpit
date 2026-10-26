import {
    AUTH_RECOMMENDED_MODEL_IDS,
    SELECTABLE_MODEL_KEYS,
    isSelectableModel,
} from '../shared/recommended_models';
import { ReactorCore } from './reactor';
import { ModelQuotaInfo, QuotaSnapshot } from '../shared/types';
import { configService } from '../shared/config_service';

describe('Gemini 3.8 Flash and Grouping Verification', () => {
    it('should include MODEL_PLACEHOLDER_M322 and gemini-3.8-flash-tiered in recommended and selectable keys', () => {
        expect(AUTH_RECOMMENDED_MODEL_IDS).toContain('MODEL_PLACEHOLDER_M322');
        expect(AUTH_RECOMMENDED_MODEL_IDS).toContain('gemini-3.8-flash-tiered');

        expect(SELECTABLE_MODEL_KEYS.has('MODEL_PLACEHOLDER_M322')).toBe(true);
        expect(SELECTABLE_MODEL_KEYS.has('gemini-3.8-flash-tiered')).toBe(true);

        expect(isSelectableModel('MODEL_PLACEHOLDER_M322')).toBe(true);
        expect(isSelectableModel('gemini-3.8-flash-tiered')).toBe(true);
        expect(isSelectableModel('other-key', 'Gemini 3.8 Flash')).toBe(true);
    });

    it('should correctly auto-group MODEL_PLACEHOLDER_M322 into Gemini Flash family', () => {
        const models: ModelQuotaInfo[] = [
            {
                label: 'Gemini 3.8 Flash',
                modelId: 'MODEL_PLACEHOLDER_M322',
                remainingFraction: 0.85,
                remainingPercentage: 85,
                isExhausted: false,
                resetTime: new Date(Date.now() + 3600000),
                resetTimeDisplay: '1h',
                timeUntilReset: 3600000,
                timeUntilResetFormatted: '1h',
                resetTimeValid: true,
            },
            {
                label: 'Gemini 3.7 Flash',
                modelId: 'MODEL_PLACEHOLDER_M301',
                remainingFraction: 0.85,
                remainingPercentage: 85,
                isExhausted: false,
                resetTime: new Date(Date.now() + 3600000),
                resetTimeDisplay: '1h',
                timeUntilReset: 3600000,
                timeUntilResetFormatted: '1h',
                resetTimeValid: true,
            },
            {
                label: 'Gemini 3.6 Flash (High)',
                modelId: 'MODEL_PLACEHOLDER_M71',
                remainingFraction: 0.85,
                remainingPercentage: 85,
                isExhausted: false,
                resetTime: new Date(Date.now() + 3600000),
                resetTimeDisplay: '1h',
                timeUntilReset: 3600000,
                timeUntilResetFormatted: '1h',
                resetTimeValid: true,
            },
        ];

        const grouping = ReactorCore.calculateSmartGrouping(models);
        expect(grouping.groupNames['MODEL_PLACEHOLDER_M322']).toBe('Gemini Flash');
        expect(grouping.groupNames['MODEL_PLACEHOLDER_M301']).toBe('Gemini Flash');
        expect(grouping.groupNames['MODEL_PLACEHOLDER_M71']).toBe('Gemini Flash');

        // All 3 share the same stable group ID
        const gid = grouping.groupMappings['MODEL_PLACEHOLDER_M322'];
        expect(gid).toBeDefined();
        expect(grouping.groupMappings['MODEL_PLACEHOLDER_M301']).toBe(gid);
        expect(grouping.groupMappings['MODEL_PLACEHOLDER_M71']).toBe(gid);
    });

    it('should include Gemini 4 Argon and Claude 5.5 in recommended and selectable keys', () => {
        // Gemini 4 Argon
        expect(AUTH_RECOMMENDED_MODEL_IDS).toContain('MODEL_PLACEHOLDER_M418');
        expect(AUTH_RECOMMENDED_MODEL_IDS).toContain('gemini-4-argon');
        expect(SELECTABLE_MODEL_KEYS.has('MODEL_PLACEHOLDER_M418')).toBe(true);
        expect(isSelectableModel('MODEL_PLACEHOLDER_M418')).toBe(true);
        expect(isSelectableModel('MODEL_PLACEHOLDER_M417')).toBe(true);
        expect(isSelectableModel('MODEL_PLACEHOLDER_M419')).toBe(true);
        expect(isSelectableModel('any-key', 'Gemini 4 Argon (Medium)')).toBe(true);

        // Claude 5.5
        expect(AUTH_RECOMMENDED_MODEL_IDS).toContain('MODEL_PLACEHOLDER_M401');
        expect(AUTH_RECOMMENDED_MODEL_IDS).toContain('MODEL_PLACEHOLDER_M404');
        expect(SELECTABLE_MODEL_KEYS.has('MODEL_PLACEHOLDER_M401')).toBe(true);
        expect(SELECTABLE_MODEL_KEYS.has('claude-opus-5-5-medium')).toBe(true);
        expect(isSelectableModel('MODEL_PLACEHOLDER_M401')).toBe(true);
        expect(isSelectableModel('MODEL_PLACEHOLDER_M404')).toBe(true);
        expect(isSelectableModel('any-key', 'Claude Opus 5.5 (Medium)')).toBe(true);
        expect(isSelectableModel('any-key', 'Claude Sonnet 5.5 (Medium)')).toBe(true);
    });

    it('should correctly auto-group Gemini 4 Argon into Gemini Argon family', () => {
        const models: ModelQuotaInfo[] = [
            {
                label: 'Gemini 4 Argon (Medium)',
                modelId: 'MODEL_PLACEHOLDER_M418',
                remainingFraction: 0.9,
                remainingPercentage: 90,
                isExhausted: false,
                resetTime: new Date(Date.now() + 3600000),
                resetTimeDisplay: '1h',
                timeUntilReset: 3600000,
                timeUntilResetFormatted: '1h',
                resetTimeValid: true,
            },
            {
                label: 'Gemini 4 Argon (High)',
                modelId: 'MODEL_PLACEHOLDER_M417',
                remainingFraction: 0.9,
                remainingPercentage: 90,
                isExhausted: false,
                resetTime: new Date(Date.now() + 3600000),
                resetTimeDisplay: '1h',
                timeUntilReset: 3600000,
                timeUntilResetFormatted: '1h',
                resetTimeValid: true,
            },
        ];

        const grouping = ReactorCore.calculateSmartGrouping(models);
        expect(grouping.groupNames['MODEL_PLACEHOLDER_M418']).toBe('Gemini Argon');
        expect(grouping.groupNames['MODEL_PLACEHOLDER_M417']).toBe('Gemini Argon');
        expect(grouping.groupMappings['MODEL_PLACEHOLDER_M418']).toBe(grouping.groupMappings['MODEL_PLACEHOLDER_M417']);
    });

    it('should correctly auto-group Claude 5.5 models and GPT-OSS into Claude family', () => {
        const models: ModelQuotaInfo[] = [
            {
                label: 'Claude Opus 5.5 (Medium)',
                modelId: 'MODEL_PLACEHOLDER_M401',
                remainingFraction: 1,
                remainingPercentage: 100,
                isExhausted: false,
                resetTime: new Date(Date.now() + 3600000),
                resetTimeDisplay: '1h',
                timeUntilReset: 3600000,
                timeUntilResetFormatted: '1h',
                resetTimeValid: true,
            },
            {
                label: 'Claude Sonnet 5.5 (Medium)',
                modelId: 'MODEL_PLACEHOLDER_M404',
                remainingFraction: 1,
                remainingPercentage: 100,
                isExhausted: false,
                resetTime: new Date(Date.now() + 3600000),
                resetTimeDisplay: '1h',
                timeUntilReset: 3600000,
                timeUntilResetFormatted: '1h',
                resetTimeValid: true,
            },
            {
                label: 'GPT-OSS 120B (Medium)',
                modelId: 'MODEL_OPENAI_GPT_OSS_120B_MEDIUM',
                remainingFraction: 1,
                remainingPercentage: 100,
                isExhausted: false,
                resetTime: new Date(Date.now() + 3600000),
                resetTimeDisplay: '1h',
                timeUntilReset: 3600000,
                timeUntilResetFormatted: '1h',
                resetTimeValid: true,
            },
        ];

        const grouping = ReactorCore.calculateSmartGrouping(models);
        expect(grouping.groupNames['MODEL_PLACEHOLDER_M401']).toBe('Claude');
        expect(grouping.groupNames['MODEL_PLACEHOLDER_M404']).toBe('Claude');
        expect(grouping.groupNames['MODEL_OPENAI_GPT_OSS_120B_MEDIUM']).toBe('Claude');
        expect(grouping.groupMappings['MODEL_PLACEHOLDER_M401']).toBe(grouping.groupMappings['MODEL_PLACEHOLDER_M404']);
        expect(grouping.groupMappings['MODEL_PLACEHOLDER_M401']).toBe(grouping.groupMappings['MODEL_OPENAI_GPT_OSS_120B_MEDIUM']);
    });

    it('should correctly parse authorized response containing gemini-3.8-flash-tiered', () => {
        const reactor = new ReactorCore();
        const mockAuthResponse = {
            models: {
                'gemini-3.8-flash-tiered': {
                    model: 'MODEL_PLACEHOLDER_M322',
                    displayName: null,
                    quotaInfo: {
                        remainingFraction: 0.8393,
                        resetTime: '2026-09-03T18:00:00Z',
                    },
                },
                'claude-opus-5-5-medium': {
                    model: 'MODEL_PLACEHOLDER_M401',
                    displayName: 'Claude Opus 5.5 (Medium)',
                    quotaInfo: {
                        remainingFraction: 1.0,
                        resetTime: '2026-09-03T18:00:00Z',
                    },
                },
                'tab_flash_lite_preview': {
                    model: 'MODEL_PLACEHOLDER_M19',
                    displayName: 'Flash Lite Preview',
                    quotaInfo: {
                        remainingFraction: 1.0,
                        resetTime: '2026-09-03T18:00:00Z',
                    },
                },
            },
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const models = (reactor as any).buildModelsFromAuthorizedResponse(mockAuthResponse);
        expect(models.length).toBeGreaterThanOrEqual(3);

        const m38 = models.find((m: ModelQuotaInfo) => m.modelId === 'MODEL_PLACEHOLDER_M322');
        expect(m38).toBeDefined();
        expect(m38?.label).toBe('Gemini 3.8 Flash');
        expect(m38?.remainingFraction).toBe(0.8393);

        // Verify that buildSnapshot keeps Gemini 3.8 Flash in the Gemini Flash group
        const spy = jest.spyOn(configService, 'getConfig').mockReturnValue({
            groupingEnabled: true,
            groupMappings: {
                'MODEL_PLACEHOLDER_M322': 'group-flash',
            },
            visibleModels: [],
            pinnedModels: [],
            pinnedGroups: [],
            groupOrder: [],
            quotaSource: 'authorized',
        } as any);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const snapshot = (reactor as any).buildSnapshot(models);
        expect(snapshot.groups).toBeDefined();
        const flashGroup = snapshot.groups?.find((g: any) => g.groupId === 'group-flash');
        expect(flashGroup).toBeDefined();
        const has38InGroup = flashGroup?.models.some((m: ModelQuotaInfo) => m.modelId === 'MODEL_PLACEHOLDER_M322');
        expect(has38InGroup).toBe(true);

        spy.mockRestore();
    });

    it('should not notify listeners when state value has not changed in configService', async () => {
        const mockMemento: any = {
            data: new Map<string, any>(),
            get(key: string) {
                return this.data.get(key);
            },
            update(key: string, value: any) {
                this.data.set(key, value);
                return Promise.resolve();
            },
        };

        const mockContext: any = {
            globalState: mockMemento,
            subscriptions: [],
        };

        await configService.initialize(mockContext);

        let listenerCallCount = 0;
        const disposable = configService.onConfigChange(() => {
            listenerCallCount++;
        });

        // First update with new mapping -> should notify
        await configService.updateGroupMappings({ 'model-1': 'group-1' });
        expect(listenerCallCount).toBe(1);

        // Second update with identical mapping -> should NOT notify (preventing infinite loops)
        await configService.updateGroupMappings({ 'model-1': 'group-1' });
        expect(listenerCallCount).toBe(1);

        disposable.dispose();
    });

    it('should correctly attach weekly limits to models and groups', () => {
        const reactor = new ReactorCore();
        const mockWeeklySummary = {
            response: {
                groups: [
                    {
                        displayName: 'Gemini Models',
                        buckets: [
                            {
                                bucketId: 'gemini-weekly',
                                displayName: 'Weekly Limit Remaining',
                                window: 'weekly',
                                remainingFraction: 0.28,
                                resetTime: '2026-09-11T12:00:00Z',
                                description: 'You have used some of your weekly limit',
                            },
                        ],
                    },
                    {
                        displayName: 'Claude and GPT models',
                        buckets: [
                            {
                                bucketId: '3p-weekly',
                                displayName: 'Weekly Limit Remaining',
                                window: 'weekly',
                                remainingFraction: 1.0,
                                resetTime: '2026-09-17T12:00:00Z',
                            },
                        ],
                    },
                ],
            },
        };

        const mockUserStatusResponse = {
            userStatus: {
                cascadeModelConfigData: {
                    clientModelConfigs: [
                        {
                            label: 'Gemini 3.8 Flash',
                            modelOrAlias: { model: 'MODEL_PLACEHOLDER_M318' },
                            quotaInfo: {
                                remainingFraction: 0.4,
                                resetTime: '2026-09-10T18:00:00Z',
                            },
                        },
                        {
                            label: 'Claude Sonnet 5.5',
                            modelOrAlias: { model: 'MODEL_PLACEHOLDER_M404' },
                            quotaInfo: {
                                remainingFraction: 0.9,
                                resetTime: '2026-09-10T18:00:00Z',
                            },
                        },
                    ],
                },
            },
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const snapshot = (reactor as any).decodeSignal(mockUserStatusResponse, mockWeeklySummary);
        expect(snapshot.models.length).toBeGreaterThanOrEqual(2);

        const geminiModel = snapshot.models.find((m: ModelQuotaInfo) => m.label.includes('Gemini 3.8'));
        expect(geminiModel?.weeklyLimit).toBeDefined();
        expect(geminiModel?.weeklyLimit?.remainingPercentage).toBeCloseTo(28);
        expect(geminiModel?.weeklyLimit?.description).toBe('You have used some of your weekly limit');

        const claudeModel = snapshot.models.find((m: ModelQuotaInfo) => m.label.includes('Claude'));
        expect(claudeModel?.weeklyLimit).toBeDefined();
        expect(claudeModel?.weeklyLimit?.remainingPercentage).toBeCloseTo(100);
    });

    it('should enrich snapshot models and groups using attachWeeklyLimitsToSnapshot', () => {
        const reactor = new ReactorCore();
        const mockWeeklySummary = {
            response: {
                groups: [
                    {
                        displayName: 'Gemini models',
                        buckets: [
                            {
                                bucketId: 'gemini-weekly',
                                displayName: 'Weekly Limit Remaining',
                                window: 'weekly',
                                remainingFraction: 0.56,
                                resetTime: '2026-09-17T12:00:00Z',
                            },
                        ],
                    },
                    {
                        displayName: 'Claude and GPT models',
                        buckets: [
                            {
                                bucketId: '3p-weekly',
                                displayName: 'Weekly Limit Remaining',
                                window: 'weekly',
                                remainingFraction: 0.95,
                                resetTime: '2026-09-17T12:00:00Z',
                            },
                        ],
                    },
                ],
            },
        };

        const snapshot: QuotaSnapshot = {
            timestamp: new Date(),
            isConnected: true,
            models: [
                {
                    label: 'Gemini 3.8 Flash',
                    modelId: 'gemini-3.8-flash',
                    isExhausted: false,
                    resetTime: new Date(),
                    resetTimeDisplay: '1h',
                    timeUntilReset: 3600000,
                    timeUntilResetFormatted: '1h',
                    resetTimeValid: true,
                },
                {
                    label: 'Claude Sonnet 4.6 (Thinking)',
                    modelId: 'claude-sonnet-4-6',
                    isExhausted: false,
                    resetTime: new Date(),
                    resetTimeDisplay: '5h',
                    timeUntilReset: 18000000,
                    timeUntilResetFormatted: '5h',
                    resetTimeValid: true,
                },
            ],
            groups: [
                {
                    groupId: 'group-gemini',
                    groupName: 'Gemini Flash',
                    isExhausted: false,
                    models: [
                        {
                            label: 'Gemini 3.8 Flash',
                            modelId: 'gemini-3.8-flash',
                            isExhausted: false,
                            resetTime: new Date(),
                            resetTimeDisplay: '1h',
                            timeUntilReset: 3600000,
                            timeUntilResetFormatted: '1h',
                            resetTimeValid: true,
                        },
                    ],
                    remainingPercentage: 56,
                    resetTime: new Date(),
                    resetTimeDisplay: '1h',
                    timeUntilResetFormatted: '1h',
                },
                {
                    groupId: 'group-claude',
                    groupName: 'Claude',
                    isExhausted: false,
                    models: [],
                    remainingPercentage: 100,
                    resetTime: new Date(),
                    resetTimeDisplay: '5h',
                    timeUntilResetFormatted: '5h',
                },
            ],
        };

        reactor.attachWeeklyLimitsToSnapshot(snapshot, mockWeeklySummary as any);

        expect(snapshot.models[0].weeklyLimit).toBeDefined();
        expect(snapshot.models[0].weeklyLimit?.remainingPercentage).toBeCloseTo(56);
        expect(snapshot.models[1].weeklyLimit).toBeDefined();
        expect(snapshot.models[1].weeklyLimit?.remainingPercentage).toBeCloseTo(95);

        // Group 0 resolved from model
        expect(snapshot.groups![0].weeklyLimit).toBeDefined();
        expect(snapshot.groups![0].weeklyLimit?.remainingPercentage).toBeCloseTo(56);

        // Group 1 resolved from groupName fallback ('Claude')
        expect(snapshot.groups![1].weeklyLimit).toBeDefined();
        expect(snapshot.groups![1].weeklyLimit?.remainingPercentage).toBeCloseTo(95);
    });

    test('should manage isEngaged, hasWeeklyLimit, and invoke localProcessScanner on demand', async () => {
        const reactor = new ReactorCore();
        expect(reactor.isEngaged).toBe(false);
        expect(reactor.hasWeeklyLimit).toBe(false);

        const mockWeeklyData = {
            response: {
                groups: [
                    {
                        displayName: 'Gemini Models',
                        buckets: [
                            {
                                bucketId: 'gemini-weekly',
                                window: 'weekly',
                                remainingFraction: 0.9,
                            },
                        ],
                    },
                ],
            },
        };

        (reactor as any).transmit = jest.fn().mockResolvedValue(mockWeeklyData);

        let scannerCalled = false;
        reactor.setLocalProcessScanner(async () => {
            scannerCalled = true;
            reactor.engage(12345, 'test-csrf-token');
            return true;
        });

        // Trigger fetchWeeklyQuotaSummary when not yet engaged
        const summary = await reactor.fetchWeeklyQuotaSummary();
        expect(scannerCalled).toBe(true);
        expect(reactor.isEngaged).toBe(true);
        expect(reactor.hasWeeklyLimit).toBe(true);
        expect(summary?.response?.groups?.length).toBe(1);

        // Test disconnection self-healing
        (reactor as any).transmit = jest.fn().mockRejectedValue(new Error('Connection Failed: ECONNREFUSED 127.0.0.1:12345'));
        await reactor.fetchWeeklyQuotaSummary(true);
        expect(reactor.isEngaged).toBe(false);
    });

    it('should exclude retired models and only keep active selectable models in IDE', () => {
        // Retired models should be completely excluded
        expect(isSelectableModel('gemini-3.7-flash')).toBe(false);
        expect(isSelectableModel('gemini-3.7-flash-tiered')).toBe(false);
        expect(isSelectableModel('MODEL_PLACEHOLDER_M301')).toBe(false);
        expect(isSelectableModel('gemini-3.5-flash-lite')).toBe(false);
        expect(isSelectableModel('MODEL_PLACEHOLDER_M198')).toBe(false);
        expect(isSelectableModel('gemini-3.1-flash-image')).toBe(false);
        expect(isSelectableModel('MODEL_PLACEHOLDER_M21')).toBe(false);
        expect(isSelectableModel('gemini-3.1-flash-lite')).toBe(false);
        expect(isSelectableModel('MODEL_PLACEHOLDER_M50')).toBe(false);
        expect(isSelectableModel('gemini-3.6-flash-high')).toBe(false);
        expect(isSelectableModel('claude-sonnet-4-6')).toBe(false);

        // Active models in IDE should be included
        expect(isSelectableModel('gemini-4-argon')).toBe(true);
        expect(isSelectableModel('gemini-4-argon-medium')).toBe(true);
        expect(isSelectableModel('MODEL_PLACEHOLDER_M418')).toBe(true);
        expect(isSelectableModel('gemini-3.8-flash')).toBe(true);
        expect(isSelectableModel('gemini-3.8-flash-tiered')).toBe(true);
        expect(isSelectableModel('MODEL_PLACEHOLDER_M322')).toBe(true);
        expect(isSelectableModel('claude-opus-5-5-medium')).toBe(true);
        expect(isSelectableModel('claude-sonnet-5-5-medium')).toBe(true);
        expect(isSelectableModel('gpt-oss-120b-medium')).toBe(true);
        expect(isSelectableModel('MODEL_OPENAI_GPT_OSS_120B_MEDIUM')).toBe(true);
    });

    it('should decouple Gemini 4 Argon from Flash and assign independent weekly quota', () => {
        const reactor = new ReactorCore();
        const mockAuthData = {
            models: {
                'gemini-3.8-flash-tiered': {
                    model: 'MODEL_PLACEHOLDER_M322',
                    displayName: 'Gemini 3.8 Flash',
                    quotaInfo: {
                        remainingFraction: 0.65,
                        resetTime: '2026-10-26T14:00:00Z',
                    },
                },
            },
        };

        const mockWeeklyData = {
            response: {
                groups: [
                    {
                        displayName: 'Gemini Models',
                        buckets: [
                            {
                                bucketId: 'gemini-weekly',
                                window: 'weekly',
                                remainingFraction: 0.89,
                                resetTime: '2026-11-02T14:00:00Z',
                                timeUntilResetFormatted: '6d 20h',
                            },
                        ],
                    },
                    {
                        displayName: 'Gemini 4 Argon',
                        buckets: [
                            {
                                bucketId: 'argon-weekly',
                                window: 'weekly',
                                remainingFraction: 0.90,
                                resetTime: '2026-11-02T13:00:00Z',
                                timeUntilResetFormatted: '6d 19h',
                            },
                        ],
                    },
                ],
            },
        };

        const snapshot = reactor.buildAuthorizedSnapshotFromResponse(mockAuthData);
        reactor.attachWeeklyLimitsToSnapshot(snapshot, mockWeeklyData as any);

        const flashModel = snapshot.models.find(m => m.modelId === 'MODEL_PLACEHOLDER_M322');
        const argonModel = snapshot.models.find(m => m.modelId === 'MODEL_PLACEHOLDER_M418');

        expect(flashModel).toBeDefined();
        expect(argonModel).toBeDefined();

        // Flash retains its 5-hour quota and its own weekly quota (89%)
        expect(flashModel?.remainingPercentage).toBeCloseTo(65);
        expect(flashModel?.weeklyLimit?.remainingPercentage).toBeCloseTo(89);

        // Argon has its own independent weekly quota (90%) and does NOT mirror Flash's 65%
        expect(argonModel?.remainingPercentage).toBeCloseTo(90);
        expect(argonModel?.weeklyLimit?.remainingPercentage).toBeCloseTo(90);

        // Check group separation
        const flashGroup = snapshot.groups?.find(g => g.groupName.includes('Flash') || g.groupId.includes('flash'));
        const argonGroup = snapshot.groups?.find(g => g.groupName.includes('Argon') || g.groupId.includes('argon'));

        if (flashGroup) {
            expect(flashGroup.remainingPercentage).toBeCloseTo(65);
            expect(flashGroup.weeklyLimit?.remainingPercentage).toBeCloseTo(89);
        }
        if (argonGroup) {
            expect(argonGroup.remainingPercentage).toBeCloseTo(90);
            expect(argonGroup.weeklyLimit?.remainingPercentage).toBeCloseTo(90);
        }
    });
});

