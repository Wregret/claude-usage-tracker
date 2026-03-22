# Developer Guide

This document covers the code structure, architecture, testing, and maintenance of the Claude Usage Tracker Chrome extension.

---

## Code Structure

```
claude-usage-tracker/
├── manifest.json              # Chrome extension manifest (MV3)
├── background/
│   └── service-worker.js      # Session lifecycle management
├── content/
│   └── content-script.js      # DOM observation on claude.ai
├── popup/
│   ├── popup.html             # Extension popup markup
│   ├── popup.css              # Popup styles (CSS custom properties)
│   └── popup.js               # Popup logic: tabs, charts, data display
├── lib/
│   ├── storage.js             # Data layer (chrome.storage.local wrapper)
│   └── chart.min.js           # Chart.js v4 UMD bundle (vendored)
├── utils/
│   └── time.js                # Shared time/date formatting utilities
├── icons/
│   ├── icon16.png             # Toolbar icon (16x16)
│   ├── icon48.png             # Extensions page icon (48x48)
│   └── icon128.png            # Chrome Web Store icon (128x128)
├── README.md                  # User-facing documentation
└── DEVELOPER.md               # This file
```

---

## Architecture Overview

The extension follows Chrome's Manifest V3 architecture with three main components:

### 1. Content Script (`content/content-script.js`)

**Runs in**: claude.ai page context (injected at `document_idle`)

**Responsibilities**:
- Attaches a `MutationObserver` to the conversation container to detect new user and assistant messages.
- Sends `MESSAGE_DETECTED` events to the background with the message role.
- Sends `HEARTBEAT` messages every 30 seconds (only when the page is visible).
- Re-attaches the observer when the user navigates between conversations (SPA navigation detection).

**Key design decisions**:
- Uses multiple DOM heuristics (`data-testid`, class names, `data-role`) for message detection, making it resilient to minor claude.ai UI changes.
- Assistant messages are debounced (2-second window) because streaming responses trigger many DOM mutations.
- Wrapped in an IIFE to avoid global scope pollution.

### 2. Background Service Worker (`background/service-worker.js`)

**Runs in**: Extension background (MV3 service worker, may be terminated by Chrome)

**Responsibilities**:
- Manages session lifecycle: start, heartbeat, idle detection, finalization.
- Listens to `chrome.tabs` events to detect when the user is on claude.ai.
- Uses `chrome.alarms` (1-minute interval) to check for idle sessions (5-minute timeout).
- Updates storage aggregates when sessions are finalized.

**Session lifecycle**:
```
Tab opens claude.ai → ensureSessionStarted()
  ↓
Content script sends HEARTBEAT/MESSAGE_DETECTED → updates lastActivity
  ↓
Tab closes / navigates away / idle timeout → finalizeSession()
  ↓
Completed session saved to storage, aggregates updated
```

**Key design decisions**:
- Single active session model: even with multiple claude.ai tabs, one session is tracked. This prevents double-counting.
- Sessions shorter than 10 seconds are discarded (accidental visits).
- Uses `importScripts()` to load shared utilities (MV3 service workers support this).

### 3. Popup (`popup/popup.html`, `popup.js`, `popup.css`)

**Runs in**: Extension popup (opened when user clicks the toolbar icon)

**Responsibilities**:
- Three-tab interface: Dashboard, Sessions, Analytics.
- Dashboard: shows live session timer, today/week summaries, quick stats.
- Sessions: scrollable list of past sessions grouped by date.
- Analytics: Chart.js charts for daily trends, day-of-week, and hourly activity.

**Key design decisions**:
- Chart instances are destroyed and recreated on tab switch to prevent memory leaks.
- Live session timer updates every 1 second via `setInterval`.
- No framework — plain vanilla JS for minimal extension size.

### 4. Storage Layer (`lib/storage.js`)

**Data schema** (stored in `chrome.storage.local`):

| Key | Type | Description |
|-----|------|-------------|
| `activeSession` | Object | Currently running session (null if none) |
| `sessions` | Array | Completed session records |
| `dailyAggregates` | Object | `{ "YYYY-MM-DD": { duration, messages, sessions } }` |
| `hourlyAggregates` | Object | `{ "0"-"23": { messages, sessions } }` |
| `dayOfWeekAggregates` | Object | `{ "0"-"6": { duration, messages, sessions } }` (0=Mon) |

**Design**: Denormalized storage with pre-computed aggregates. Raw sessions enable the Sessions list; aggregates enable fast chart rendering without scanning hundreds of sessions.

### 5. Time Utilities (`utils/time.js`)

Pure functions for date formatting, week calculation, and duration display. Used by both the background worker (via `importScripts`) and the popup (via `<script>` tag).

---

## Testing

### Manual Testing

Since this is a Chrome extension with DOM-dependent content scripts, manual testing is the primary method.

#### Loading the Extension

1. Go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the project folder

#### Testing Session Tracking

1. Open `chrome://extensions/` → find the extension → click "Service Worker" to open DevTools
2. In the Console, inspect storage:
   ```js
   chrome.storage.local.get(null, data => console.log(data));
   ```
3. Open `https://claude.ai` in a new tab
4. Check that `activeSession` is created in storage
5. Send a message to Claude, verify `messageCount` increments
6. Close the claude.ai tab, verify the session is finalized (moved to `sessions` array)

