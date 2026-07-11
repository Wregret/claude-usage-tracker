# Privacy Policy — Claude Usage Tracker

**Last updated:** March 2026

## Summary

Claude Usage Tracker does not collect, transmit, or share any user data. All data stays on your device.

## Data Collection

This extension does **not** collect any personal information or usage data. It does not use analytics, telemetry, or tracking of any kind.

## Data Storage

Usage statistics fetched from claude.ai and platform.claude.com are cached locally in `chrome.storage.local` on your device. This data includes:

- Organization identifiers (UUIDs)
- Usage metrics (token counts, utilization percentages)
- Rate limit information
- Model availability

No authentication tokens, session cookies, passwords, or API keys are stored.

## Network Communication

The extension communicates **only** with the following origins, using your existing browser session:

- `https://claude.ai` — to fetch chat usage data
- `https://platform.claude.com` — to fetch API usage and rate limit data

These requests are made by the extension's background service worker (or, as a fallback, by content scripts running on those pages) using your existing browser session. No data is sent to any third-party server, external API, or analytics service.

## Permissions

| Permission | Why it's needed |
|---|---|
| `storage` | Cache usage data locally for instant popup loading |
| `alarms` | Periodic background refresh every 5 minutes |
| `tabs` | Locate open claude.ai and platform.claude.com tabs |
| `scripting` | Inject content scripts into already-open tabs |

## Third-Party Services

This extension does not use any third-party services, SDKs, or external scripts. The bundled Chart.js library runs entirely locally.

## Changes

If this policy changes, the update will be posted here with a revised date.

## Contact

For questions, open an issue at [github.com/Wregret/claude-usage-tracker](https://github.com/Wregret/claude-usage-tracker/issues).
