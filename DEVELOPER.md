# Developer Guide

## Code Structure

```
claude-usage-tracker/
├── manifest.json                 # Chrome MV3 manifest
├── background/
│   └── service-worker.js         # Message relay, caching, periodic refresh
├── content/
│   └── content-script.js         # API calls, org discovery
├── popup/
│   ├── popup.html                # Usage bars, rate limits, history chart
│   ├── popup.css                 # Styles (percentage bars, color coding)
│   └── popup.js                  # Data fetching, rendering, chart
├── lib/
│   ├── storage.js                # Schema documentation
│   └── chart.min.js              # Chart.js v4 UMD (vendored)
├── utils/
│   └── time.js                   # Shared formatting helpers
├── icons/                        # 16/48/128px PNGs
├── tests/
│   └── test_extension.py         # Validation suite
├── .gitignore
├── LICENSE                       # MIT
├── README.md
└── DEVELOPER.md
```

## Architecture

```
Popup                          Service Worker                Content Script (on claude.ai)
  │                                │                              │
  │── POPUP_GET_CACHED ──────────▸│                              │
  │◂── cached data ──────────────│                              │
  │                                │                              │
  │── POPUP_FETCH_USAGE ─────────▸│                              │
  │                                │── FETCH_USAGE ─────────────▸│
  │                                │                              │── fetch(/api/organizations/...)
  │                                │                              │── fetch(/api/.../usage)
  │                                │                              │── fetch(/api/.../rate_limit_status)
  │                                │◂── { usage, rateLimit } ────│
  │◂── { usage, rateLimit } ──────│                              │
  │                                │── cache to storage           │
  │                                │── save daily snapshot        │
  │                                │                              │
  │                                │   (on page load)             │
  │                                │◂── ORG_ID_DISCOVERED ───────│
```

**Key design decisions:**
- **Content script fetches the API** (not the service worker) because it runs on claude.ai's origin with the user's cookies.
- **Service worker is a relay + cache** — it never calls fetch() itself.
- **Programmatic injection** — if the content script isn't loaded (tab was open before extension install), the service worker injects it via `chrome.scripting.executeScript`.
- **No importScripts** — the service worker inlines its minimal dependencies. This avoids MV3 path resolution bugs.
- **Multiple API endpoints tried** — `Promise.allSettled` tries org info, usage, rate limits, and settings in parallel.
- **Sender validation** — the service worker only accepts messages from its own extension ID.

## Storage Schema

| Key | Type | Description |
|-----|------|-------------|
| `orgId` | string | Discovered organization UUID |
| `cachedUsage` | object | Last fetched usage response |
| `lastFetchTime` | number | Epoch ms of last successful fetch |
| `usageHistory` | object | `{ "YYYY-MM-DD": snapshot }` for trend chart (90-day retention) |

## Testing

```bash
python3 tests/test_extension.py
```

| Suite | What it validates |
|-------|-------------------|
| TestManifest | MV3 schema, permissions (incl. scripting), file refs, no `type: module` |
| TestServiceWorker | No importScripts, message handling, caching, history, alarms, script injection fallback, sender validation |
| TestContentScript | Org discovery, API fetching, credentials |
| TestPopup | Usage bars, color coding, refresh, error handling, chart, XSS escaping |
| TestMessageContract | All message types match across content ↔ SW ↔ popup |
| TestUtils, TestIcons, TestFileStructure, TestPrivacy | Helpers, icons, files, no external requests |

## Maintenance

### When claude.ai changes its API

1. Open DevTools Network tab on claude.ai/settings/usage.
2. Identify the API calls that return usage data.
3. Update `content-script.js`:
   - `fetchUsageData()` — add new endpoint paths
   - `discoverOrgId()` — if org ID location changed
4. Update `popup.js`:
   - `extractUsageBars()` — add parsing for the new response shape
   - `extractPlanName()` in `utils/time.js` — if plan info moved

### Updating Chart.js

```bash
curl -L "https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js" -o lib/chart.min.js
```

### Key files

| What | File | Functions |
|------|------|-----------|
| API endpoints | `content/content-script.js` | `fetchUsageData()`, `discoverOrgId()` |
| Response parsing | `popup/popup.js` | `extractUsageBars()`, `renderUsageBars()` |
| Caching | `background/service-worker.js` | `getCachedUsageData()`, `saveUsageSnapshot()` |
| Theme/colors | `popup/popup.css` | `:root` variables, `.bar-ok/warning/danger` |
