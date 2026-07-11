/**
 * Background service worker for Claude Usage Tracker.
 *
 * Self-contained (no importScripts).
 *
 * Two parallel data pipelines:
 * - Chat usage: claude.ai internal API
 * - API usage:  platform.claude.com internal API
 *
 * Fetch strategy: the service worker fetches the APIs directly using the
 * user's session cookies (host permissions grant credentialed requests),
 * so no tab needs to be open. If a direct fetch fails (e.g. bot
 * protection), it falls back to messaging a content script in an open tab.
 */

// ═══════════════════════════════════════════════════════════════
// Utilities
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
const HISTORY_DAYS = 90;

chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_INTERVAL_MIN });

// Restore badge from cache when the service worker wakes up
chrome.storage.local.get('cachedUsage').then(({ cachedUsage }) => {
  if (cachedUsage && cachedUsage.ok) updateBadge(cachedUsage);
});

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
      return await fetchUsage('chat');

    case 'POPUP_GET_CACHED':
      return await getCached('chat');

    case 'POPUP_GET_HISTORY':
      return await getHistory('chat');

    // ─── API (platform.claude.com) ──────────────────
    case 'API_ORG_ID_DISCOVERED':
      if (!message.orgId || !ORG_ID_PATTERN.test(message.orgId)) {
        return { ok: false, error: 'Invalid org ID format' };
      }
      await chrome.storage.local.set({ apiOrgId: message.orgId });
      return { ok: true };

    case 'POPUP_FETCH_API_USAGE':
      return await fetchUsage('api');

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
    fetchUsage('chat'),
    fetchUsage('api')
  ]);
});

// ═══════════════════════════════════════════════════════════════
// Pipeline Configuration
// ═══════════════════════════════════════════════════════════════

const PIPELINES = {
  chat: {
    origin: 'https://claude.ai',
    tabUrl: 'https://claude.ai/*',
    messageType: 'FETCH_USAGE',
    scriptFile: 'content/content-script.js',
    orgIdKey: 'orgId',
    cacheKey: 'cachedUsage',
    timeKey: 'lastFetchTime',
    historyKey: 'usageHistory',
    loginError: 'Not logged in. Open claude.ai and sign in, then refresh.',
  },
  api: {
    origin: 'https://platform.claude.com',
    tabUrl: 'https://platform.claude.com/*',
    messageType: 'FETCH_API_USAGE',
    scriptFile: 'content/console-content-script.js',
    orgIdKey: 'apiOrgId',
    cacheKey: 'cachedApiUsage',
    timeKey: 'lastApiFetchTime',
    historyKey: 'apiUsageHistory',
    loginError: 'Not logged in. Open platform.claude.com and sign in, then refresh.',
  }
};

// ═══════════════════════════════════════════════════════════════
// Fetching (direct-first, content-script fallback)
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch usage data for a pipeline, cache it, and record history.
 * @param {'chat'|'api'} pipeline
 * @returns {Promise<Object>}
 */
async function fetchUsage(pipeline) {
  let response = await fetchDirect(pipeline);

  if (!response || !response.ok) {
    const fallback = await fetchViaContentScript(pipeline);
    // Prefer whichever response carries the most useful error/data
    if (fallback && fallback.ok) {
      response = fallback;
    } else if (!response || (!response.error && fallback && fallback.error)) {
      response = fallback;
    }
  }

  if (response && response.ok) {
    await chrome.storage.local.set({
      [PIPELINES[pipeline].cacheKey]: response,
      [PIPELINES[pipeline].timeKey]: Date.now()
    });
    await saveSnapshot(pipeline, response);
    if (pipeline === 'chat') updateBadge(response);
  }
  return response || { ok: false, error: 'Could not fetch usage data.' };
}

/**
 * Fetch a JSON endpoint with session cookies. Null on any failure.
 * @param {string} url
 * @returns {Promise<{data: Object|null, status: number}>}
 */
async function safeFetch(url) {
  try {
    const resp = await fetch(url, {
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    });
    const contentType = resp.headers.get('content-type') || '';
    if (!resp.ok || !contentType.includes('json')) {
      return { data: null, status: resp.status };
    }
    return { data: await resp.json(), status: resp.status };
  } catch (e) {
    return { data: null, status: 0 };
  }
}

/**
 * Discover org ID by fetching the organizations list directly.
 * @param {'chat'|'api'} pipeline
 * @returns {Promise<{orgId: string|null, status: number}>}
 */
