import * as vscode from 'vscode';
import { credentialStorage, oauthService } from '../auto_trigger';
import { configService } from '../shared/config_service';
import { logger } from '../shared/log_service';
import { getOfficialIdeVersion } from '../shared/official_host_version';
import { cockpitToolsLocal } from './cockpitToolsLocal';
import { cockpitToolsWs } from './cockpitToolsWs';

const ACCOUNT_SWITCH_MODE_STATE_KEY = 'accountSwitchMode';
const DEFAULT_SEAMLESS_TIMEOUT_MS = 8000;

export type AccountSwitchMode = 'default' | 'seamless';
export type AccountSwitchModeInput = AccountSwitchMode | 'auto';

export type AccountSwitchErrorCode =
    | 'tools_offline'
    | 'account_not_found'
    | 'switch_failed'
    | 'host_unavailable'
    | 'token_missing'
    | 'invalid_expiry'
    | 'unknown';

export interface AccountSwitchResult {
    success: boolean;
    mode: AccountSwitchMode;
    email?: string;
    message?: string;
    errorCode?: AccountSwitchErrorCode;
}

export interface AccountSwitchOptions {
    requestedMode?: AccountSwitchModeInput;
}

interface OAuthTokenInfoPayload {
    accessToken: string;
    refreshToken: string;
    expiryDateSeconds: number;
    tokenType: string;
    isGcpTos: boolean;
}

interface OAuthPreferencesApi {
    getOAuthTokenInfo?(): Promise<OAuthTokenInfoPayload | null> | Thenable<OAuthTokenInfoPayload | null>;
    setOAuthTokenInfo(tokenInfo: OAuthTokenInfoPayload | null): Promise<void> | Thenable<void>;
}

interface AntigravityUnifiedStateSyncApi {
    OAuthPreferences?: OAuthPreferencesApi;
}

interface AntigravityAuthApi extends OAuthPreferencesApi {}

interface AntigravityVsCodeApi {
    antigravityUnifiedStateSync?: AntigravityUnifiedStateSyncApi;
    antigravityAuth?: AntigravityAuthApi;
}

interface SeamlessApiSelection {
    tokenApi: OAuthPreferencesApi | null;
    apiName: 'OAuthPreferences' | 'antigravityAuth' | 'none';
    reason: string;
}

class AccountSwitchService {
    getMode(): AccountSwitchModeInput {
        const mode = configService.getStateValue<string>(ACCOUNT_SWITCH_MODE_STATE_KEY, 'auto');
        if (mode === 'seamlessLegacy') {
            return 'seamless';
        }
        if (mode === 'seamless' || mode === 'default' || mode === 'auto') {
            return mode;
        }
        return 'auto';
    }

    isSeamlessMode(mode?: AccountSwitchModeInput): boolean {
        const resolved = mode ?? this.getMode();
        if (resolved === 'seamless') {
            return true;
        }
        if (resolved === 'default') {
            return false;
        }
        const seamlessApi = this.selectSeamlessApi();
        return Boolean(seamlessApi.tokenApi && seamlessApi.apiName !== 'none') || !cockpitToolsWs.isConnected;
    }

    async setMode(mode: AccountSwitchModeInput): Promise<void> {
        await configService.setStateValue<AccountSwitchModeInput>(ACCOUNT_SWITCH_MODE_STATE_KEY, mode);
        logger.info(`[AccountSwitchService] Switch mode set to ${mode}`);
    }

    resolveRequestedMode(requestedMode?: AccountSwitchModeInput): AccountSwitchModeInput {
        if (requestedMode === 'default' || requestedMode === 'seamless' || requestedMode === 'auto') {
            return requestedMode;
        }
        return this.getMode();
    }

