# Antigravity Cockpit (GitHub Contribution Style)
English · [简体中文](README.md)

[![Version](https://img.shields.io/open-vsx/v/jlcodes/antigravity-cockpit)](https://open-vsx.org/extension/jlcodes/antigravity-cockpit)
[![Downloads](https://img.shields.io/open-vsx/dt/jlcodes/antigravity-cockpit?color=success)](https://open-vsx.org/extension/jlcodes/antigravity-cockpit)
[![GitHub stars](https://img.shields.io/github/stars/mmximxim/vscode-antigravity-cockpit?style=flat&color=gold)](https://github.com/mmximxim/vscode-antigravity-cockpit)
[![GitHub issues](https://img.shields.io/github/issues/mmximxim/vscode-antigravity-cockpit)](https://github.com/mmximxim/vscode-antigravity-cockpit/issues)
[![License](https://img.shields.io/github/license/mmximxim/vscode-antigravity-cockpit)](https://github.com/mmximxim/vscode-antigravity-cockpit)

VS Code extension for monitoring Google Antigravity AI model quotas.

**Features**: Webview Dashboard · QuickPick Mode · **📊 Stats Dashboard (GitHub Contribution Graph Style)** · Quota Grouping · Auto-Grouping · Rename · Card View · Drag-and-Drop Sorting · Status Bar Monitor · Threshold Notifications · Privacy Mode

**Languages**: Follows VS Code language setting, supports 16 languages

🇺🇸 English · 🇨🇳 简体中文 · 繁體中文 · 🇯🇵 日本語 · 🇩🇪 Deutsch · 🇪🇸 Español · 🇫🇷 Français · 🇮🇹 Italiano · 🇰🇷 한국어 · 🇧🇷 Português · 🇷🇺 Русский · 🇹🇷 Türkçe · 🇵🇱 Polski · 🇨🇿 Čeština · 🇸🇦 العربية · 🇻🇳 Tiếng Việt

---

## Features

### 📊 Statistics & Quota History Dashboard 🔥

<img width="688" height="443" alt="Stats Dashboard Preview" src="https://github.com/user-attachments/assets/196c0229-0d2f-4710-a96b-d225c2b86a7f" />

> **Key Feature**: Click the **📈 Stats & History** tab in the dashboard for deep insights into your AI model consumption, activity trends, and detailed per-model quota logs!

| Panel | Description |
|-------|-------------|
| ⚡ **Summary Cards** | Total Quota Consumed · Daily Peak · Current Active Streak (Hover to view calculation details) |
| 🗓️ **Activity Heatmap** | **GitHub Contribution Graph Style** strict 1:1 square grid with **Daily / Weekly / Cumulative** views, auto-fitting width, and responsive tooltips |
| 📈 **Multi-Model Usage Trends** | Smooth line chart for **Last 7 Days / 30 Days**, with intelligent pool deduplication for Claude and Gemini models |
| 🍩 **Model Distribution Donut** | Doughnut breakdown of consumption per model with center total and detailed legend list |
| 📉 **Per-Model Quota History** | Quota remaining percentage timeline (24h / 7d / 30d) with account and model selectors |
| 📋 **Quota Change Detail Log** | Step-by-step table of quota drops, reset timestamps, and countdown timers with pagination |

> **Data Extraction**: Automatically computed from cached quota history and poll deltas, with deduplicated pools for Gemini and Claude.

### Display Modes

Two display modes available, configurable via `agCockpit.displayMode`:

#### Webview Dashboard

![Dashboard Overview](assets/dashboard_card_grouped.png)

- **Card View**: Card layout for quota overview
- **Grouping Mode**: Aggregates models by quota pool
- **Non-Grouping Mode**: Shows individual model quotas
- **Drag-and-Drop Sorting**: Reorder cards by dragging
- **Auto-Grouping**: Automatically categorizes models by quota pool

#### QuickPick Mode

![QuickPick Mode](assets/quickpick_mode.png)

Uses VS Code native QuickPick API, suitable for:
- Environments where Webview cannot load
- Users who prefer keyboard navigation
- Quick quota checks

Features:
- Supports grouping / non-grouping mode
- Title bar buttons: Refresh, Toggle Grouping, Logs, Settings, Switch to Webview
- Pin models to status bar
- Rename models and groups

---

### Status Bar

Displays quota status of monitored models. 6 formats available:

| Format | Example |
|--------|---------|
| Icon only | `🚀` |
| Dot only | `🟢` / `🟡` / `🔴` |
| Percent only | `95%` |
| Dot + Percent | `🟢 95%` |
| Name + Percent | `Sonnet: 95%` |
| Full display | `🟢 Sonnet: 95%` |

- **Multi-Model Pinning**: Monitor multiple models simultaneously
- **Auto-Monitor**: Shows the model with lowest remaining quota when no model is pinned

---

### Quota Display

Each model / group shows:
- **Remaining quota percentage**
- **Countdown**: e.g., `4h 40m`
- **Reset time**: e.g., `15:16`
- **Progress bar**: Visual representation of remaining quota

---

### Quota Source (Local / Authorized)

Two quota sources are available, and you can switch from the top-right of the panel at any time:

- **Local Monitoring**: Reads from the local Antigravity client process; more stable but requires the client to stay running
- **Authorized Monitoring**: Fetches quota via authorized remote APIs, independent of the local process; ideal for API relays or headless usage
- **Multi-account Authorization**: Authorized monitoring supports multiple accounts with account switching and status badges
- **Switching Tips**: Shows loading/timeout hints during switches; you can switch back to local if the network is unstable

---

### Model Capabilities Tooltip

![Model Capabilities Tooltip](assets/model_capabilities_tooltip.png)

Hover over model name to view:
- Supported input types (text, image, video, etc.)
- Context window size
- Other capability tags

---

### Grouping Feature

- **Group by Quota Pool**: Models sharing quota pools are grouped automatically or manually
- **Custom Group Names**: Click edit icon to rename
- **Group Sorting**: Drag to reorder groups
- **Group Pinning**: Pin groups to status bar

---

### Settings Panel

![Settings Modal](assets/settings_modal.png)

Open via gear icon in dashboard header. Configure:
- Status bar display format
- Warning threshold (yellow)
- Critical threshold (red)
- View mode (card / list)
- Notification toggle

---

### Profile Panel

Displays:
- Subscription tier
- User ID
- Collapsible, sensitive data can be masked

---

### Notifications

Sends notifications when model quota falls below warning threshold or is exhausted. Can be disabled in settings.

---

## Usage

1. **Open**:
   - Click status bar icon
   - Or `Ctrl/Cmd+Shift+Q`
   - Or run `Antigravity Cockpit: Open Dashboard` from command palette

2. **Refresh**: Click refresh button or `Ctrl/Cmd+Shift+R` (when dashboard is active)

3. **Troubleshooting**:
   - Click **Retry Connection** when showing "Systems Offline"
   - Click **Open Logs** to view debug logs (authorized requests show full URLs to identify domains)

---

---

### Auto Wake-up

**NEW** 🔥 Schedule automated requests to wake up AI models and trigger quota reset cycles.

- **Flexible Scheduling**: Supports daily, weekly, interval, and advanced Crontab modes
- **Multi-Model Support**: Wake up multiple models simultaneously
- **Multi-Account Authorization**: Authorize multiple accounts, switch active account, and view account status
- **Account Management**: Manage accounts with reauthorize/remove actions
- **Secure**: Credentials encrypted in VS Code Secret Storage, running locally
- **History**: View detailed trigger logs and AI responses
- **Use Case**: Wake up before work to run through the reset cooldown during idle time

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `agCockpit.displayMode` | `webview` | Display mode: `webview` / `quickpick` |
| `agCockpit.refreshInterval` | `120` | Refresh interval (seconds, 10-3600) |
| `agCockpit.statusBarFormat` | `standard` | Status bar format |
| `agCockpit.groupingEnabled` | `true` | Enable grouping mode |
| `agCockpit.warningThreshold` | `30` | Warning threshold (%) |
| `agCockpit.criticalThreshold` | `10` | Critical threshold (%) |
| `agCockpit.notificationEnabled` | `true` | Enable notifications |
| `agCockpit.pinnedModels` | `[]` | Models pinned to status bar |
| `agCockpit.pinnedGroups` | `[]` | Groups pinned to status bar |

---

## Installation

### Open VSX Marketplace
1. `Cmd/Ctrl+Shift+X` to open Extensions panel
2. Search `Antigravity Cockpit`
3. Click Install

### VSIX File
```bash
code --install-extension antigravity-cockpit-x.y.z.vsix
```

---

## Build from Source

```bash
# Clone repository
git clone https://github.com/mmximxim/vscode-antigravity-cockpit.git
cd vscode-antigravity-cockpit

# Install dependencies
npm install

# Compile
npm run compile

# Package
npm run package
```

Requirements: Node.js v18+, npm v9+

---

## Changelog

- [CHANGELOG.md](CHANGELOG.md) (English)
- [CHANGELOG.zh-CN.md](CHANGELOG.zh-CN.md) (Chinese)

## License

[MIT](LICENSE)

---

## Disclaimer

This project is intended for personal learning and research purposes only. By using this project, you agree to:

- Not use this project for any commercial purposes
- Assume all risks and responsibilities associated with using this project
- Comply with relevant service terms and applicable laws

The author is not responsible for any direct or indirect damages arising from the use of this project.
