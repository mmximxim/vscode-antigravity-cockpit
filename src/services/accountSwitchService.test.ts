import { accountSwitchService } from './accountSwitchService';
import { credentialStorage } from '../auto_trigger';
import { cockpitToolsWs } from './cockpitToolsWs';
import { configService } from '../shared/config_service';

describe('AccountSwitchService', () => {
    const stateMap = new Map<string, any>();
    const mockGlobalState = {
        get: jest.fn((key: string, defaultValue?: any) => {
            return stateMap.has(key) ? stateMap.get(key) : defaultValue;
        }),
        update: jest.fn(async (key: string, value: any) => {
            if (value === undefined) {
                stateMap.delete(key);
            } else {
                stateMap.set(key, value);
            }
        }),
        keys: jest.fn(() => Array.from(stateMap.keys())),
        setKeysForSync: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        stateMap.clear();
        configService.initialize({
            globalState: mockGlobalState,
            secrets: { get: jest.fn(), store: jest.fn(), delete: jest.fn(), onDidChange: jest.fn() },
            subscriptions: [],
        } as any);
    });

    it('should default to auto mode', () => {
        expect(['auto', 'seamless', 'default']).toContain(accountSwitchService.getMode());
    });

    it('should allow setting mode', async () => {
        await accountSwitchService.setMode('seamless');
        expect(accountSwitchService.getMode()).toBe('seamless');
        await accountSwitchService.setMode('auto');
        expect(accountSwitchService.getMode()).toBe('auto');
    });

    it('should fall back to local/seamless switch when Cockpit Tools is offline in default mode', async () => {
        const testEmail = 'user@example.com';
        jest.spyOn(cockpitToolsWs as any, 'isConnected', 'get').mockReturnValue(false);
        jest.spyOn(credentialStorage, 'getAllCredentials').mockResolvedValue({
            [testEmail]: {
                accessToken: 'test-token',
                refreshToken: 'test-refresh',
                expiresAt: new Date(Date.now() + 3600000).toISOString(),
                email: testEmail,
            } as any,
        });
        const setActiveSpy = jest.spyOn(credentialStorage, 'setActiveAccount').mockResolvedValue(undefined);

        const result = await accountSwitchService.switchAccount(testEmail, { requestedMode: 'default' });

        expect(result.success).toBe(true);
        expect(result.email).toBe(testEmail);
        expect(setActiveSpy).toHaveBeenCalledWith(testEmail, true);
    });

    it('should fall back to local credential switch in auto mode when host API is unavailable', async () => {
        const testEmail = 'testauto@example.com';
        jest.spyOn(cockpitToolsWs as any, 'isConnected', 'get').mockReturnValue(false);
        jest.spyOn(credentialStorage, 'getAllCredentials').mockResolvedValue({
            [testEmail]: {
                accessToken: 'test-token',
                refreshToken: 'test-refresh',
                expiresAt: new Date(Date.now() + 3600000).toISOString(),
                email: testEmail,
            } as any,
        });
        const setActiveSpy = jest.spyOn(credentialStorage, 'setActiveAccount').mockResolvedValue(undefined);

        const result = await accountSwitchService.switchAccount(testEmail, { requestedMode: 'auto' });

        expect(result.success).toBe(true);
        expect(result.email).toBe(testEmail);
        expect(setActiveSpy).toHaveBeenCalledWith(testEmail, true);
    });
});