    async switchAccount(email: string, options?: AccountSwitchOptions): Promise<AccountSwitchResult> {
        const requested = options?.requestedMode ?? 'auto';
        const configured = this.getMode();
        const mode = requested === 'auto' ? configured : requested;

        logger.info(
            `[AccountSwitchService] Switching ${email} (requested=${requested}, configured=${configured}, effective=${mode})`,
        );

        if (mode === 'seamless') {
            return this.switchViaSeamless(email);
        }

        if (mode === 'default') {
            if (cockpitToolsWs.isConnected) {
                const defaultResult = await this.switchViaDefault(email);
                if (defaultResult.success) {
                    return defaultResult;
                }
                logger.warn(
                    `[AccountSwitchService] Cockpit Tools switch failed (${defaultResult.errorCode ?? 'unknown'}), auto-falling back to seamless: ${defaultResult.message}`,
                );
            } else {
                logger.info(
                    `[AccountSwitchService] Cockpit Tools offline, auto-falling back to seamless switch for ${email}`,
                );
            }
            return this.switchViaSeamless(email);
        }

        // 'auto' mode
        // 1. If host seamless API is available, prioritize seamless (instant, in-process)
        let seamlessFailedReason: string | undefined;
        const seamlessApi = this.selectSeamlessApi();
        if (seamlessApi.tokenApi && seamlessApi.apiName !== 'none') {
            logger.info(
                `[AccountSwitchService] Auto mode: host token API available (${seamlessApi.apiName}), using seamless switch`,
            );
            const seamlessResult = await this.switchViaSeamless(email);
            if (seamlessResult.success) {
                return seamlessResult;
            }
            seamlessFailedReason = seamlessResult.message;
            logger.warn(
                `[AccountSwitchService] Seamless switch failed in auto mode: ${seamlessResult.message}, trying fallback`,
            );
        }

        // 2. If Cockpit Tools is connected, try Cockpit Tools
        if (cockpitToolsWs.isConnected) {
            logger.info('[AccountSwitchService] Auto mode: Cockpit Tools connected, trying default switch');
            const defaultResult = await this.switchViaDefault(email);
            if (defaultResult.success) {
                return defaultResult;
            }
            logger.warn(
                `[AccountSwitchService] Cockpit Tools switch failed in auto mode: ${defaultResult.message}`,
            );
        }

        // 3. Fallback to local credential switch (or seamless if not yet attempted)
        if (seamlessFailedReason) {
            return this.switchViaLocalCredential(email, seamlessFailedReason);
        }
        return this.switchViaSeamless(email);
    }

    private async switchViaDefault(email: string): Promise<AccountSwitchResult> {
        try {
            if (!cockpitToolsWs.isConnected) {
                return {
                    success: false,
                    mode: 'default',
                    email,
                    errorCode: 'tools_offline',
                    message: 'Cockpit Tools 未运行或未连接',
                };
            }

            let accountId = cockpitToolsLocal.getAccountIdByEmail(email);
            if (!accountId) {
                try {
                    const wsAccounts = await cockpitToolsWs.getAccounts();
                    const target = email.trim().toLowerCase();
                    const matched = wsAccounts.accounts.find(
                        (a) => a.email.trim().toLowerCase() === target,
                    );
                    if (matched?.id) {
                        accountId = matched.id;
                    }
                } catch {
                    // ignore
                }
            }

            if (!accountId) {
                return {
                    success: false,
                    mode: 'default',
                    email,
                    errorCode: 'account_not_found',
                    message: '未找到该账号对应的 Tools ID',
                };
            }

            const result = await cockpitToolsWs.switchAccount(accountId);
            if (!result.success) {
                return {
                    success: false,
                    mode: 'default',
                    email,
                    errorCode: 'switch_failed',
                    message: result.message,
                };
            }

            await credentialStorage.setActiveAccount(email, true);
            return {
                success: true,
                mode: 'default',
                email,
            };
        } catch (error) {
            const err = error instanceof Error ? error.message : String(error);
            logger.warn(`[AccountSwitchService] Default switch failed: ${err}`);
            return {
                success: false,
                mode: 'default',
                email,
                errorCode: 'unknown',
                message: err,
            };
        }
    }

    private async switchViaSeamless(email: string): Promise<AccountSwitchResult> {
        const ideVersion = getOfficialIdeVersion();
        const selected = this.selectSeamlessApi();
        logger.info(
            `[AccountSwitchService] Seamless strategy: ideVersion=${ideVersion ?? 'unknown'}, selected=${selected.apiName}, reason=${selected.reason}`,
        );
        if (!selected.tokenApi || selected.apiName === 'none') {
            logger.warn(
                `[AccountSwitchService] Host seamless API unavailable (${selected.reason}), falling back to local credential switch`,
            );
            return this.switchViaLocalCredential(
                email,
                `宿主无感接口不可用（${selected.reason}），已切换为本地凭据模式`,
            );
        }
        return this.switchViaTokenApi(
            email,
            'seamless',
            selected.tokenApi,
            selected.apiName,
            selected.apiName === 'OAuthPreferences'
                ? '无感切号不可用：当前宿主不支持 OAuthPreferences.setOAuthTokenInfo，已切回本地模式。'
                : '无感切号不可用：当前宿主不支持 antigravityAuth.setOAuthTokenInfo，已切回本地模式。',
        );
    }

