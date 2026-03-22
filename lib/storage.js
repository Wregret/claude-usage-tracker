/**
 * Storage schema for Claude Usage Tracker.
 *
 * All storage operations use chrome.storage.local via the service worker.
 * This file documents the schema for reference.
 *
 * Storage keys:
 *   orgId         - string: discovered organization UUID
 *   cachedUsage   - object: last fetched usage data
 *   lastFetchTime - number: epoch ms of last successful fetch
 *   usageHistory  - object: { "YYYY-MM-DD": snapshot } for trend chart
 */
