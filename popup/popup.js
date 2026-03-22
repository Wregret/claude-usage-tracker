/**
 * Popup script for Claude Usage Tracker.
 *
 * Two data pipelines rendered in separate tabs:
 * - Chat: claude.ai usage (percentage bars for 5h/7d utilization)
 * - API: console.anthropic.com usage (spend, model breakdown)
 *
 * Data flow (each pipeline):
 *   popup → background → content script → API → back
 */

(() => {
  'use strict';

  let chatChart = null;
  let apiChart = null;
  let activeTab = 'chat';

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
    }
    if (apiData && apiData.ok) {
      parts.push('API: ' + formatTimeAgo(apiData.timestamp || Date.now()));
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
    document.getElementById('api-error-card').classList.add('hidden');
    document.getElementById('api-usage-section').classList.remove('hidden');

    // Plan badge
    const planBadge = document.getElementById('api-plan-badge');
    const planName = extractApiPlanName(data);
    if (planName) {
      planBadge.textContent = planName;
      planBadge.classList.remove('hidden');
    }

    renderUsageBars('api-usage-bars', extractApiUsageBars(data));
    renderApiModels(data);
    renderApiRateLimits(data);
    renderDetails('api-details-json', data);
  }

  function extractApiUsageBars(data) {
    const bars = [];

    // Spend-based: { current, limit } or { used, limit } or { spend, cap }
    const billing = data.billing || data.usage || {};

    if (billing.spend && typeof billing.spend === 'object') {
      const s = billing.spend;
      const current = s.current || s.used || 0;
      const limit = s.limit || s.cap || s.monthly_limit || 0;
      if (limit > 0) {
        bars.push({ label: s.period || 'Monthly Spend', percentage: (current / limit) * 100,
          valueText: `${formatCurrency(current)} / ${formatCurrency(limit)}`, detail: null });
      } else {
        bars.push({ label: 'Spend', percentage: 0,
          valueText: formatCurrency(current), detail: 'No spending limit set' });
      }
    }

    // Utilization-based (same shape as chat)
    if (bars.length === 0) {
      for (const [key, val] of Object.entries(billing)) {
        if (typeof val === 'object' && val !== null && typeof val.utilization === 'number') {
          bars.push({ label: formatUsageLabel(key), percentage: val.utilization,
            valueText: `${Math.round(val.utilization)}%`,
            detail: val.resets_at ? `Resets ${formatResetTime(val.resets_at)}` : null });
        }
      }
    }

    // Generic: walk for { used, limit }
    if (bars.length === 0) {
      for (const [key, val] of Object.entries(billing)) {
        if (typeof val === 'object' && val !== null && 'used' in val && 'limit' in val) {
          const pct = val.limit > 0 ? (val.used / val.limit) * 100 : 0;
          bars.push({ label: formatLabel(key), percentage: pct,
            valueText: `${val.used} / ${val.limit}`, detail: null });
        }
      }
    }

    return bars;
  }

  function renderApiModels(data) {
    const card = document.getElementById('api-models-card');
    const body = document.getElementById('api-models-body');
    const billing = data.billing || data.usage || {};
    const models = billing.models || billing.by_model || billing.model_usage;

    if (!Array.isArray(models) || models.length === 0) {
      card.classList.add('hidden');
      return;
    }

    card.classList.remove('hidden');
    let html = `<table class="model-table">
      <thead><tr><th>Model</th><th>Input</th><th>Output</th><th>Cost</th></tr></thead><tbody>`;
    for (const m of models) {
      const name = escapeHtml(m.name || m.model || 'Unknown');
      const input = m.input_tokens != null ? formatTokens(m.input_tokens) : '-';
      const output = m.output_tokens != null ? formatTokens(m.output_tokens) : '-';
      const cost = m.cost != null ? formatCurrency(m.cost) : '-';
      html += `<tr><td>${name}</td><td class="numeric">${input}</td><td class="numeric">${output}</td><td class="numeric">${cost}</td></tr>`;
    }
    html += '</tbody></table>';
    body.innerHTML = html;
  }

  function renderApiRateLimits(data) {
    const card = document.getElementById('api-rate-limit-card');
    const body = document.getElementById('api-rate-limit-body');
    const limits = data.limits || data.rateLimit || {};

    if (!limits || typeof limits !== 'object' || Object.keys(limits).length === 0) {
      card.classList.add('hidden');
      return;
    }

    card.classList.remove('hidden');
    let html = '';
    for (const [key, val] of Object.entries(limits)) {
      if (typeof val !== 'object') {
        html += `<div class="info-row">
          <span class="info-label">${escapeHtml(formatLabel(key))}</span>
          <span class="info-value">${escapeHtml(String(val))}</span>
        </div>`;
      }
    }
    if (html === '') { card.classList.add('hidden'); } else { body.innerHTML = html; }
  }

  function extractApiPlanName(data) {
    if (data.organization) {
      const org = data.organization;
      if (org.plan) return typeof org.plan === 'string' ? org.plan : org.plan.name || null;
      if (org.tier) return org.tier;
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
    for (const key of ['organization', 'usage', 'rateLimit', 'billing', 'limits', 'settings']) {
      if (data[key]) filtered[key] = data[key];
    }
    document.getElementById(elementId).textContent = JSON.stringify(filtered, null, 2);
  }

  // ─── History Charts ───────────────────────────────────────

  async function loadHistory(tab) {
    const msgType = tab === 'chat' ? 'POPUP_GET_HISTORY' : 'POPUP_GET_API_HISTORY';
    const result = await sendMessage({ type: msgType });
    if (!result || !result.ok || Object.keys(result.history || {}).length < 2) {
      document.getElementById(`${tab}-history-section`).classList.add('hidden');
      return;
    }

    document.getElementById(`${tab}-history-section`).classList.remove('hidden');

    if (tab === 'chat' && chatChart) { chatChart.destroy(); chatChart = null; }
    if (tab === 'api' && apiChart) { apiChart.destroy(); apiChart = null; }

    const dates = Object.keys(result.history).sort();
    const labels = dates.map(d => {
      const parts = d.split('-');
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${months[parseInt(parts[1]) - 1]} ${parseInt(parts[2])}`;
    });

    const dataPoints = dates.map(d => extractSnapshotValue(result.history[d], tab));

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
          tension: 0.3
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
    const u = snap.usage || {};

    // Chat: utilization percentage
    if (tab === 'chat') {
      if (u.five_hour && typeof u.five_hour.utilization === 'number') return u.five_hour.utilization;
      for (const val of Object.values(u)) {
        if (typeof val === 'object' && val !== null && typeof val.utilization === 'number') return val.utilization;
      }
    }

    // API: spend or utilization
    const billing = snap.billing || {};
    if (billing.spend && typeof billing.spend.current === 'number') return billing.spend.current;
    for (const val of Object.values(u)) {
      if (typeof val === 'object' && val !== null && typeof val.utilization === 'number') return val.utilization;
    }

    return 0;
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
    // Only show error if no data is already visible
    if (document.getElementById(`${tab}-usage-section`).classList.contains('hidden')) {
      card.classList.remove('hidden');
      text.textContent = msg;
    }
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