    private async switchViaLocalCredential(email: string, reasonMessage?: string): Promise<AccountSwitchResult> {
        const requestedEmail = email.trim();
        const resolvedEmail = await this.resolveCredentialEmail(requestedEmail);
        if (!resolvedEmail) {
            return {
                success: false,
                mode: 'seamless',
                email: requestedEmail,
                errorCode: 'account_not_found',
                message: '未找到该账号的本地凭据',
            };
        }

        await credentialStorage.setActiveAccount(resolvedEmail, true);
        logger.info(`[AccountSwitchService] Local credential switch success: ${resolvedEmail}`);
        return {
            success: true,
            mode: 'seamless',
            email: resolvedEmail,
            message: reasonMessage || `已切换激活账号为 ${resolvedEmail}`,
        };
    }

    private async switchViaTokenApi(
        email: string,
        mode: AccountSwitchMode,
        tokenApi: OAuthPreferencesApi | null,
        apiName: string,
        unavailableMessage: string,
    ): Promise<AccountSwitchResult> {
        const requestedEmail = email.trim();
        logger.info(`[AccountSwitchService] ${mode} switch start: requested=${requestedEmail}, api=${apiName}`);
        try {
            const resolvedEmail = await this.resolveCredentialEmail(requestedEmail);
            if (!resolvedEmail) {
                return {
                    success: false,
                    mode,
                    email: requestedEmail,
                    errorCode: 'account_not_found',
                    message: '未找到该账号的本地凭据',
                };
            }

            const activeBefore = await credentialStorage.getActiveAccount();
            logger.info(
                `[AccountSwitchService] Seamless target resolved: requested=${requestedEmail}, resolved=${resolvedEmail}, activeBefore=${activeBefore ?? 'none'}`,
            );

            const tokenStatus = await oauthService.getAccessTokenStatusForAccount(resolvedEmail);
            if (tokenStatus.state !== 'ok' || !tokenStatus.token) {
                const tokenMessage = this.buildSeamlessTokenErrorMessage(tokenStatus.state, tokenStatus.error);
                logger.warn(
                    `[AccountSwitchService] Seamless switch aborted for ${resolvedEmail}: tokenState=${tokenStatus.state}, error=${tokenStatus.error ?? 'none'}`,
                );
                return {
                    success: false,
                    mode,
                    email: resolvedEmail,
                    errorCode: tokenStatus.state === 'missing' ? 'token_missing' : 'switch_failed',
                    message: tokenMessage,
                };
            }

            const credential = await credentialStorage.getCredentialForAccount(resolvedEmail);
            if (!credential?.refreshToken) {
                return {
                    success: false,
                    mode,
                    email: resolvedEmail,
                    errorCode: 'token_missing',
                    message: '账号凭据不完整，缺少 refresh_token',
                };
            }

            const expiryMs = Date.parse(credential.expiresAt);
            if (Number.isNaN(expiryMs)) {
                return {
                    success: false,
                    mode,
                    email: resolvedEmail,
                    errorCode: 'invalid_expiry',
                    message: '账号 expiresAt 无效，无法进行无感切号',
                };
            }

            const accessToken = tokenStatus.token || credential.accessToken;
            if (!accessToken) {
                return {
                    success: false,
                    mode,
                    email: resolvedEmail,
                    errorCode: 'token_missing',
                    message: '账号凭据不完整，缺少 access_token',
                };
            }

            if (!tokenApi) {
                return {
                    success: false,
                    mode,
                    email: resolvedEmail,
                    errorCode: 'host_unavailable',
                    message: unavailableMessage,
                };
            }

            const tokenInfo: OAuthTokenInfoPayload = {
                accessToken,
                refreshToken: credential.refreshToken,
                expiryDateSeconds: Math.floor(expiryMs / 1000),
                tokenType: 'Bearer',
                isGcpTos: false,
            };

            await this.withTimeout(
                Promise.resolve(tokenApi.setOAuthTokenInfo(tokenInfo)),
                DEFAULT_SEAMLESS_TIMEOUT_MS,
                'setOAuthTokenInfo',
            );

            if (typeof tokenApi.getOAuthTokenInfo === 'function') {
                try {
                    const appliedToken = await this.withTimeout(
                        Promise.resolve(tokenApi.getOAuthTokenInfo()),
                        DEFAULT_SEAMLESS_TIMEOUT_MS,
                        'getOAuthTokenInfo',
                    );
                    logger.info(
                        `[AccountSwitchService] ${mode} host token updated for ${resolvedEmail}: tokenInHost=${appliedToken ? 'yes' : 'no'}, api=${apiName}`,
                    );
                } catch (readbackError) {
                    const err = readbackError instanceof Error ? readbackError.message : String(readbackError);
                    logger.warn(`[AccountSwitchService] ${mode} host token readback failed for ${resolvedEmail}: ${err}`);
                }
            }

            await credentialStorage.setActiveAccount(resolvedEmail, true);
            logger.info(
                `[AccountSwitchService] Seamless switch success: ${activeBefore ?? 'none'} -> ${resolvedEmail}`,
            );

            return {
                success: true,
                mode,
                email: resolvedEmail,
            };
        } catch (error) {
            const err = error instanceof Error ? error.message : String(error);
            logger.warn(`[AccountSwitchService] ${mode} switch failed: ${err}`);
            return {
                success: false,
                mode,
                email: requestedEmail,
                errorCode: 'unknown',
                message: err,
            };
        }
    }

