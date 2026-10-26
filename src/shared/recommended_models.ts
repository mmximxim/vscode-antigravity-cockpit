export const AUTH_RECOMMENDED_LABELS = [
    'Gemini 4 Argon (High)',
    'Gemini 4 Argon (Medium)',
    'Gemini 4 Argon (Low)',
    'Gemini 4 Argon',
    'Gemini 3.8 Flash (High)',
    'Gemini 3.8 Flash (Medium)',
    'Gemini 3.8 Flash (Low)',
    'Gemini 3.8 Flash',
    'Claude Opus 5.5 (High)',
    'Claude Opus 5.5 (Medium)',
    'Claude Opus 5.5 (Low)',
    'Claude Opus 5.5',
    'Claude Sonnet 5.5 (High)',
    'Claude Sonnet 5.5 (Medium)',
    'Claude Sonnet 5.5 (Low)',
    'Claude Sonnet 5.5',
    'GPT-OSS 120B (Medium)',
    'Gemini 3.7 Flash (High)',
    'Gemini 3.7 Flash (Medium)',
    'Gemini 3.7 Flash (Low)',
    'Gemini 3.7 Flash',
    'Gemini 3.6 Flash (High)',
    'Gemini 3.6 Flash (Medium)',
    'Gemini 3.6 Flash (Low)',
    'Gemini 3.6 Flash',
    'Gemini 3.1 Pro (High)',
    'Gemini 3.1 Pro (Low)',
    'Gemini 3 Flash',
    'Claude Sonnet 4.6 (Thinking)',
    'Claude Opus 4.6 (Thinking)',
    'Gemini 3 Pro Image',
];

export const AUTH_RECOMMENDED_MODEL_IDS = [
    // Gemini 4 Argon
    'MODEL_PLACEHOLDER_M418', // Gemini 4 Argon (Medium)
    'MODEL_PLACEHOLDER_M417', // Gemini 4 Argon (High)
    'MODEL_PLACEHOLDER_M419', // Gemini 4 Argon (Low)
    'MODEL_PLACEHOLDER_M416', // Gemini 4 Argon (Low)
    'gemini-4-argon',
    'gemini-4-argon-tiered',
    'gemini-4-argon-high',
    'gemini-4-argon-medium',
    'gemini-4-argon-low',

    // Gemini 3.8 Flash
    'MODEL_PLACEHOLDER_M322', // Gemini 3.8 Flash (Tiered)
    'MODEL_PLACEHOLDER_M318', // Gemini 3.8 Flash (High)
    'MODEL_PLACEHOLDER_M319', // Gemini 3.8 Flash (Medium)
    'MODEL_PLACEHOLDER_M320', // Gemini 3.8 Flash (Low)
    'gemini-3.8-flash',
    'gemini-3.8-flash-tiered',
    'gemini-3.8-flash-high',
    'gemini-3.8-flash-medium',
    'gemini-3.8-flash-low',

    // Claude 5.5
    'MODEL_PLACEHOLDER_M401', // Claude Opus 5.5 (Medium)
    'MODEL_PLACEHOLDER_M402', // Claude Opus 5.5 (High)
    'MODEL_PLACEHOLDER_M400', // Claude Opus 5.5 (Low)
    'claude-opus-5-5',
    'claude-opus-5-5-high',
    'claude-opus-5-5-medium',
    'claude-opus-5-5-low',

    'MODEL_PLACEHOLDER_M404', // Claude Sonnet 5.5 (Medium)
    'MODEL_PLACEHOLDER_M405', // Claude Sonnet 5.5 (High)
    'MODEL_PLACEHOLDER_M403', // Claude Sonnet 5.5 (Low)
    'claude-sonnet-5-5',
    'claude-sonnet-5-5-high',
    'claude-sonnet-5-5-medium',
    'claude-sonnet-5-5-low',

    // GPT-OSS
    'MODEL_OPENAI_GPT_OSS_120B_MEDIUM',
    'gpt-oss-120b-medium',

    // Gemini 3.7 Flash
    'MODEL_PLACEHOLDER_M301', // Gemini 3.7 Flash
    'gemini-3.7-flash',
    'gemini-3.7-flash-tiered',
    'gemini-3.7-flash-high',
    'gemini-3.7-flash-medium',
    'gemini-3.7-flash-low',

    // Legacy / older models
    'MODEL_PLACEHOLDER_M71',  // Gemini 3.6 Flash (High)
    'MODEL_PLACEHOLDER_M72',  // Gemini 3.6 Flash (Medium)
    'MODEL_PLACEHOLDER_M73',  // Gemini 3.6 Flash (Low)
    'gemini-3.6-flash-high',
    'gemini-3.6-flash-medium',
    'gemini-3.6-flash-low',
    'gemini-3.6-flash-tiered',
    'MODEL_PLACEHOLDER_M196',
    'MODEL_PLACEHOLDER_M37', // Gemini 3.1 Pro (High)
    'MODEL_PLACEHOLDER_M36', // Gemini 3.1 Pro (Low)
    'MODEL_PLACEHOLDER_M18', // Gemini 3 Flash
    'MODEL_PLACEHOLDER_M35', // Claude Sonnet 4.6 (Thinking)
    'MODEL_PLACEHOLDER_M26', // Claude Opus 4.6 (Thinking)
    'MODEL_PLACEHOLDER_M9',  // Gemini 3 Pro Image
];