async function discoverOrgIdDirect(pipeline) {
  const cfg = PIPELINES[pipeline];

  const stored = await chrome.storage.local.get(cfg.orgIdKey);
  if (stored[cfg.orgIdKey]) return { orgId: stored[cfg.orgIdKey], status: 200 };

  const { data, status } = await safeFetch(`${cfg.origin}/api/organizations`);
  if (!data) return { orgId: null, status };

  let org = null;
  if (Array.isArray(data) && data.length > 0) {
    if (pipeline === 'api') {
      org = data.find(o =>
        Array.isArray(o.capabilities) && o.capabilities.some(c => c.includes('api'))
      ) || data[0];
    } else {
      org = data.find(o =>
        Array.isArray(o.capabilities) && o.capabilities.some(c => c.includes('chat'))
      ) || data[0];
    }
  } else if (data.uuid || data.id) {
    org = data;
  }

  const orgId = org ? (org.uuid || org.id || null) : null;
  if (orgId && ORG_ID_PATTERN.test(orgId)) {
    await chrome.storage.local.set({ [cfg.orgIdKey]: orgId });
    return { orgId, status };
  }
  return { orgId: null, status };
}

/**
 * Fetch usage data directly from the service worker.
 * @param {'chat'|'api'} pipeline
 * @returns {Promise<Object>}
 */
async function fetchDirect(pipeline) {
  const cfg = PIPELINES[pipeline];
  const result = { ok: false, source: 'direct', orgId: null, error: null, timestamp: Date.now() };

  const { orgId, status } = await discoverOrgIdDirect(pipeline);
  if (!orgId) {
    result.error = (status === 401 || status === 403)
      ? cfg.loginError
      : 'Could not reach ' + cfg.origin.replace('https://', '') + '.';
    return result;
  }
  result.orgId = orgId;

  const endpoints = pipeline === 'chat'
    ? [
        { key: 'organization', path: `${cfg.origin}/api/organizations/${orgId}` },
        { key: 'usage', path: `${cfg.origin}/api/organizations/${orgId}/usage` },
        { key: 'rateLimit', path: `${cfg.origin}/api/organizations/${orgId}/rate_limit_status` },
        { key: 'settings', path: `${cfg.origin}/api/organizations/${orgId}/settings` },
      ]
    : buildApiEndpoints(cfg.origin, orgId);

  const results = await Promise.allSettled(
    endpoints.map(ep => safeFetch(ep.path).then(r => ({ key: ep.key, ...r })))
  );

  let sawAuthFailure = false;
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    if (r.value.status === 401 || r.value.status === 403) sawAuthFailure = true;
    if (r.value.data) result[r.value.key] = r.value.data;
  }

  result.ok = !!(result.usage || result.rateLimit || result.rateLimits ||
                 result.organization || result.cost || result.limits);
  if (!result.ok) {
    result.error = sawAuthFailure
      ? cfg.loginError
      : 'Could not fetch usage data directly.';
    if (sawAuthFailure) {
      // Stored org ID may belong to a stale session; rediscover next time
      await chrome.storage.local.remove(cfg.orgIdKey);
    }
  }
  return result;
}

function buildApiEndpoints(origin, orgId) {
  // Date range: first day of current month → day after tomorrow (timezone buffer)
  const now = new Date();
  const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const endDate = getDateString(new Date(now.getTime() + 2 * 86400000));
  const dateParams = `starting_on=${startDate}&ending_before=${endDate}`;

  return [
    { key: 'organization', path: `${origin}/api/organizations/${orgId}` },
    { key: 'usage', path: `${origin}/api/organizations/${orgId}/usage_activities?${dateParams}` },
    { key: 'rateLimits', path: `${origin}/api/organizations/${orgId}/rate_limits_v2` },
    { key: 'rateLimitActivities', path: `${origin}/api/organizations/${orgId}/rate_limit_activities?${dateParams}` },
    { key: 'models', path: `${origin}/api/organizations/${orgId}/models` },
    { key: 'maxMinuteUsage', path: `${origin}/api/organizations/${orgId}/max_minute_usage_activities?${dateParams}` },
    { key: 'workspaces', path: `${origin}/api/console/organizations/${orgId}/workspaces` },
  ];
}

/**
 * Fallback: fetch via a content script in an open tab.
 * @param {'chat'|'api'} pipeline
 * @returns {Promise<Object|null>}
 */
async function fetchViaContentScript(pipeline) {
  const cfg = PIPELINES[pipeline];
  try {
    const tabs = await chrome.tabs.query({ url: cfg.tabUrl });
    // Prefer active, loaded tabs; discarded tabs can't run content scripts
    const usable = tabs.filter(t => !t.discarded);
    if (usable.length === 0) return null;
    const tab = usable.find(t => t.active) || usable[0];

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { type: cfg.messageType });
    } catch (e) {
      // Content script not loaded — inject and retry
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: [cfg.scriptFile]
        });
        await new Promise(r => setTimeout(r, 500));
        response = await chrome.tabs.sendMessage(tab.id, { type: cfg.messageType });
      } catch (retryErr) {
        return { ok: false, error: 'Could not reach the page. Try refreshing it.' };
      }
    }
    return response || null;
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// Badge
// ═══════════════════════════════════════════════════════════════

