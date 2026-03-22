/**
 * Popup script for Claude Usage Tracker.
 *
 * Displays usage data fetched from claude.ai's internal API:
 * - Usage percentage bar(s) — the primary feature
 * - Rate limit status
 * - Usage history chart
 * - Raw JSON details (collapsible)
 *
 * Data flow:
 *   popup → background (POPUP_FETCH_USAGE) → content script (FETCH_USAGE)
 *   → content script fetches claude.ai API → data flows back
 */

(() => {
  'use strict';

  let historyChart = null;

  // ─── Initialization ────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', () => {
    setupRefreshButton();
    setupDetailsToggle();
    loadData();
  });

  // ─── Data Loading ──────────────────────────────────────────

  /**
   * Load usage data: show cached first, then fetch fresh.
   */
  async function loadData() {
    setStatus('Loading cached data...');

    // Show cached data immediately if available
    const cached = await sendMessage({ type: 'POPUP_GET_CACHED' });
    if (cached && cached.ok) {
      renderUsageData(cached);
    }

    // Then fetch fresh data
    await refreshData();
  }

  /**
   * Fetch fresh usage data from the content script.
   */
  async function refreshData() {
    setStatus('Fetching from claude.ai...');
    setRefreshSpinning(true);

    try {
      const data = await sendMessage({ type: 'POPUP_FETCH_USAGE' });
      if (data && data.ok) {
        renderUsageData(data);
        setStatus('Updated ' + formatTimeAgo(data.timestamp || Date.now()));
      } else {
        // Show error but keep any cached data visible
        const errorMsg = data?.error || 'Could not fetch usage data.';
        if (!document.getElementById('usage-section').classList.contains('hidden')) {
          // We have cached data showing — just update status
          setStatus('Update failed: ' + errorMsg);
        } else {
          showError(errorMsg);
        }
      }
    } catch (e) {
      showError('Could not reach extension background. Try reloading the extension.');
    }

    setRefreshSpinning(false);

    // Also load history chart
    await loadHistory();
  }

  // ─── Rendering ─────────────────────────────────────────────

  /**
   * Render the usage data into the popup UI.
   * Adapts to whatever data shape the API returns.
   * @param {Object} data - Usage response from content script
   */
  function renderUsageData(data) {
    document.getElementById('error-card').classList.add('hidden');
    document.getElementById('usage-section').classList.remove('hidden');

    // Plan badge
    const planBadge = document.getElementById('plan-badge');
    const planName = extractPlanName(data);
    if (planName) {
      planBadge.textContent = planName;
      planBadge.classList.remove('hidden');
    }

    // Render usage bars
    renderUsageBars(data);

    // Render rate limit info
    renderRateLimits(data);

    // Render raw details
    renderDetails(data);

    // Update status
    if (data.fromCache && data.cacheAge) {
      setStatus('Cached ' + formatTimeAgo(Date.now() - data.cacheAge));
    } else {
      setStatus('Updated ' + formatTimeAgo(data.timestamp || Date.now()));
    }
  }

  /**
   * Render usage percentage bars.
   * Handles multiple possible API response shapes.
   */
  function renderUsageBars(data) {
    const container = document.getElementById('usage-bars');
    let html = '';

    // Try to extract usage bars from various data shapes
    const bars = extractUsageBars(data);

    if (bars.length === 0) {
      html = '<p class="muted">No usage bar data available.</p>';
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

  /**
   * Extract usage bars from whatever data the API returned.
   * Handles multiple known API response formats.
   * @param {Object} data
   * @returns {Array<{label, percentage, valueText, detail}>}
   */
  function extractUsageBars(data) {
    const bars = [];

    // ─── From rate limit data ────────────────────────
    if (data.rateLimit) {
      const rl = data.rateLimit;

      // Shape 1: { percentage_used: 45.2, daily_limit: 100, daily_used: 45 }
      if (typeof rl.percentage_used === 'number') {
        bars.push({
          label: 'Daily Usage',
          percentage: rl.percentage_used,
          valueText: `${Math.round(rl.percentage_used)}%`,
          detail: rl.daily_limit ? `${rl.daily_used || 0} / ${rl.daily_limit} messages` : null
        });
      }

      // Shape 2: { rate_limit: { ... }, messages_remaining: 50, messages_limit: 100 }
      if (typeof rl.messages_remaining === 'number' && typeof rl.messages_limit === 'number') {
        const used = rl.messages_limit - rl.messages_remaining;
        const pct = rl.messages_limit > 0 ? (used / rl.messages_limit) * 100 : 0;
        bars.push({
          label: 'Messages',
          percentage: pct,
          valueText: `${used} / ${rl.messages_limit}`,
          detail: `${rl.messages_remaining} remaining`
        });
      }

      // Shape 3: nested limits array
      if (Array.isArray(rl.limits)) {
        for (const limit of rl.limits) {
          const pct = limit.max > 0 ? (limit.used / limit.max) * 100 : 0;
          bars.push({
            label: limit.name || limit.type || 'Limit',
            percentage: pct,
            valueText: `${limit.used} / ${limit.max}`,
            detail: limit.resetsAt ? `Resets ${formatResetTime(limit.resetsAt)}` : null
          });
        }
      }

      // Shape 4: { type: "...", remaining: N, limit: N, reset_at: "..." }
      if (typeof rl.remaining === 'number' && typeof rl.limit === 'number') {
        const used = rl.limit - rl.remaining;
        const pct = rl.limit > 0 ? (used / rl.limit) * 100 : 0;
        bars.push({
          label: rl.type || 'Usage',
          percentage: pct,
          valueText: `${used} / ${rl.limit}`,
          detail: rl.reset_at ? `Resets ${formatResetTime(rl.reset_at)}` : null
        });
      }

      // Shape 5: generic object with known keys
      if (bars.length === 0 && typeof rl === 'object') {
        // Walk keys looking for usage-like patterns
        for (const [key, val] of Object.entries(rl)) {
          if (typeof val === 'object' && val !== null) {
            if ('used' in val && 'limit' in val) {
              const pct = val.limit > 0 ? (val.used / val.limit) * 100 : 0;
              bars.push({
                label: formatLabel(key),
                percentage: pct,
                valueText: `${val.used} / ${val.limit}`,
                detail: val.reset_at ? `Resets ${formatResetTime(val.reset_at)}` : null
              });
            }
          }
        }
      }
    }

    // ─── From usage data ─────────────────────────────
    if (data.usage && bars.length === 0) {
      const u = data.usage;

      // Token-based usage
      if (typeof u.total_tokens === 'number' && typeof u.token_limit === 'number') {
        const pct = u.token_limit > 0 ? (u.total_tokens / u.token_limit) * 100 : 0;
        bars.push({
          label: 'Token Usage',
          percentage: pct,
          valueText: `${formatTokens(u.total_tokens)} / ${formatTokens(u.token_limit)}`,
          detail: null
        });
      }

      // Message-based usage
      if (typeof u.message_count === 'number' && typeof u.message_limit === 'number') {
        const pct = u.message_limit > 0 ? (u.message_count / u.message_limit) * 100 : 0;
        bars.push({
          label: 'Messages',
          percentage: pct,
          valueText: `${u.message_count} / ${u.message_limit}`,
          detail: null
        });
      }

      // Generic: walk the usage object for patterns
      if (bars.length === 0 && typeof u === 'object') {
        for (const [key, val] of Object.entries(u)) {
          if (typeof val === 'object' && val !== null && 'used' in val && 'limit' in val) {
            const pct = val.limit > 0 ? (val.used / val.limit) * 100 : 0;
            bars.push({
              label: formatLabel(key),
              percentage: pct,
              valueText: `${val.used} / ${val.limit}`,
              detail: null
            });
          }
        }
      }
    }

    // ─── From organization data (plan info) ──────────
    if (data.organization && bars.length === 0) {
      const org = data.organization;
      if (org.rate_limit_tier || org.usage) {
        // Try to extract from organization-level fields
        const usage = org.usage || {};
        for (const [key, val] of Object.entries(usage)) {
          if (typeof val === 'object' && val !== null && 'used' in val) {
            const limit = val.limit || val.max || 100;
            const pct = limit > 0 ? (val.used / limit) * 100 : 0;
            bars.push({
              label: formatLabel(key),
              percentage: pct,
              valueText: `${val.used} / ${limit}`,
              detail: null
            });
          }
        }
      }
    }

    return bars;
  }

  /**
   * Render rate limit details section.
   */
  function renderRateLimits(data) {
    const card = document.getElementById('rate-limit-card');
    const body = document.getElementById('rate-limit-body');

    if (!data.rateLimit && !data.usage) {
      card.classList.add('hidden');
      return;
    }

    card.classList.remove('hidden');
    const info = data.rateLimit || data.usage || {};
    let html = '';

    // Show reset time if available
    const resetAt = info.reset_at || info.resetsAt || info.next_reset;
    if (resetAt) {
      html += `<div class="info-row">
        <span class="info-label">Resets</span>
        <span class="info-value">${formatResetTime(resetAt)}</span>
      </div>`;
    }

    // Show any additional useful fields
    const interestingKeys = ['tier', 'plan', 'period', 'interval', 'model'];
    for (const [key, val] of Object.entries(info)) {
      if (interestingKeys.some(k => key.toLowerCase().includes(k)) && typeof val !== 'object') {
        html += `<div class="info-row">
          <span class="info-label">${formatLabel(key)}</span>
          <span class="info-value">${escapeHtml(String(val))}</span>
        </div>`;
      }
    }

    if (html === '') {
      card.classList.add('hidden');
    } else {
      body.innerHTML = html;
    }
  }

  /**
   * Render raw JSON details (collapsible).
   */
  function renderDetails(data) {
    const filtered = {
      organization: data.organization,
      usage: data.usage,
      rateLimit: data.rateLimit,
      settings: data.settings
    };
    // Remove null values for cleaner display
    for (const key of Object.keys(filtered)) {
      if (!filtered[key]) delete filtered[key];
    }
    document.getElementById('details-json').textContent = JSON.stringify(filtered, null, 2);
  }

  // ─── History Chart ─────────────────────────────────────────

  async function loadHistory() {
    const result = await sendMessage({ type: 'POPUP_GET_HISTORY' });
    if (!result || !result.ok || Object.keys(result.history || {}).length < 2) {
      document.getElementById('history-section').classList.add('hidden');
      return;
    }

    document.getElementById('history-section').classList.remove('hidden');

    if (historyChart) {
      historyChart.destroy();
      historyChart = null;
    }

    const dates = Object.keys(result.history).sort();
    const labels = dates.map(d => {
      const parts = d.split('-');
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${months[parseInt(parts[1]) - 1]} ${parseInt(parts[2])}`;
    });

    // Try to extract a percentage or used value from each snapshot
    const dataPoints = dates.map(d => {
      const snap = result.history[d];
      return extractSnapshotValue(snap);
    });

    const ctx = document.getElementById('history-chart').getContext('2d');
    historyChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Usage %',
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
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: { ticks: { font: { size: 9 }, maxRotation: 45 } },
          y: {
            beginAtZero: true,
            max: 100,
            title: { display: true, text: 'Usage %', font: { size: 10 } },
            ticks: { font: { size: 9 } }
          }
        }
      }
    });
  }

  /**
   * Extract a usage percentage from a history snapshot.
   */
  function extractSnapshotValue(snap) {
    if (!snap) return 0;
    const rl = snap.rateLimit || {};
    if (typeof rl.percentage_used === 'number') return rl.percentage_used;
    if (typeof rl.messages_remaining === 'number' && typeof rl.messages_limit === 'number') {
      const used = rl.messages_limit - rl.messages_remaining;
      return rl.messages_limit > 0 ? (used / rl.messages_limit) * 100 : 0;
    }
    if (typeof rl.remaining === 'number' && typeof rl.limit === 'number') {
      const used = rl.limit - rl.remaining;
      return rl.limit > 0 ? (used / rl.limit) * 100 : 0;
    }
    return 0;
  }

  // ─── UI Helpers ────────────────────────────────────────────

  function setupRefreshButton() {
    document.getElementById('refresh-btn').addEventListener('click', refreshData);
  }

  function setupDetailsToggle() {
    document.getElementById('details-toggle').addEventListener('click', () => {
      const body = document.getElementById('details-body');
      const arrow = document.getElementById('toggle-arrow');
      body.classList.toggle('hidden');
      arrow.textContent = body.classList.contains('hidden') ? '\u25B6' : '\u25BC';
    });
  }

  function setStatus(text) {
    document.getElementById('status-text').textContent = text;
  }

  function setRefreshSpinning(spinning) {
    const btn = document.getElementById('refresh-btn');
    if (spinning) {
      btn.classList.add('spinning');
      btn.disabled = true;
    } else {
      btn.classList.remove('spinning');
      btn.disabled = false;
    }
  }

  function showError(msg) {
    document.getElementById('error-card').classList.remove('hidden');
    document.getElementById('error-text').textContent = msg;
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
      if (isNaN(d.getTime())) return resetAt;
      const now = new Date();
      const diffMs = d - now;
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

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Messaging ─────────────────────────────────────────────

  function sendMessage(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (response) => {
        resolve(response);
      });
    });
  }

})();