// Authorized 模式黑名单（不显示）
export const AUTH_MODEL_BLACKLIST_IDS = [
    'MODEL_CHAT_20706',
    'MODEL_CHAT_23310',
    'MODEL_GOOGLE_GEMINI_2_5_FLASH',
    'MODEL_GOOGLE_GEMINI_2_5_FLASH_THINKING',
    'MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE',
    'MODEL_GOOGLE_GEMINI_2_5_PRO',
    'MODEL_PLACEHOLDER_M19',
    'gemini-3.5-flash-high',
    'gemini-3.5-flash-medium',
    'gemini-3.5-flash-low',
    'gemini-3.5-flash-extra-low',
    'gemini-3-flash',
    'gemini-3.6-flash-tiered',
    'gemini-pro-agent',
    'gemini-3-flash-agent',
    'tab_flash_lite_preview',
    'tab_jump_flash_lite_preview',
    'chat_20706',
    'chat_23310',
    'MODEL_PLACEHOLDER_M18',
    'MODEL_PLACEHOLDER_M196',
    'MODEL_PLACEHOLDER_M9',
];

/**
 * 官方 Antigravity IDE 中当前可供用户选择的活跃模型集合
 * 排除已下线、内部或未分级的旧版模型（如 3.5 Flash 系列、3.1 Flash Lite、3.1 Flash Image 等）
 */
export const SELECTABLE_MODEL_KEYS = new Set([
    // Gemini 4 Argon
    'gemini-4-argon',
    'gemini-4-argon-tiered',
    'gemini-4-argon-high',
    'gemini-4-argon-medium',
    'gemini-4-argon-low',
    'MODEL_PLACEHOLDER_M416',
    'MODEL_PLACEHOLDER_M417',
    'MODEL_PLACEHOLDER_M418',
    'MODEL_PLACEHOLDER_M419',

    // Gemini 3.8 Flash
    'gemini-3.8-flash',
    'gemini-3.8-flash-tiered',
    'gemini-3.8-flash-high',
    'gemini-3.8-flash-medium',
    'gemini-3.8-flash-low',
    'MODEL_PLACEHOLDER_M318',
    'MODEL_PLACEHOLDER_M319',
    'MODEL_PLACEHOLDER_M320',
    'MODEL_PLACEHOLDER_M322',

    // Claude 5.5
    'claude-opus-5-5',
    'claude-opus-5-5-high',
    'claude-opus-5-5-medium',
    'claude-opus-5-5-low',
    'MODEL_PLACEHOLDER_M400',
    'MODEL_PLACEHOLDER_M401',
    'MODEL_PLACEHOLDER_M402',
    'claude-sonnet-5-5',
    'claude-sonnet-5-5-high',
    'claude-sonnet-5-5-medium',
    'claude-sonnet-5-5-low',
    'MODEL_PLACEHOLDER_M403',
    'MODEL_PLACEHOLDER_M404',
    'MODEL_PLACEHOLDER_M405',

    // Gemini 3.7 Flash
    'gemini-3.7-flash',
    'gemini-3.7-flash-tiered',
    'gemini-3.7-flash-high',
    'gemini-3.7-flash-medium',
    'gemini-3.7-flash-low',
    'MODEL_PLACEHOLDER_M301',

    // Gemini 3.6 Flash
    'gemini-3.6-flash-high',
    'gemini-3.6-flash-medium',
    'gemini-3.6-flash-low',
    'MODEL_PLACEHOLDER_M71',
    'MODEL_PLACEHOLDER_M72',
    'MODEL_PLACEHOLDER_M73',

    // Gemini 3.1 Pro
    'gemini-3.1-pro-high',
    'gemini-3.1-pro-low',
    'MODEL_PLACEHOLDER_M37',
    'MODEL_PLACEHOLDER_M36',

    // Claude 4.6
    'claude-sonnet-4-6',
    'claude-opus-4-6-thinking',
    'MODEL_PLACEHOLDER_M35',
    'MODEL_PLACEHOLDER_M26',

    // GPT-OSS
    'gpt-oss-120b-medium',
    'MODEL_OPENAI_GPT_OSS_120B_MEDIUM',

    // Gemini Flash submodels
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-3.1-flash-image',
    'MODEL_PLACEHOLDER_M198',
    'MODEL_PLACEHOLDER_M50',
    'MODEL_PLACEHOLDER_M21',
]);

