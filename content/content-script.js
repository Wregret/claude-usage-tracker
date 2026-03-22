/**
 * Content script for Claude Usage Tracker.
 *
 * Runs on claude.ai pages to:
 * 1. Detect new user and assistant messages via MutationObserver
 * 2. Send heartbeats to keep the background session alive
 * 3. Re-attach observer when navigating between conversations (SPA)
 */

(() => {
  'use strict';

  /** Heartbeat interval: 30 seconds */
  const HEARTBEAT_INTERVAL = 30000;

  /** Track last detected message element to avoid double-counting */
  let lastDetectedUserEl = null;
  let lastDetectedAssistantEl = null;

  /** Main MutationObserver instance */
  let chatObserver = null;

  /** Counter to debounce assistant message detection (streaming creates many mutations) */
  let assistantDebounceTimer = null;

  // ─── Message Detection ───────────────────────────────────────

  /**
   * Check if a DOM node is a user message container.
   * Uses multiple heuristics for resilience against DOM changes.
   * @param {Element} node - DOM element to check
   * @returns {boolean}
   */
  function isUserMessage(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;

    // Heuristic 1: data-testid attribute
    if (node.getAttribute('data-testid')?.includes('human')) return true;
    if (node.getAttribute('data-testid')?.includes('user')) return true;

    // Heuristic 2: class name patterns
    const className = node.className || '';
    if (typeof className === 'string') {
      if (className.includes('human-turn')) return true;
      if (className.includes('user-message')) return true;
    }

    // Heuristic 3: role attribute used in chat UIs
    if (node.getAttribute('data-role') === 'user') return true;

    return false;
  }

  /**
   * Check if a DOM node is an assistant message container.
   * @param {Element} node - DOM element to check
   * @returns {boolean}
   */
  function isAssistantMessage(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;

    // Heuristic 1: data-testid attribute
    if (node.getAttribute('data-testid')?.includes('assistant')) return true;
    if (node.getAttribute('data-testid')?.includes('ai')) return true;

    // Heuristic 2: class name patterns
    const className = node.className || '';
    if (typeof className === 'string') {
      if (className.includes('assistant-turn')) return true;
      if (className.includes('ai-message')) return true;
    }

    // Heuristic 3: role attribute
    if (node.getAttribute('data-role') === 'assistant') return true;

    // Heuristic 4: streaming indicator (Claude shows this during response)
    if (node.getAttribute('data-is-streaming') !== null) return true;

    return false;
  }

  /**
   * Recursively search a node and its children for message elements.
   * Needed because MutationObserver may report a parent wrapper, not the
   * message element directly.
   * @param {Element} node - Root node to search
   */
  function checkNodeForMessages(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;

    // Check the node itself
    if (isUserMessage(node) && node !== lastDetectedUserEl) {
      lastDetectedUserEl = node;
      sendMessage('user');
    }

    if (isAssistantMessage(node) && node !== lastDetectedAssistantEl) {
      lastDetectedAssistantEl = node;
      // Debounce assistant messages since streaming causes many mutations
      clearTimeout(assistantDebounceTimer);
      assistantDebounceTimer = setTimeout(() => {
        sendMessage('assistant');
      }, 2000); // Wait 2s after last mutation to count as one message
    }

    // Check children (one level deep to avoid excessive recursion)
    for (const child of node.children) {
      if (isUserMessage(child) && child !== lastDetectedUserEl) {
        lastDetectedUserEl = child;
        sendMessage('user');
      }
      if (isAssistantMessage(child) && child !== lastDetectedAssistantEl) {
        lastDetectedAssistantEl = child;
        clearTimeout(assistantDebounceTimer);
        assistantDebounceTimer = setTimeout(() => {
          sendMessage('assistant');
        }, 2000);
      }
    }
  }

  /**
   * Send a message detection event to the background service worker.
   * @param {string} role - 'user' or 'assistant'
   */
  function sendMessage(role) {
    try {
      chrome.runtime.sendMessage({
        type: 'MESSAGE_DETECTED',
        role: role
      });
    } catch (e) {
      // Extension context may have been invalidated (e.g., extension updated)
      console.debug('[Claude Tracker] Could not send message:', e.message);
    }
  }

  // ─── Observer Setup ──────────────────────────────────────────

  /**
   * Find the conversation container in the DOM.
   * Tries multiple selectors for resilience.
   * @returns {Element|null} The conversation container element
   */
  function findConversationContainer() {
    // Try common selectors used by claude.ai
    const selectors = [
      '[data-testid="conversation"]',
      '[class*="conversation"]',
      '[class*="chat-messages"]',
      'main [role="log"]',
      'main [role="main"]',
      'main'
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }

    return document.body; // Fallback to body
  }

  /**
   * Attach the MutationObserver to the conversation container.
   * Disconnects any existing observer first.
   */
  function attachObserver() {
    if (chatObserver) {
      chatObserver.disconnect();
    }

    const container = findConversationContainer();

    chatObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        // Check added nodes for new messages
        for (const node of mutation.addedNodes) {
          checkNodeForMessages(node);
        }
      }
    });

    chatObserver.observe(container, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Watch for SPA navigation (URL changes without full page reload).
   * Re-attaches the observer when the user switches conversations.
   */
  function watchForNavigation() {
    let lastUrl = location.href;

    // Use a MutationObserver on the title or URL to detect SPA navigation
    const navObserver = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        // Reset message tracking on conversation change
        lastDetectedUserEl = null;
        lastDetectedAssistantEl = null;
        // Re-attach observer after a short delay for DOM to update
        setTimeout(attachObserver, 1000);
      }
    });

    navObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // ─── Heartbeat ─────────────────────────────────────────────

  /**
   * Send periodic heartbeats to the background to keep the session alive.
   * Only sends when the page is visible (not backgrounded).
   */
  function startHeartbeat() {
    setInterval(() => {
      if (document.visibilityState === 'visible') {
        try {
          chrome.runtime.sendMessage({ type: 'HEARTBEAT' });
        } catch (e) {
          // Extension context invalidated
          console.debug('[Claude Tracker] Heartbeat failed:', e.message);
        }
      }
    }, HEARTBEAT_INTERVAL);
  }

  // ─── Initialization ────────────────────────────────────────

  /**
   * Initialize the content script after a short delay to ensure
   * the claude.ai DOM is fully loaded.
   */
  function init() {
    // Wait a bit for the SPA to finish rendering
    setTimeout(() => {
      attachObserver();
      watchForNavigation();
      startHeartbeat();

      // Send initial heartbeat to signal we're on claude.ai
      try {
        chrome.runtime.sendMessage({ type: 'HEARTBEAT' });
      } catch (e) {
        console.debug('[Claude Tracker] Initial heartbeat failed:', e.message);
      }
    }, 2000);
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
