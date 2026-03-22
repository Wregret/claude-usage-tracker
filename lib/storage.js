/**
 * Storage layer for Claude Usage Tracker.
 *
 * Minimal — most storage operations are handled directly in the
 * service worker via chrome.storage.local. This file exists for
 * the popup to reference if needed, and documents the schema.
 *
 * Storage schema:
 *   orgId           - string: discovered organization UUID
 *   cachedUsage     - object: last fetched usage data
 *   lastFetchTime   - number: epoch ms of last successful fetch
 *   interceptedData - object: passively captured API responses
 *   usageHistory    - object: { "YYYY-MM-DD": snapshot } for trend chart
 */

// This file is loaded by popup.html but the popup communicates
// with the service worker via chrome.runtime.sendMessage rather
// than calling Storage directly. Kept for documentation and
// potential future use.