export const SELECTABLE_MODEL_LABELS = new Set([
    'Gemini 4 Argon (High)',
    'Gemini 4 Argon (Medium)',
    'Gemini 4 Argon (Low)',
    'Gemini 4 Argon',
    'Gemini 3.8 Flash (High)',
    'Gemini 3.8 Flash (Medium)',
    'Gemini 3.8 Flash (Low)',
    'Gemini 3.8 Flash',
    'Gemini 3.5 Flash Lite',
    'Gemini 3.1 Flash Lite',
    'Gemini 3.1 Flash Image',
    'Claude Opus 5.5 (High)',
    'Claude Opus 5.5 (Medium)',
    'Claude Opus 5.5 (Low)',
    'Claude Opus 5.5',
    'Claude Sonnet 5.5 (High)',
    'Claude Sonnet 5.5 (Medium)',
    'Claude Sonnet 5.5 (Low)',
    'Claude Sonnet 5.5',
    'Gemini 3.7 Flash',
    'Gemini 3.7 Flash (High)',
    'Gemini 3.7 Flash (Medium)',
    'Gemini 3.7 Flash (Low)',
    'Gemini 3.6 Flash (High)',
    'Gemini 3.6 Flash (Medium)',
    'Gemini 3.6 Flash (Low)',
    'Gemini 3.1 Pro (High)',
    'Gemini 3.1 Pro (Low)',
    'Claude Sonnet 4.6 (Thinking)',
    'Claude Opus 4.6 (Thinking)',
    'GPT-OSS 120B (Medium)',
]);

export function isSelectableModel(modelId: string, label?: string): boolean {
    if (SELECTABLE_MODEL_KEYS.has(modelId)) {
        return true;
    }
    if (label && SELECTABLE_MODEL_LABELS.has(label)) {
        return true;
    }

    const mid = modelId.toLowerCase();
    const lbl = (label || '').toLowerCase();

    // Check blacklist first
    if (AUTH_MODEL_BLACKLIST_IDS.includes(modelId) || AUTH_MODEL_BLACKLIST_IDS.includes(mid)) {
        return false;
    }

    if (
        /^gemini-\d+(?:\.\d+)?-(argon|flash|pro)(?:-|$)/.test(mid) ||
        /^claude-(?:opus|sonnet|haiku)-\d+(?:-\d+)?(?:-|$)/.test(mid) ||
        /^gemini \d+(?:\.\d+)? (argon|flash|pro)\b/.test(lbl) ||
        /^claude (?:opus|sonnet|haiku) \d+(?:\.\d+)?\b/.test(lbl) ||
        /^gpt-oss-\d+[a-z]*/.test(mid) ||
        /^gpt-oss \d+[a-z]*/.test(lbl) ||
        /gpt[-_]oss/.test(mid)
    ) {
        return true;
    }

    return false;
}
