/**
 * Content script for Claude Usage Tracker.
 *
 * Runs on claude.ai pages. Two jobs:
 *
 * 1. Auto-discover the user's organization ID by intercepting fetch()
 *    calls (every claude.ai API call includes /organizations/{id}/...).
 *
 * 2. On demand (when the popup asks), fetch usage data from claude.ai's
 *    internal API and return it. Because this script runs in the page
 *    context, the user's session cookies are automatically included.
 *
 * Data sources:
 *   GET /api/organizations                       → org list + plan info
 *   GET /api/organizations/{id}/usage             → usage/billing data
 *   GET /api/organizations/{id}/rate_limit_status  → rate limit percentage
 *   GET /api/organizations/{id}/settings          → plan/subscription details
 */

(() => {
  'use strict';

  /** Discovered organization ID (extracted from intercepted API calls). */
  let orgId = null;

  // ─── Org ID Discovery ─────────────────────────────────────
  //
  // claude.ai's API URLs contain the org ID:
  //   /api/organizations/abc123-def456/chat_conversations/...
  //
  // We intercept fetch() to capture it from any API call.

  const originalFetch = window.fetch;

  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      // Extract org ID from API URL pattern: /api/organizations/{uuid}/
      if (!orgId) {
        const match = url.match(/\/api\/organizations\/([a-f0-9-]{36})\//i);
        if (match) {
          orgId = match[1];
          // Persist for later use by the popup
          chrome.runtime.sendMessage({ type: 'ORG_ID_DISCOVERED', orgId });
        }
      }

      // Capture usage-related API responses passively
      if (url.includes('/usage') || url.includes('/rate_limit')) {
        try {
          const cloned = response.clone();
          const data = await cloned.json();
          chrome.runtime.sendMessage({
            type: 'USAGE_DATA_INTERCEPTED',
            url: url,
            data: data,
            timestamp: Date.now()
          });
        } catch (e) {
          // Not JSON or stream error — ignore
        }
      }
    } catch (e) {
      // Never break the page
    }

    return response;
  };

  // ─── Message Handler (popup/background requests) ────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'FETCH_USAGE') {
      fetchUsageData().then(sendResponse);
      return true; // Keep channel open for async
    }
    if (message.type === 'GET_ORG_ID') {
      sendResponse({ orgId });
      return false;
    }
  });

  /**
   * Fetch usage data from claude.ai's internal API.
   * Tries multiple endpoints and returns whatever data we can get.
   *
   * @returns {Promise<Object>} Combined usage data
   */
  async function fetchUsageData() {
    const result = {
      ok: false,
      orgId: null,
      organization: null,
      usage: null,
      rateLimit: null,
      error: null,
      timestamp: Date.now()
    };

    try {
      // Step 1: Get org ID if we don't have it
      if (!orgId) {
        orgId = await discoverOrgId();
      }
      if (!orgId) {
        result.error = 'Could not find organization ID. Please open a chat on claude.ai first.';
        return result;
      }
      result.orgId = orgId;

      // Step 2: Fetch from multiple endpoints in parallel
      const [orgData, usageData, rateLimitData, settingsData] = await Promise.allSettled([
        safeFetch(`/api/organizations/${orgId}`),
        safeFetch(`/api/organizations/${orgId}/usage`),
        safeFetch(`/api/organizations/${orgId}/rate_limit_status`),
        safeFetch(`/api/organizations/${orgId}/settings`)
      ]);

      // Merge whatever we got
      if (orgData.status === 'fulfilled' && orgData.value) {
        result.organization = orgData.value;
      }
      if (usageData.status === 'fulfilled' && usageData.value) {
        result.usage = usageData.value;
      }
      if (rateLimitData.status === 'fulfilled' && rateLimitData.value) {
        result.rateLimit = rateLimitData.value;
      }
      if (settingsData.status === 'fulfilled' && settingsData.value) {
        result.settings = settingsData.value;
      }

      result.ok = !!(result.usage || result.rateLimit || result.organization);
      if (!result.ok) {
        result.error = 'Could not fetch usage data. API endpoints may have changed.';
      }
    } catch (e) {
      result.error = e.message;
    }

    return result;
  }

  /**
   * Try to discover the org ID by fetching the organizations list.
   * Falls back to parsing the page URL or DOM.
   * @returns {Promise<string|null>}
   */
  async function discoverOrgId() {
    // Method 1: Fetch /api/organizations
    try {
      const resp = await originalFetch('/api/organizations', {
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      });
      if (resp.ok) {
        const orgs = await resp.json();
        if (Array.isArray(orgs) && orgs.length > 0) {
          return orgs[0].uuid || orgs[0].id || null;
        }
      }
    } catch (e) {
      // Continue to fallback
    }

    // Method 2: Look for org ID in the current page URL
    const urlMatch = window.location.href.match(/\/organizations\/([a-f0-9-]{36})/i);
    if (urlMatch) return urlMatch[1];

    // Method 3: Look for org ID in meta tags or data attributes
    const metaOrg = document.querySelector('meta[name="organization-id"]');
    if (metaOrg) return metaOrg.getAttribute('content');

    return null;
  }

  /**
   * Fetch a claude.ai API endpoint with error handling.
   * Returns parsed JSON or null on failure.
   * @param {string} path - API path (e.g. "/api/organizations/{id}/usage")
   * @returns {Promise<Object|null>}
   */
  async function safeFetch(path) {
    try {
      const resp = await originalFetch(path, {
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      });
      if (!resp.ok) return null;
      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('json')) return null;
      return await resp.json();
    } catch (e) {
      return null;
    }
  }

  // ─── Initial Discovery ─────────────────────────────────────

  // Try to discover org ID on page load (async, don't block)
  setTimeout(() => {
    if (!orgId) {
      discoverOrgId().then(id => {
        if (id) {
          orgId = id;
          chrome.runtime.sendMessage({ type: 'ORG_ID_DISCOVERED', orgId: id });
        }
      });
    }
  }, 3000);

})();
