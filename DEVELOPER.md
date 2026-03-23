# Developer Guide

## Code Structure

```
claude-usage-tracker/
├── manifest.json                      # Chrome MV3 manifest
├── background/
│   └── service-worker.js              # Message relay, caching, periodic refresh
├── content/
│   ├── content-script.js              # Chat usage (claude.ai)
│   └── console-content-script.js      # API usage (platform.claude.com)
├── popup/
│   ├── popup.html                     # Tabbed UI: Chat + API
│   ├── popup.css                      # Styles (tabs, bars, tables)
│   └── popup.js                       # Dual-pipeline rendering
├── lib/
│   ├── storage.js                     # Schema documentation
│   └── chart.min.js                   # Chart.js v4 UMD (vendored)
├── utils/
│   └── time.js                        # Shared formatting helpers
├── icons/                             # 16/48/128px PNGs
├── tests/
│   └── test_extension.py              # Validation suite
├── .gitignore
├── LICENSE                            # MIT
├── README.md
└── DEVELOPER.md
```

## Architecture

Two parallel data pipelines share the same service worker relay pattern:

```
Popup                          Service Worker                Content Scripts
  │                                │
  │── POPUP_FETCH_USAGE ─────────▸│                          claude.ai tab
  │                                │── FETCH_USAGE ─────────▸│── fetch(/api/.../usage)
  │                                │◂── { usage, org } ──────│
  │◂── chat data ─────────────────│
  │                                │
  │── POPUP_FETCH_API_USAGE ─────▸│                          platform.claude.com tab
  │                                │── FETCH_API_USAGE ─────▸│── fetch(/api/.../usage)
  │                                │◂── { usage, models, … } ─│
  │◂── api data ──────────────────│
```

**Key design decisions:**
- **Two content scripts** — one per origin. Each fetches with the user's session cookies.
- **Service worker is a relay + cache** — never calls fetch() itself. Uses a shared `PIPELINES` config to avoid duplicating logic.
- **Programmatic injection** — injects content scripts via `chrome.scripting.executeScript` if not already loaded.
- **No importScripts** — all dependencies inlined in the service worker.
- **Sender validation** — only accepts messages from its own extension ID.
- **Tabbed popup** — Chat and API usage in separate tabs, fetched in parallel.

## Storage Schema

| Key | Type | Pipeline | Description |
|-----|------|----------|-------------|
| `orgId` | string | Chat | claude.ai organization UUID |
| `cachedUsage` | object | Chat | Last fetched chat usage data |
| `lastFetchTime` | number | Chat | Epoch ms of last chat fetch |
| `usageHistory` | object | Chat | `{ "YYYY-MM-DD": snapshot }` (90-day retention) |
| `apiOrgId` | string | API | platform.claude.com org UUID |
| `cachedApiUsage` | object | API | Last fetched API usage data |
| `lastApiFetchTime` | number | API | Epoch ms of last API fetch |
| `apiUsageHistory` | object | API | `{ "YYYY-MM-DD": snapshot }` (90-day retention) |

## Testing

```bash
python3 tests/test_extension.py
```

| Suite | What it validates |
|-------|-------------------|
| TestManifest | MV3 schema, permissions, host_permissions for both origins |
| TestServiceWorker | Dual pipelines, caching, history, alarms, sender validation |
| TestContentScript | Chat: org discovery, API fetching, credentials |
| TestConsoleContentScript | API: org discovery, billing fetching, credentials |
| TestPopup | Tabs, dual rendering, bars, models table, charts, XSS escaping |
| TestMessageContract | All message types match across all files |
| TestUtils, TestIcons, TestFileStructure, TestPrivacy | Helpers, icons, files, no external requests |

## Maintenance

### When claude.ai changes its API

1. Open DevTools Network tab on claude.ai/settings/usage.
2. Update `content/content-script.js`: `fetchUsageData()`, `discoverOrgId()`.
3. Update `popup/popup.js`: `extractChatUsageBars()`.

### When platform.claude.com changes its API

1. Open DevTools Network tab on platform.claude.com/usage.
2. Update `content/console-content-script.js`: `fetchApiUsageData()`, `discoverOrgId()`.
3. Update `popup/popup.js`: `renderApiUsageSummary()`, `renderApiModels()`, `renderApiRateLimits()`.

### Updating Chart.js

```bash
curl -L "https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js" -o lib/chart.min.js
```

### Key files

| What | File | Functions |
|------|------|-----------|
| Chat endpoints | `content/content-script.js` | `fetchUsageData()`, `discoverOrgId()` |
| API endpoints | `content/console-content-script.js` | `fetchApiUsageData()`, `discoverOrgId()` |
| Chat rendering | `popup/popup.js` | `renderChatData()`, `extractChatUsageBars()` |
| API rendering | `popup/popup.js` | `renderApiData()`, `renderApiUsageSummary()`, `renderApiModels()`, `renderApiRateLimits()` |
| Pipeline relay | `background/service-worker.js` | `fetchViaContentScript()`, `PIPELINES` |
| Theme/colors | `popup/popup.css` | `:root` variables, `.bar-ok/warning/danger` |
