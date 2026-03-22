/**
 * Background service worker for Claude Usage Tracker.
 *
 * Self-contained (no importScripts).
 *
 * Responsibilities:
 * - Relay FETCH_USAGE requests from popup to the content script
 * - Cache usage data in chrome.storage.local
 * - Store daily usage snapshots for trend tracking
 * - Periodically refresh usage data via alarm
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
  // Only accept messages from this extension
  if (sender.id !== chrome.runtime.id) return false;

  handleMessage(message, sender).then(sendResponse);
  return true;
});

async function handleMessage(message, sender) {
  switch (message.type) {

    case 'ORG_ID_DISCOVERED':
      // Validate org ID format before storing
      if (!message.orgId || !ORG_ID_PATTERN.test(message.orgId)) {
        return { ok: false, error: 'Invalid org ID format' };
      }
      await chrome.storage.local.set({ orgId: message.orgId });
      return { ok: true };

    case 'POPUP_FETCH_USAGE':
      return await fetchUsageViaContentScript();

    case 'POPUP_GET_CACHED':
      return await getCachedUsageData();

    case 'POPUP_GET_HISTORY':
      return await getUsageHistory();

    default:
      return { ok: false, error: 'Unknown message type' };
  }
}

// ═══════════════════════════════════════════════════════════════
// Alarm: Periodic Refresh
// ═══════════════════════════════════════════════════════════════

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== REFRESH_ALARM) return;
  await fetchUsageViaContentScript();
});

// ═══════════════════════════════════════════════════════════════
// Data Management
// ═══════════════════════════════════════════════════════════════

/**
 * Ask the content script on an active claude.ai tab to fetch usage data.
 * If the content script isn't loaded, injects it programmatically.
 * @returns {Promise<Object>}
 */
async function fetchUsageViaContentScript() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
    if (tabs.length === 0) {
      const cached = await getCachedUsageData();
      if (cached && cached.ok) return cached;
      return { ok: false, error: 'No claude.ai tab open. Open claude.ai to fetch usage data.' };
    }

    const tabId = tabs[0].id;
    let response;

    try {
      response = await chrome.tabs.sendMessage(tabId, { type: 'FETCH_USAGE' });
    } catch (e) {
      // Content script not loaded — inject and retry
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content/content-script.js']
        });
        await new Promise(r => setTimeout(r, 500));
        response = await chrome.tabs.sendMessage(tabId, { type: 'FETCH_USAGE' });
      } catch (retryErr) {
        return { ok: false, error: 'Could not reach claude.ai. Try refreshing the page.' };
      }
    }

    if (response && response.ok) {
      await chrome.storage.local.set({
        cachedUsage: response,
        lastFetchTime: Date.now()
      });
      await saveUsageSnapshot(response);
    }
    return response || { ok: false, error: 'No response from content script' };
  } catch (e) {
    return { ok: false, error: 'Could not reach claude.ai. Try refreshing the page.' };
  }
}

/**
 * Get cached usage data from storage.
 * @returns {Promise<Object>}
 */
async function getCachedUsageData() {
  const { cachedUsage, lastFetchTime } = await chrome.storage.local.get(['cachedUsage', 'lastFetchTime']);
  if (cachedUsage) {
    cachedUsage.fromCache = true;
    cachedUsage.cacheAge = Date.now() - (lastFetchTime || 0);
  }
  return cachedUsage || { ok: false, error: 'No cached data. Open claude.ai to fetch usage.' };
}

/**
 * Save a daily usage snapshot for history tracking.
 * Keeps last 90 days.
 * @param {Object} usageResponse
 */
async function saveUsageSnapshot(usageResponse) {
  const today = getDateString(new Date());
  const { usageHistory = {} } = await chrome.storage.local.get('usageHistory');

  usageHistory[today] = {
    timestamp: Date.now(),
    usage: usageResponse.usage,
    rateLimit: usageResponse.rateLimit,
    organization: usageResponse.organization
  };

  // Prune entries older than 90 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = getDateString(cutoff);
  for (const date of Object.keys(usageHistory)) {
    if (date < cutoffStr) delete usageHistory[date];
  }

  await chrome.storage.local.set({ usageHistory });
}

/**
 * Get usage history snapshots.
 * @returns {Promise<Object>}
 */
async function getUsageHistory() {
  const { usageHistory = {} } = await chrome.storage.local.get('usageHistory');
  return { ok: true, history: usageHistory };
}
