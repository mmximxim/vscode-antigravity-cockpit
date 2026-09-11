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
                'gemini-3.7-flash-tiered': {
                    model: 'MODEL_PLACEHOLDER_M301',
                    displayName: null,
                    quotaInfo: {
                        remainingFraction: 0.8393,
                        resetTime: '2026-09-03T18:00:00Z',
                    },
                },
                'gemini-3.6-flash-high': {
                    model: 'MODEL_PLACEHOLDER_M71',
                    displayName: 'Gemini 3.6 Flash (High)',
                    quotaInfo: {
                        remainingFraction: 0.8393,
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
                'MODEL_PLACEHOLDER_M71': 'group-flash',
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
                            label: 'Claude Sonnet 4.6 (Thinking)',
                            modelOrAlias: { model: 'MODEL_PLACEHOLDER_M35' },
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
});