#### Testing Idle Timeout

1. Open claude.ai, wait for a session to start
2. Navigate to a different tab and wait 6 minutes
3. Check storage — the session should be finalized with `endTime` = `lastActivity`

#### Testing the Popup

1. Click the extension icon
2. Verify Dashboard shows current session (or "no active session")
3. Switch to Sessions tab — verify session history appears
4. Switch to Analytics tab — verify charts render

#### Injecting Test Data

To test with mock data without waiting for real usage:

```js
// Run in the Service Worker console
chrome.storage.local.set({
  sessions: [
    { id: 'test1', startTime: Date.now() - 7200000, endTime: Date.now() - 3600000,
      duration: 3600000, messageCount: 20, userMessages: 10, assistantMessages: 10,
      date: new Date().toISOString().split('T')[0], hourOfDay: 14 },
    { id: 'test2', startTime: Date.now() - 90000000, endTime: Date.now() - 86400000,
      duration: 3600000, messageCount: 15, userMessages: 8, assistantMessages: 7,
      date: new Date(Date.now() - 86400000).toISOString().split('T')[0], hourOfDay: 10 }
  ],
  dailyAggregates: {
    [new Date().toISOString().split('T')[0]]: { duration: 3600000, messages: 20, sessions: 1 },
    [new Date(Date.now() - 86400000).toISOString().split('T')[0]]: { duration: 3600000, messages: 15, sessions: 1 }
  },
  hourlyAggregates: { '10': { messages: 15, sessions: 1 }, '14': { messages: 20, sessions: 1 } },
  dayOfWeekAggregates: { '0': { duration: 3600000, messages: 20, sessions: 1 }, '1': { duration: 3600000, messages: 15, sessions: 1 } }
});
```

#### Clearing All Data

```js
chrome.storage.local.clear();
```

### Automated Testing (Future)

For unit testing the pure utility functions (`utils/time.js`, `lib/storage.js`), you could:

1. Extract the functions as ES modules
2. Use a test runner like Vitest or Jest
3. Mock `chrome.storage.local` with a simple in-memory object

Example mock:
```js
globalThis.chrome = {
  storage: {
    local: {
      _data: {},
      get: (keys) => Promise.resolve(
        typeof keys === 'string' ? { [keys]: this._data[keys] } : { ...this._data }
      ),
      set: (obj) => { Object.assign(this._data, obj); return Promise.resolve(); },
      remove: (key) => { delete this._data[key]; return Promise.resolve(); },
      clear: () => { this._data = {}; return Promise.resolve(); }
    }
  }
};
```

---

## Maintenance

### When claude.ai Changes Its DOM

The content script (`content/content-script.js`) detects messages by inspecting DOM elements. If claude.ai updates its markup:

1. Open claude.ai and use Chrome DevTools to inspect the chat message containers.
2. Look for identifiable attributes: `data-testid`, `data-role`, class names.
3. Update the `isUserMessage()` and `isAssistantMessage()` functions with new selectors.
4. Update `findConversationContainer()` if the main chat container's selector changed.

### Updating Chart.js

The vendored `lib/chart.min.js` is Chart.js v4 UMD. To update:

```bash
curl -L "https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js" -o lib/chart.min.js
```

Test that charts still render correctly in the popup after updating.

### Storage Limits

`chrome.storage.local` has a 10 MB limit. The extension auto-prunes data older than 90 days on startup. If users report storage issues:

1. Check storage size:
   ```js
   chrome.storage.local.getBytesInUse(null, bytes => console.log(`${bytes} bytes used`));
   ```
2. Reduce the `maxAgeDays` parameter in the `pruneOldData()` call in `service-worker.js`.

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Service worker stops | MV3 terminates idle workers | The alarm-based design handles this. Session state is persisted to storage, so it survives worker restarts. |
| Double message counting | MutationObserver fires multiple times | The deduplication guard (`lastDetectedUserEl`) and assistant debounce timer prevent this. |
| Session never ends | Heartbeat keeps refreshing `lastActivity` | Check that the content script respects `document.visibilityState`. Heartbeats should only fire when the page is visible. |

---

## Building for Distribution

To package the extension for the Chrome Web Store:

1. Remove any test/mock data from storage.
2. Increment the version in `manifest.json`.
3. Zip the entire project folder:
   ```bash
   zip -r claude-usage-tracker.zip . -x ".*" -x "DEVELOPER.md" -x "*.git*"
   ```
4. Upload the zip at the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

---

## Key Files Quick Reference

| File | What to edit | When |
|------|-------------|------|
| `content/content-script.js` | `isUserMessage()`, `isAssistantMessage()`, `findConversationContainer()` | Claude.ai DOM changes |
| `background/service-worker.js` | `IDLE_TIMEOUT_MS`, session lifecycle logic | Adjust tracking behavior |
| `lib/storage.js` | Storage schema, new aggregate types | Add new analytics dimensions |
| `popup/popup.js` | Chart configs, new UI sections | Add new visualizations |
| `popup/popup.css` | CSS variables in `:root` | Change theme/colors |
| `manifest.json` | Version, permissions | New releases, new features |
