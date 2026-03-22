# Developer Guide

## Code Structure

```
claude-usage-tracker/
├── manifest.json                 # Chrome MV3 manifest
├── background/
│   └── service-worker.js         # Message relay, caching, periodic refresh
├── content/
│   └── content-script.js         # Fetch interception, API calls, org discovery
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
│   └── test_extension.py         # 86-test validation suite
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
  │                                │   (passive interception)     │
  │                                │◂── USAGE_DATA_INTERCEPTED ──│
  │                                │◂── ORG_ID_DISCOVERED ───────│
```

**Key design decisions:**
- **Content script fetches the API** (not the service worker) because it runs in the page context with the user's cookies.
- **Service worker is a relay + cache** — it never calls fetch() itself.
- **No importScripts** — the service worker inlines its minimal dependencies. This avoids MV3 path resolution bugs.
- **Multiple API endpoints tried** — `Promise.allSettled` tries org info, usage, rate limits, and settings in parallel.
- **Adaptive rendering** — the popup handles multiple possible API response shapes since we can't know the exact format.

## Storage Schema

| Key | Type | Description |
|-----|------|-------------|
| `orgId` | string | Discovered organization UUID |
| `cachedUsage` | object | Last fetched usage response |
| `lastFetchTime` | number | Epoch ms of last successful fetch |
| `interceptedData` | object | Passively captured API responses |
| `usageHistory` | object | `{ "YYYY-MM-DD": snapshot }` for trend chart |

## Testing

```bash
python3 tests/test_extension.py
```

86 tests covering:

| Suite | What it validates |
|-------|-------------------|
| TestManifest | MV3 schema, permissions, file refs, no `type: module` |
| TestServiceWorker | No importScripts, message handling, caching, history, alarms |
| TestContentScript | Fetch interception, org discovery, API fetching, credentials |
| TestPopup | Usage bars, color coding, refresh, error handling, chart |
| TestMessageContract | All message types match across content ↔ SW ↔ popup |
| TestUtils, TestIcons, TestFileStructure, TestPrivacy | Helpers, icons, files, no external requests |

## Maintenance

### When claude.ai changes its API

1. Open DevTools Network tab on claude.ai/settings/usage.
2. Identify the API calls that return usage data.
3. Update `content-script.js`:
   - `fetchUsageData()` — add new endpoint paths
   - `isCompletionEndpoint()` — if URL patterns changed
4. Update `popup.js`:
   - `extractUsageBars()` — add parsing for the new response shape
   - `extractPlanName()` in `utils/time.js` — if plan info moved

### Adding new API response shapes

The popup's `extractUsageBars()` function tries 5+ different response shapes. To add a new one, add another block in the function that checks for the new shape and pushes to the `bars` array.

### Updating Chart.js

```bash
curl -L "https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js" -o lib/chart.min.js
```

### Key files

| What | File | Functions |
|------|------|-----------|
| API endpoints | `content/content-script.js` | `fetchUsageData()`, `discoverOrgId()` |
| Response parsing | `popup/popup.js` | `extractUsageBars()`, `renderUsageBars()` |
| Caching | `background/service-worker.js` | `cacheUsageData()`, `getCachedUsageData()` |
| Theme/colors | `popup/popup.css` | `:root` variables, `.bar-ok/warning/danger` |
