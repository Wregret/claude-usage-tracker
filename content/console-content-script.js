/**
 * Content script for Anthropic Console (platform.claude.com).
 *
 * Mirrors content-script.js but for API usage data.
 * Discovers the workspace/org ID and fetches billing/usage info.
 *
 * Likely data sources (to be confirmed via DevTools):
 *   GET /api/organizations                  → org list
 *   GET /api/organizations/{id}/usage       → token/cost usage
 *   GET /api/organizations/{id}/limits      → spending limits
 *   GET /api/organizations/{id}/invoices    → billing history
 *   GET /api/billing/usage                  → alternate usage endpoint
 *   GET /api/usage                          → alternate usage endpoint
 */

(() => {
  'use strict';

  let orgId = null;

  // ─── Message Handler ──────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'FETCH_API_USAGE') {
      fetchApiUsageData().then(sendResponse);
      return true;
    }
    if (message.type === 'GET_API_ORG_ID') {
      sendResponse({ orgId });
      return false;
    }
  });

  // ─── API Fetching ─────────────────────────────────────────

  /**
   * Fetch API usage data from platform.claude.com's internal endpoints.
   * Tries multiple endpoints in parallel, returns whatever succeeds.
   * @returns {Promise<Object>}
   */
  async function fetchApiUsageData() {
    const result = {
      ok: false,
      source: 'api',
      orgId: null,
      organization: null,
      billing: null,
      usage: null,
      limits: null,
      error: null,
      timestamp: Date.now()
    };

    try {
      if (!orgId) {
        orgId = await discoverOrgId();
      }
      if (!orgId) {
        result.error = 'Could not find organization ID. Please open platform.claude.com and log in.';
        return result;
      }
      result.orgId = orgId;

      // Try multiple endpoint patterns — we don't know the exact shape
      const endpoints = [
        { key: 'organization', path: `/api/organizations/${orgId}` },
        { key: 'usage', path: `/api/organizations/${orgId}/usage` },
        { key: 'limits', path: `/api/organizations/${orgId}/limits` },
        { key: 'billing', path: `/api/organizations/${orgId}/billing` },
        { key: 'invoices', path: `/api/organizations/${orgId}/invoices` },
        { key: 'usage_alt', path: '/api/billing/usage' },
        { key: 'usage_alt2', path: '/api/usage' },
      ];

      const results = await Promise.allSettled(
        endpoints.map(ep => safeFetch(ep.path).then(data => ({ key: ep.key, data })))
      );

      for (const r of results) {
        if (r.status !== 'fulfilled' || !r.value.data) continue;
        const { key, data } = r.value;
        if (key === 'organization') result.organization = data;
        else if (key === 'limits') result.limits = data;
        else if (key === 'billing') result.billing = data;
        else if (key.startsWith('usage')) {
          // Merge usage data (first one wins)
          if (!result.usage) result.usage = data;
        }
        else if (key === 'invoices') result.billing = { ...result.billing, invoices: data };
      }

      result.ok = !!(result.usage || result.billing || result.limits || result.organization);
      if (!result.ok) {
        result.error = 'Could not fetch API usage data. Endpoints may have changed.';
      }
    } catch (e) {
      result.error = e.message;
    }

    return result;
  }

  // ─── Org ID Discovery ────────────────────────────────────

  /**
   * Discover the org/workspace ID on platform.claude.com.
   * @returns {Promise<string|null>}
   */
  async function discoverOrgId() {
    // Method 1: Fetch the organizations list
    try {
      const resp = await fetch('/api/organizations', {
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      });
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data) && data.length > 0) {
          return data[0].uuid || data[0].id || null;
        }
        if (data.uuid || data.id) {
          return data.uuid || data.id;
        }
      }
    } catch (e) {
      // Continue to fallback
    }

    // Method 2: Parse org/workspace ID from URL
    const urlMatch = window.location.href.match(/\/(organizations|workspaces)\/([a-f0-9-]{36})/i);
    if (urlMatch) return urlMatch[2];

    // Method 3: Look in page data attributes or meta tags
    const meta = document.querySelector('meta[name="organization-id"], meta[name="workspace-id"]');
    if (meta) return meta.getAttribute('content');

    return null;
  }

  // ─── Helpers ──────────────────────────────────────────────

  /**
   * Fetch an API endpoint. Returns parsed JSON or null on failure.
   * @param {string} path
   * @returns {Promise<Object|null>}
   */
  async function safeFetch(path) {
    try {
      const resp = await fetch(path, {
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

  // ─── Initial Discovery ───────────────────────────────────

  setTimeout(() => {
    if (!orgId) {
      discoverOrgId().then(id => {
        if (id) {
          orgId = id;
          chrome.runtime.sendMessage({ type: 'API_ORG_ID_DISCOVERED', orgId: id });
        }
      });
    }
  }, 3000);

})();