    private buildSeamlessTokenErrorMessage(state: string, error?: string): string {
        switch (state) {
            case 'missing':
                return '未找到该账号的本地凭据，无法执行无感切号';
            case 'invalid_grant':
                return '该账号 refresh_token 已失效，请重新授权后再切换';
            case 'expired':
                return '该账号 access_token 已过期，请重新授权后再切换';
            case 'refresh_failed':
                return `刷新目标账号 access_token 失败：${error || '未知错误'}`;
            default:
                return error || '无感切号失败：目标账号 token 不可用';
        }
    }

    private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, stage: string): Promise<T> {
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error(`无感切号调用超时：${stage}`));
            }, timeoutMs);
        });

        try {
            return await Promise.race([promise, timeoutPromise]);
        } finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
    }

    private async resolveCredentialEmail(email: string): Promise<string | null> {
        const accounts = await credentialStorage.getAllCredentials();
        const target = email.trim().toLowerCase();
        const matched = Object.keys(accounts).find((item) => item.trim().toLowerCase() === target);
        return matched ?? null;
    }

    private getUnifiedOAuthPreferences(): OAuthPreferencesApi | null {
        const api = vscode as unknown as AntigravityVsCodeApi;
        const prefs = api.antigravityUnifiedStateSync?.OAuthPreferences;
        return prefs && typeof prefs.setOAuthTokenInfo === 'function' ? prefs : null;
    }

    private getLegacyAuthApi(): OAuthPreferencesApi | null {
        const api = vscode as unknown as AntigravityVsCodeApi;
        const auth = api.antigravityAuth;
        return auth && typeof auth.setOAuthTokenInfo === 'function' ? auth : null;
    }

    private selectSeamlessApi(): SeamlessApiSelection {
        const unified = this.getUnifiedOAuthPreferences();
        const legacy = this.getLegacyAuthApi();

        if (unified && !legacy) {
            return { tokenApi: unified, apiName: 'OAuthPreferences', reason: 'only-unified-api-available' };
        }
        if (!unified && legacy) {
            return { tokenApi: legacy, apiName: 'antigravityAuth', reason: 'only-legacy-api-available' };
        }
        if (unified && legacy) {
            return { tokenApi: unified, apiName: 'OAuthPreferences', reason: 'both-available-prefer-unified' };
        }
        return { tokenApi: null, apiName: 'none', reason: 'no-supported-api' };
    }
}

export const accountSwitchService = new AccountSwitchService();
