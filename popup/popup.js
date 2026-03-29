/**
 * Popup script for Claude Usage Tracker.
 *
 * Two data pipelines rendered in separate tabs:
 * - Chat: claude.ai usage (percentage bars for 5h/7d utilization)
 * - API: platform.claude.com usage (tokens, model breakdown, rate limits)
 *
 * Data flow (each pipeline):
 *   popup → background → content script → API → back
 */

(() => {
  'use strict';

  let chatChart = null;
  let apiChart = null;
  let activeTab = 'chat';
  let lastApiData = null; // stored for filter re-renders

  // ─── Initialization ────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', () => {
    setupTabs();
    setupRefreshButton();
    setupDetailsToggle('chat-details-toggle', 'chat-details-body', 'chat-toggle-arrow');
    setupDetailsToggle('api-details-toggle', 'api-details-body', 'api-toggle-arrow');
    loadData();
  });

  // ─── Tab Switching ────────────────────────────────────────

  function setupTabs() {
    for (const btn of document.querySelectorAll('.tab-btn')) {
      btn.addEventListener('click', () => {
        document.querySelector('.tab-btn.active').classList.remove('active');
        btn.classList.add('active');
        activeTab = btn.dataset.section;
        document.getElementById('chat-section').classList.toggle('hidden', activeTab !== 'chat');
        document.getElementById('api-section').classList.toggle('hidden', activeTab !== 'api');
      });
    }
  }

  // ─── Data Loading ──────────────────────────────────────────

  async function loadData() {
    setStatus('Loading...');

    const [chatCached, apiCached] = await Promise.all([
      sendMessage({ type: 'POPUP_GET_CACHED' }),
      sendMessage({ type: 'POPUP_GET_CACHED_API' })
    ]);
    if (chatCached && chatCached.ok) renderChatData(chatCached);
    if (apiCached && apiCached.ok) renderApiData(apiCached);

    await refreshData();
  }

  async function refreshData() {
    setStatus('Fetching...');
    setRefreshSpinning(true);

    const [chatResult, apiResult] = await Promise.allSettled([
      sendMessage({ type: 'POPUP_FETCH_USAGE' }),
      sendMessage({ type: 'POPUP_FETCH_API_USAGE' })
    ]);

    // Handle chat result
    const chatData = chatResult.status === 'fulfilled' ? chatResult.value : null;
    if (chatData && chatData.ok) {
      renderChatData(chatData);
    } else if (chatData && chatData.error) {
      showTabError('chat', chatData.error);
    }

    // Handle API result
    const apiData = apiResult.status === 'fulfilled' ? apiResult.value : null;
    if (apiData && apiData.ok) {
      renderApiData(apiData);
    } else if (apiData && apiData.error) {
      showTabError('api', apiData.error);
    }

    updateStatus(chatData, apiData);
    setRefreshSpinning(false);

    await Promise.all([loadHistory('chat'), loadHistory('api')]);
  }

  function updateStatus(chatData, apiData) {
    const parts = [];
    if (chatData && chatData.ok) {
      parts.push('Chat: ' + formatTimeAgo(chatData.timestamp || Date.now()));
    } else if (chatData && chatData.error) {
      parts.push('Chat: failed');
    }
    if (apiData && apiData.ok) {
      parts.push('API: ' + formatTimeAgo(apiData.timestamp || Date.now()));
    } else if (apiData && apiData.error) {
      parts.push('API: failed');
    }
    setStatus(parts.length > 0 ? parts.join(' | ') : 'No data available');
  }

  // ─── Chat Rendering ──────────────────────────────────────

  function renderChatData(data) {
    document.getElementById('chat-error-card').classList.add('hidden');
    document.getElementById('chat-usage-section').classList.remove('hidden');

    // Plan badge
    const planBadge = document.getElementById('chat-plan-badge');
    const planName = extractPlanName(data);
    if (planName) {
      planBadge.textContent = planName;
      planBadge.classList.remove('hidden');
    }

    renderUsageBars('chat-usage-bars', extractChatUsageBars(data));
    renderChatRateLimits(data);
    renderDetails('chat-details-json', data);
  }

  function extractChatUsageBars(data) {
    const bars = [];

    // Primary: usage with { utilization, resets_at } entries
    if (data.usage) {
      for (const [key, val] of Object.entries(data.usage)) {
        if (typeof val === 'object' && val !== null && typeof val.utilization === 'number') {
          bars.push({
            label: formatUsageLabel(key),
            percentage: val.utilization,
            valueText: `${Math.round(val.utilization)}%`,
            detail: val.resets_at ? `Resets ${formatResetTime(val.resets_at)}` : null
          });
        }
      }
    }

    // Fallback: rateLimit shapes
    if (bars.length === 0 && data.rateLimit) {
      const rl = data.rateLimit;
      if (typeof rl.percentage_used === 'number') {
        bars.push({ label: 'Daily Usage', percentage: rl.percentage_used,
          valueText: `${Math.round(rl.percentage_used)}%`, detail: null });
      }
      if (typeof rl.remaining === 'number' && typeof rl.limit === 'number') {
        const used = rl.limit - rl.remaining;
        const pct = rl.limit > 0 ? (used / rl.limit) * 100 : 0;
        bars.push({ label: rl.type || 'Usage', percentage: pct,
          valueText: `${used} / ${rl.limit}`, detail: null });
      }
    }

    return bars;
  }

  function renderChatRateLimits(data) {
    const card = document.getElementById('chat-rate-limit-card');
    const body = document.getElementById('chat-rate-limit-body');
    if (!data.rateLimit && !data.usage) { card.classList.add('hidden'); return; }

    card.classList.remove('hidden');
    const info = data.rateLimit || data.usage || {};
    let html = '';

    const resetAt = info.reset_at || info.resetsAt || info.next_reset;
    if (resetAt) {
      html += `<div class="info-row">
        <span class="info-label">Resets</span>
        <span class="info-value">${escapeHtml(formatResetTime(resetAt))}</span>
      </div>`;
    }

    const interestingKeys = ['tier', 'plan', 'period', 'interval', 'model'];
    for (const [key, val] of Object.entries(info)) {
      if (interestingKeys.some(k => key.toLowerCase().includes(k)) && typeof val !== 'object') {
        html += `<div class="info-row">
          <span class="info-label">${escapeHtml(formatLabel(key))}</span>
          <span class="info-value">${escapeHtml(String(val))}</span>
        </div>`;
      }
    }

    if (html === '') { card.classList.add('hidden'); } else { body.innerHTML = html; }
  }

  // ─── API Rendering ────────────────────────────────────────

  function renderApiData(data) {
    lastApiData = data;
    document.getElementById('api-error-card').classList.add('hidden');
    document.getElementById('api-usage-section').classList.remove('hidden');

    // Plan badge
    const planBadge = document.getElementById('api-plan-badge');
    const planName = extractApiPlanName(data);
    if (planName) {
      planBadge.textContent = planName;
      planBadge.classList.remove('hidden');
    }

    setupApiFilters(data);
    renderFilteredApiData();
    renderApiRateLimits(data);
    renderDetails('api-details-json', data);
  }

  // ─── API Filters ─────────────────────────────────────────

  function setupApiFilters(data) {
    const filterBar = document.getElementById('api-filter-bar');
    const wsSelect = document.getElementById('api-filter-workspace');
    const keySelect = document.getElementById('api-filter-key');
    const usages = data.usage && data.usage.usages;

    if (!usages || Object.keys(usages).length === 0) {
      filterBar.classList.add('hidden');
      return;
    }

    // Collect unique workspaces and keys
    const workspaces = new Set();
    const keys = new Map(); // key_id → key_name
    for (const entries of Object.values(usages)) {
      for (const e of entries) {
        if (e.workspace_id) workspaces.add(e.workspace_id);
        if (e.key_id) keys.set(e.key_id, e.key_name || e.key_id);
      }
    }

    filterBar.classList.remove('hidden');

    // Populate workspace dropdown
    const prevWs = wsSelect.value;
    wsSelect.innerHTML = '<option value="all">All Workspaces</option>';
    for (const ws of workspaces) {
      const opt = document.createElement('option');
      opt.value = ws;
      opt.textContent = ws === 'default' ? 'Default' : ws;
      wsSelect.appendChild(opt);
    }
    wsSelect.value = prevWs && wsSelect.querySelector(`option[value="${prevWs}"]`) ? prevWs : 'all';

    // Populate key dropdown
    const prevKey = keySelect.value;
    keySelect.innerHTML = '<option value="all">All Keys</option>';
    for (const [id, name] of keys) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = name;
      keySelect.appendChild(opt);
    }
    keySelect.value = prevKey && keySelect.querySelector(`option[value="${prevKey}"]`) ? prevKey : 'all';

    // Wire up change handlers (remove old listeners by replacing elements)
    wsSelect.onchange = renderFilteredApiData;
    keySelect.onchange = renderFilteredApiData;
  }

  function getFilteredUsageEntries() {
    if (!lastApiData || !lastApiData.usage || !lastApiData.usage.usages) return [];
    const wsFilter = document.getElementById('api-filter-workspace').value;
    const keyFilter = document.getElementById('api-filter-key').value;

    const entries = [];
    for (const dayEntries of Object.values(lastApiData.usage.usages)) {
      for (const e of dayEntries) {
        if (wsFilter !== 'all' && e.workspace_id !== wsFilter) continue;
        if (keyFilter !== 'all' && e.key_id !== keyFilter) continue;
        entries.push(e);
      }
    }
    return entries;
  }

  function renderFilteredApiData() {
    const entries = getFilteredUsageEntries();
    renderApiUsageSummary(entries);
    renderApiModels(entries);
  }

  // ─── API Usage Summary ──────────────────────────────────

  function renderApiUsageSummary(entries) {
    const container = document.getElementById('api-usage-bars');

    if (entries.length === 0) {
      if (lastApiData && lastApiData.organization) {
        const org = lastApiData.organization;
        let html = infoRow('Status', 'Active');
        if (org.billing_type) html += infoRow('Billing', formatLabel(org.billing_type));
        if (org.free_credits_status) html += infoRow('Credits', formatLabel(org.free_credits_status));
        if (org.rate_limit_tier) html += infoRow('Tier', formatLabel(org.rate_limit_tier));
        container.innerHTML = html;
      } else {
        container.innerHTML = '<p class="muted">No usage data available.</p>';
      }
      return;
    }

    let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheWrite = 0, totalWebSearch = 0;
    for (const e of entries) {
      totalInput += (e.input || 0);
      totalOutput += (e.output || 0);
      totalCacheRead += (e.input_cache_read || 0);
      totalCacheWrite += (e.input_cache_write || 0) + (e.input_cache_write_1h || 0);
      totalWebSearch += (e.web_search_count || 0);
    }

    let html = infoRow('Input Tokens', formatTokens(totalInput));
    html += infoRow('Output Tokens', formatTokens(totalOutput));
    if (totalCacheRead > 0) html += infoRow('Cache Read', formatTokens(totalCacheRead));
    if (totalCacheWrite > 0) html += infoRow('Cache Write', formatTokens(totalCacheWrite));
    if (totalWebSearch > 0) html += infoRow('Web Searches', totalWebSearch.toLocaleString());

    if (lastApiData && lastApiData.organization) {
      const org = lastApiData.organization;
      if (org.billing_type) html += infoRow('Billing', formatLabel(org.billing_type));
      if (org.free_credits_status === 'available') html += infoRow('Credits', 'Available');
    }

    container.innerHTML = html;
  }

  function infoRow(label, value) {
    return `<div class="info-row">
      <span class="info-label">${escapeHtml(label)}</span>
      <span class="info-value">${escapeHtml(String(value))}</span>
    </div>`;
  }

  function renderApiModels(entries) {
    const card = document.getElementById('api-models-card');
    const body = document.getElementById('api-models-body');

    if (entries.length === 0) {
      card.classList.add('hidden');
      return;
    }

    // Aggregate actual usage per model
    const modelUsage = {};
    for (const e of entries) {
      const name = e.model_name || 'Unknown';
      if (!modelUsage[name]) modelUsage[name] = { input: 0, output: 0, cacheRead: 0 };
      modelUsage[name].input += (e.input || 0);
      modelUsage[name].output += (e.output || 0);
      modelUsage[name].cacheRead += (e.input_cache_read || 0);
    }

    const models = Object.entries(modelUsage);
    if (models.length === 0) { card.classList.add('hidden'); return; }

    card.classList.remove('hidden');
    let html = `<table class="model-table">
      <thead><tr><th>Model</th><th>Input</th><th>Output</th></tr></thead><tbody>`;
    for (const [name, usage] of models) {
      const displayName = escapeHtml(formatModelName(name));
      html += `<tr><td>${displayName}</td><td class="numeric">${escapeHtml(formatTokens(usage.input))}</td><td class="numeric">${escapeHtml(formatTokens(usage.output))}</td></tr>`;
    }
    html += '</tbody></table>';
    body.innerHTML = html;
  }

  function formatModelName(name) {
    // "claude-sonnet-4-20250514" → "Claude Sonnet 4"
    return name.replace(/-\d{8}$/, '').replace(/^claude-/, 'Claude ').replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  function renderApiRateLimits(data) {
    const card = document.getElementById('api-rate-limit-card');
    const body = document.getElementById('api-rate-limit-body');
    const rateLimits = data.rateLimits && data.rateLimits.rate_limits;

    if (!rateLimits || typeof rateLimits !== 'object' || Object.keys(rateLimits).length === 0) {
      card.classList.add('hidden');
      return;
    }

    card.classList.remove('hidden');
    let html = '';
    for (const [model, limits] of Object.entries(rateLimits)) {
      if (!Array.isArray(limits)) continue;
      const visibleLimits = limits.filter(l => l.value > 0);
      if (visibleLimits.length === 0) continue;
      html += `<div class="rate-limit-group">
        <div class="rate-limit-model">${escapeHtml(formatLabel(model))}</div>`;
      for (const lim of visibleLimits) {
        html += `<div class="info-row">
          <span class="info-label">${escapeHtml(formatRateLimitType(lim.type))}</span>
          <span class="info-value">${escapeHtml(formatRateLimitValue(lim.type, lim.value))}</span>
        </div>`;
      }
      html += '</div>';
    }
    if (html === '') { card.classList.add('hidden'); } else { body.innerHTML = html; }
  }

  function formatRateLimitType(type) {
    return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      .replace('Per Minute', '/min').replace('Per Second', '/sec');
  }

  function formatRateLimitValue(type, value) {
    if (type.includes('tokens')) return formatTokens(value);
    return value.toLocaleString();
  }

  function extractApiPlanName(data) {
    if (data.organization) {
      const org = data.organization;
      if (org.billing_type) return formatLabel(org.billing_type);
      if (org.rate_limit_tier) return formatLabel(org.rate_limit_tier);
    }
    return null;
  }

  // ─── Shared Rendering ─────────────────────────────────────

  function renderUsageBars(containerId, bars) {
    const container = document.getElementById(containerId);
    let html = '';
    if (bars.length === 0) {
      html = '<p class="muted">No usage data available.</p>';
    }
    for (const bar of bars) {
      const pct = Math.min(100, Math.max(0, bar.percentage));
      const colorClass = pct >= 90 ? 'bar-danger' : pct >= 70 ? 'bar-warning' : 'bar-ok';
      html += `
        <div class="usage-bar-group">
          <div class="usage-bar-header">
            <span class="usage-bar-label">${escapeHtml(bar.label)}</span>
            <span class="usage-bar-value">${escapeHtml(bar.valueText)}</span>
          </div>
          <div class="usage-bar-track">
            <div class="usage-bar-fill ${colorClass}" style="width: ${pct}%"></div>
          </div>
          ${bar.detail ? `<div class="usage-bar-detail">${escapeHtml(bar.detail)}</div>` : ''}
        </div>`;
    }
    container.innerHTML = html;
  }

  function renderDetails(elementId, data) {
    const filtered = {};
    for (const key of ['organization', 'usage', 'rateLimit', 'rateLimits', 'rateLimitActivities',
      'models', 'maxMinuteUsage', 'workspaces', 'cost', 'limits']) {
      if (data[key]) filtered[key] = data[key];
    }
    document.getElementById(elementId).textContent = JSON.stringify(filtered, null, 2);
  }

  // ─── History Charts ───────────────────────────────────────

  async function loadHistory(tab) {
    const msgType = tab === 'chat' ? 'POPUP_GET_HISTORY' : 'POPUP_GET_API_HISTORY';
    const result = await sendMessage({ type: msgType });
    const history = (result && result.history) || {};
    const dates = Object.keys(history).sort();

    if (!result || !result.ok || dates.length === 0) {
      document.getElementById(`${tab}-history-section`).classList.add('hidden');
      if (tab === 'chat' && chatChart) { chatChart.destroy(); chatChart = null; }
      if (tab === 'api' && apiChart) { apiChart.destroy(); apiChart = null; }
      return;
    }

    document.getElementById(`${tab}-history-section`).classList.remove('hidden');

    if (tab === 'chat' && chatChart) { chatChart.destroy(); chatChart = null; }
    if (tab === 'api' && apiChart) { apiChart.destroy(); apiChart = null; }

    const labels = dates.map(d => {
      const parts = d.split('-');
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${months[parseInt(parts[1]) - 1]} ${parseInt(parts[2])}`;
    });

    const dataPoints = dates.map(d => extractSnapshotValue(history[d], tab));
    const singlePoint = dataPoints.length === 1;

    const ctx = document.getElementById(`${tab}-history-chart`).getContext('2d');
    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: tab === 'chat' ? 'Usage %' : 'Usage',
          data: dataPoints,
          borderColor: '#d97706',
          backgroundColor: 'rgba(217, 119, 6, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: singlePoint ? 4 : 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { font: { size: 9 }, maxRotation: 45 } },
          y: {
            beginAtZero: true,
            max: tab === 'chat' ? 100 : undefined,
            title: { display: true, text: tab === 'chat' ? 'Usage %' : 'Usage', font: { size: 10 } },
            ticks: { font: { size: 9 } }
          }
        }
      }
    });

    if (tab === 'chat') chatChart = chart; else apiChart = chart;
  }

  function extractSnapshotValue(snap, tab) {
    if (!snap) return 0;
    if (tab === 'chat') return extractChatHistoryPercent(snap);
    return extractApiHistoryValue(snap);
  }

  function extractChatHistoryPercent(snap) {
    const usage = snap.usage || {};
    const candidates = [];

    // Prefer known windows first, then include any additional utilization windows.
    for (const key of ['five_hour', 'seven_day']) {
      const val = usage[key];
      if (val && typeof val.utilization === 'number' && Number.isFinite(val.utilization)) {
        candidates.push(val.utilization);
      }
    }
    for (const val of Object.values(usage)) {
      if (typeof val === 'object' && val !== null &&
          typeof val.utilization === 'number' && Number.isFinite(val.utilization)) {
        candidates.push(val.utilization);
      }
    }

    // Fallback for responses that only expose rate_limit_status.
    const rl = snap.rateLimit || {};
    if (typeof rl.percentage_used === 'number' && Number.isFinite(rl.percentage_used)) {
      candidates.push(rl.percentage_used);
    } else if (typeof rl.remaining === 'number' && Number.isFinite(rl.remaining) &&
               typeof rl.limit === 'number' && Number.isFinite(rl.limit) && rl.limit > 0) {
      const pct = ((rl.limit - rl.remaining) / rl.limit) * 100;
      candidates.push(pct);
    }

    if (candidates.length === 0) return 0;
    return clampPercent(Math.max(...candidates));
  }

  function extractApiHistoryValue(snap) {
    const usage = snap.usage || {};
    const billing = snap.billing || {};
    if (billing.spend && typeof billing.spend.current === 'number' && Number.isFinite(billing.spend.current)) {
      return billing.spend.current;
    }
    for (const val of Object.values(usage)) {
      if (typeof val === 'object' && val !== null &&
          typeof val.utilization === 'number' && Number.isFinite(val.utilization)) {
        return val.utilization;
      }
    }
    return 0;
  }

  function clampPercent(value) {
    return Math.min(100, Math.max(0, value));
  }

  // ─── UI Helpers ────────────────────────────────────────────

  function setupRefreshButton() {
    document.getElementById('refresh-btn').addEventListener('click', refreshData);
  }

  function setupDetailsToggle(toggleId, bodyId, arrowId) {
    document.getElementById(toggleId).addEventListener('click', () => {
      const body = document.getElementById(bodyId);
      const arrow = document.getElementById(arrowId);
      body.classList.toggle('hidden');
      arrow.textContent = body.classList.contains('hidden') ? '\u25B6' : '\u25BC';
    });
  }

  function setStatus(text) {
    document.getElementById('status-text').textContent = text;
  }

  function setRefreshSpinning(spinning) {
    const btn = document.getElementById('refresh-btn');
    btn.classList.toggle('spinning', spinning);
    btn.disabled = spinning;
  }

  function showTabError(tab, msg) {
    const card = document.getElementById(`${tab}-error-card`);
    const text = document.getElementById(`${tab}-error-text`);
    card.classList.remove('hidden');
    text.textContent = msg;
  }

  // ─── Formatting Helpers ────────────────────────────────────

  function formatTimeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return Math.floor(diff / 86400000) + 'd ago';
  }

  function formatResetTime(resetAt) {
    try {
      const d = new Date(resetAt);
      if (isNaN(d.getTime())) return String(resetAt);
      const diffMs = d - new Date();
      if (diffMs < 0) return 'now';
      if (diffMs < 3600000) return `in ${Math.ceil(diffMs / 60000)}m`;
      if (diffMs < 86400000) return `in ${Math.ceil(diffMs / 3600000)}h`;
      return d.toLocaleDateString();
    } catch (e) {
      return String(resetAt);
    }
  }

  function formatLabel(key) {
    return key.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function formatUsageLabel(key) {
    const wordToNum = { one: '1', two: '2', three: '3', four: '4', five: '5',
      six: '6', seven: '7', eight: '8', nine: '9', ten: '10', twelve: '12',
      twenty_four: '24', thirty: '30' };
    let label = key;
    for (const [word, num] of Object.entries(wordToNum)) {
      if (label.startsWith(word + '_')) {
        label = num + '_' + label.slice(word.length + 1);
        break;
      }
    }
    return label.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Messaging ─────────────────────────────────────────────

  function sendMessage(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (response) => { resolve(response); });
    });
  }

})();
