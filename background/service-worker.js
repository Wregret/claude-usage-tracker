/**
 * Background service worker for Claude Usage Tracker.
 *
 * Self-contained (no importScripts).
 *
 * Two parallel data pipelines:
 * - Chat usage: popup ↔ service worker ↔ content script on claude.ai
 * - API usage:  popup ↔ service worker ↔ content script on console.anthropic.com
 */

// ═══════════════════════════════════════════════════════════════
// Utilities (inlined to avoid importScripts)
// ═══════════════════════════════════════════════════════════════

function getDateString(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const ORG_ID_PATTERN = /^[a-f0-9-]{36}$/i;

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

const REFRESH_ALARM = 'refreshUsage';
const REFRESH_INTERVAL_MIN = 5;

// ═══════════════════════════════════════════════════════════════
// Initialization
// ═══════════════════════════════════════════════════════════════

chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_INTERVAL_MIN });

// ═══════════════════════════════════════════════════════════════
// Message Listener
// ═══════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  handleMessage(message, sender).then(sendResponse);
  return true;
});

async function handleMessage(message, sender) {
  switch (message.type) {

    // ─── Chat (claude.ai) ─────────────────────────────
    case 'ORG_ID_DISCOVERED':
      if (!message.orgId || !ORG_ID_PATTERN.test(message.orgId)) {
        return { ok: false, error: 'Invalid org ID format' };
      }
      await chrome.storage.local.set({ orgId: message.orgId });
      return { ok: true };

    case 'POPUP_FETCH_USAGE':
      return await fetchViaContentScript('chat');

    case 'POPUP_GET_CACHED':
      return await getCached('chat');

    case 'POPUP_GET_HISTORY':
      return await getHistory('chat');

    // ─── API (console.anthropic.com) ──────────────────
    case 'API_ORG_ID_DISCOVERED':
      if (!message.orgId || !ORG_ID_PATTERN.test(message.orgId)) {
        return { ok: false, error: 'Invalid org ID format' };
      }
      await chrome.storage.local.set({ apiOrgId: message.orgId });
      return { ok: true };

    case 'POPUP_FETCH_API_USAGE':
      return await fetchViaContentScript('api');

    case 'POPUP_GET_CACHED_API':
      return await getCached('api');

    case 'POPUP_GET_API_HISTORY':
      return await getHistory('api');

    default:
      return { ok: false, error: 'Unknown message type' };
  }
}

// ═══════════════════════════════════════════════════════════════
// Alarm: Periodic Refresh
// ═══════════════════════════════════════════════════════════════

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== REFRESH_ALARM) return;
  await Promise.allSettled([
    fetchViaContentScript('chat'),
    fetchViaContentScript('api')
  ]);
});

// ═══════════════════════════════════════════════════════════════
// Pipeline Configuration
// ═══════════════════════════════════════════════════════════════

const PIPELINES = {
  chat: {
    tabUrl: 'https://claude.ai/*',
    messageType: 'FETCH_USAGE',
    scriptFile: 'content/content-script.js',
    cacheKey: 'cachedUsage',
    timeKey: 'lastFetchTime',
    historyKey: 'usageHistory',
    noTabError: 'No claude.ai tab open. Open claude.ai to fetch usage data.',
  },
  api: {
    tabUrl: 'https://console.anthropic.com/*',
    messageType: 'FETCH_API_USAGE',
    scriptFile: 'content/console-content-script.js',
    cacheKey: 'cachedApiUsage',
    timeKey: 'lastApiFetchTime',
    historyKey: 'apiUsageHistory',
    noTabError: 'No console.anthropic.com tab open. Open the Anthropic console to fetch API usage.',
  }
};

// ═══════════════════════════════════════════════════════════════
// Data Management (shared by both pipelines)
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch usage data via a content script on the appropriate tab.
 * @param {'chat'|'api'} pipeline
 * @returns {Promise<Object>}
 */
async function fetchViaContentScript(pipeline) {
  const cfg = PIPELINES[pipeline];
  try {
    const tabs = await chrome.tabs.query({ url: cfg.tabUrl });
    if (tabs.length === 0) {
      const cached = await getCached(pipeline);
      if (cached && cached.ok) return cached;
      return { ok: false, error: cfg.noTabError };
    }

    const tabId = tabs[0].id;
    let response;

    try {
      response = await chrome.tabs.sendMessage(tabId, { type: cfg.messageType });
    } catch (e) {
      // Content script not loaded — inject and retry
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: [cfg.scriptFile]
        });
        await new Promise(r => setTimeout(r, 500));
        response = await chrome.tabs.sendMessage(tabId, { type: cfg.messageType });
      } catch (retryErr) {
        return { ok: false, error: 'Could not reach the page. Try refreshing it.' };
      }
    }

    if (response && response.ok) {
      await chrome.storage.local.set({
        [cfg.cacheKey]: response,
        [cfg.timeKey]: Date.now()
      });
      await saveSnapshot(pipeline, response);
    }
    return response || { ok: false, error: 'No response from content script' };
  } catch (e) {
    return { ok: false, error: 'Could not reach the page. Try refreshing it.' };
  }
}

/**
 * Get cached data from storage.
 * @param {'chat'|'api'} pipeline
 * @returns {Promise<Object>}
 */
async function getCached(pipeline) {
  const cfg = PIPELINES[pipeline];
  const data = await chrome.storage.local.get([cfg.cacheKey, cfg.timeKey]);
  const cached = data[cfg.cacheKey];
  if (cached) {
    cached.fromCache = true;
    cached.cacheAge = Date.now() - (data[cfg.timeKey] || 0);
  }
  return cached || { ok: false, error: 'No cached data available.' };
}

/**
 * Save a daily snapshot for history tracking. Keeps last 90 days.
 * @param {'chat'|'api'} pipeline
 * @param {Object} response
 */
async function saveSnapshot(pipeline, response) {
  const cfg = PIPELINES[pipeline];
  const today = getDateString(new Date());
  const stored = await chrome.storage.local.get(cfg.historyKey);
  const history = stored[cfg.historyKey] || {};

  history[today] = {
    timestamp: Date.now(),
    usage: response.usage,
    rateLimit: response.rateLimit,
    billing: response.billing,
    limits: response.limits,
    organization: response.organization
  };

  // Prune entries older than 90 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = getDateString(cutoff);
  for (const date of Object.keys(history)) {
    if (date < cutoffStr) delete history[date];
  }

  await chrome.storage.local.set({ [cfg.historyKey]: history });
}

/**
 * Get history snapshots.
 * @param {'chat'|'api'} pipeline
 * @returns {Promise<Object>}
 */
async function getHistory(pipeline) {
  const cfg = PIPELINES[pipeline];
  const stored = await chrome.storage.local.get(cfg.historyKey);
  return { ok: true, history: stored[cfg.historyKey] || {} };
}