/**
 * Show the highest chat utilization percentage on the extension icon.
 * @param {Object} response - successful chat fetch response
 */
function updateBadge(response) {
  const windows = extractUtilizationWindows(response.usage);
  const values = Object.values(windows);

  // Fallback to rate_limit_status percentage
  const rl = response.rateLimit;
  if (values.length === 0 && rl && typeof rl.percentage_used === 'number') {
    values.push(rl.percentage_used);
  }

  if (values.length === 0) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  const pct = Math.round(Math.min(100, Math.max(0, Math.max(...values))));
  const color = pct >= 90 ? '#dc2626' : pct >= 70 ? '#d97706' : '#16a34a';
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text: `${pct}%` });
}

// ═══════════════════════════════════════════════════════════════
// Usage Parsing
// ═══════════════════════════════════════════════════════════════

/**
 * Extract all utilization windows from a chat usage response.
 * Scans generically (including one nested level) so windows added by
 * Claude in the future are picked up automatically.
 * @param {Object|null} usage
 * @returns {Object} { windowKey: utilizationPercent }
 */
function extractUtilizationWindows(usage) {
  const windows = {};
  if (!usage || typeof usage !== 'object') return windows;

  const visit = (obj, prefix) => {
    for (const [key, val] of Object.entries(obj)) {
      if (!val || typeof val !== 'object') continue;
      if (typeof val.utilization === 'number' && Number.isFinite(val.utilization)) {
        windows[prefix ? `${prefix}.${key}` : key] = val.utilization;
      } else if (!prefix) {
        visit(val, key);
      }
    }
  };
  visit(usage, '');
  return windows;
}

// ═══════════════════════════════════════════════════════════════
// Cache & History
// ═══════════════════════════════════════════════════════════════

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
 * Record history for the trend charts. Compact by design:
 *
 * Chat:  history[date] = { timestamp, windows: {key: maxUtilization%} }
 *        Keeps the daily MAX per window so a low reading late in the
 *        day doesn't erase the real peak.
 *
 * API:   history[date] = { timestamp, tokens: {input, output, total} }
 *        Derived per-date from the month's usage_activities, so every
 *        day in the response gets a true daily total.
 *
 * @param {'chat'|'api'} pipeline
 * @param {Object} response
 */
async function saveSnapshot(pipeline, response) {
  const cfg = PIPELINES[pipeline];
  const stored = await chrome.storage.local.get(cfg.historyKey);
  const history = stored[cfg.historyKey] || {};

  if (pipeline === 'chat') {
    const today = getDateString(new Date());
    const windows = extractUtilizationWindows(response.usage);
    const rl = response.rateLimit;
    if (Object.keys(windows).length === 0 && rl && typeof rl.percentage_used === 'number') {
      windows.rate_limit = rl.percentage_used;
    }
    if (Object.keys(windows).length > 0) {
      const prev = (history[today] && history[today].windows) || {};
      const merged = { ...prev };
      for (const [key, val] of Object.entries(windows)) {
        merged[key] = Math.max(prev[key] || 0, val);
      }
      history[today] = { timestamp: Date.now(), windows: merged };
    }
  } else {
    const usages = response.usage && response.usage.usages;
    if (usages && typeof usages === 'object') {
      for (const [date, entries] of Object.entries(usages)) {
        if (!Array.isArray(entries) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        let input = 0, output = 0;
        for (const e of entries) {
          input += (e.input || 0) + (e.input_cache_read || 0) +
                   (e.input_cache_write || 0) + (e.input_cache_write_1h || 0);
          output += (e.output || 0);
        }
        history[date] = { timestamp: Date.now(), tokens: { input, output, total: input + output } };
      }
    }
  }

  // Prune entries older than the retention window
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - HISTORY_DAYS);
  const cutoffStr = getDateString(cutoff);
  for (const date of Object.keys(history)) {
    if (date < cutoffStr) delete history[date];
  }

  await chrome.storage.local.set({ [cfg.historyKey]: history });
}

async function getHistory(pipeline) {
  const cfg = PIPELINES[pipeline];
  const stored = await chrome.storage.local.get(cfg.historyKey);
  return { ok: true, history: stored[cfg.historyKey] || {} };
}
