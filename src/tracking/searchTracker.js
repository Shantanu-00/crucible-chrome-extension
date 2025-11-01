// src/tracking/searchTracker.js
// Content script used on search pages. Drop-in replacement for your previous file.
// Key improvements:
// - Debounce duplicate queries
// - Track clicks BEFORE navigation (preventDefault, send message, then navigate)
// - Wider result detection (Google, DuckDuckGo, Amazon, Flipkart)
// - Uses a safe sendMessage wrapper to support both callback & promise forms

(async () => {
    // 1. AWAIT the settings promise
    await window.chromeworldSettingsPromise;

    // 2. NOW check the settings
    if (typeof window.chromeworldSettings === 'undefined' || !window.chromeworldSettings.profileSyncEnabled) {
        console.log('Chromeworld: Search Tracker disabled by settings.');
    } else {
        console.log('Chromeworld: Search Tracker ENABLED.');
class SearchTracker {
  constructor() {
    if (window.chromeworldRestricted) return;

    this.sessionId = null;
    this.tabId = null;
    this.currentQuery = null;
    this.lastTrackedAt = 0;
    this.lastSearchId = null; // searchId returned by background (if available)
    this.isSearchPage = false;
    this.observedInputs = new Set();
    this.isInitialized = false;
    this.currentEngine = 'unknown';
  }

  // Helper that wraps chrome.runtime.sendMessage in a Promise (works with MV2 callback and MV3 Promise)
async sendMessage(message, timeout = 3000) {
    return new Promise((resolve) => {
      let done = false;
      const timeoutId = setTimeout(() => {
        if (!done) {
          done = true;
          // Resolve with null to clearly indicate timeout/failure
          resolve(null); 
        }
      }, timeout);

      try {
        // Use the native sendMessage with a callback
        chrome.runtime.sendMessage(message, (resp) => {
          if (done) return;
          done = true;
          clearTimeout(timeoutId);
          // Resolve with the response, which might be undefined/null on error
          resolve(resp);
        });
        
        // Handle immediate errors, such as disconnected port (which often happens when SW is suspended)
        if (chrome.runtime.lastError) {
          if (!done) {
            done = true;
            clearTimeout(timeoutId);
            resolve(null); 
          }
        }
      } catch (e) {
        // Catches catastrophic errors during the send attempt itself
        if (!done) {
          done = true;
          clearTimeout(timeoutId);
          resolve(null);
        }
      }
    });
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      // Wait for DOM
      if (document.readyState === 'loading') {
        await new Promise((r) => document.addEventListener('DOMContentLoaded', r));
      }

      // Get session & tab info from background
      await this.initializeSession();

      // Setup detection & listeners
      this.setupSearchDetection();
      this.setupResultTracking();
      

      this.isInitialized = true;
      console.log('🔍 Search Tracker initialized', { engine: this.currentEngine, sessionId: this.sessionId, tabId: this.tabId });
    } catch (err) {
      console.error('❌ Search Tracker initialization failed:', err);
      // Retry after short delay
      setTimeout(() => this.initialize().catch(()=>{}), 1500);
    }
  }

  async initializeSession() {
    try {
      const resp = await this.sendMessage({ type: 'GET_SESSION_ID' }, 2000);
      if (resp && resp.success && resp.data) {
        this.sessionId = resp.data.sessionId;
        // Try to get a reliable tab id object
        const tabInfo = await this.sendMessage({ type: 'GET_TAB_ID' }, 2000);
        if (tabInfo && tabInfo.success && tabInfo.data && tabInfo.data.tabId != null) {
          this.tabId = tabInfo.data.tabId;
        } else {
          // Fallback to window.location hostname based id
          this.tabId = this.generateFallbackTabId();
        }
      } else {
        throw new Error('Failed to get session id');
      }
    } catch (err) {
      console.warn('Session initialization failed (fallback):', err);
      this.sessionId = `search-session-${Date.now()}`;
      this.tabId = this.generateFallbackTabId();
    }
  }

generateFallbackTabId() {
    const hostname = window.location.hostname || 'unknown';
    const timestamp = Date.now();
    return `tab-fallback-${hostname}-${timestamp}`;
  }

  /* ---------------- Search detection ---------------- */

  setupSearchDetection() {
    this.detectSearchEngine();

    if (this.currentEngine === 'google') {
      this.setupGoogleSearchDetection();
    } else if (this.currentEngine === 'duckduckgo') {
      this.setupDuckDuckGoDetection();
    } else if (this.currentEngine === 'commerce') {
      this.setupCommerceDetection();
    } else {
      this.setupGenericSearchDetection();
    }

    // If currently on a search results URL, check it
    this.checkExistingSearch();
  }

  detectSearchEngine() {
    const hostname = window.location.hostname || '';
    if (hostname.includes('google.')) {
      this.currentEngine = 'google';
      this.isSearchPage = true;
    } else if (hostname.includes('duckduckgo.com')) {
      this.currentEngine = 'duckduckgo';
      this.isSearchPage = true;
    } else if (hostname.includes('amazon.') || hostname.includes('flipkart.')) {
      this.currentEngine = 'commerce';
      this.isSearchPage = true;
    } else {
      // site-specific or other search pages
      // We'll attempt to detect search forms dynamically
      this.currentEngine = 'site-specific';
      // We'll still run generic detection
      this.isSearchPage = !!document.querySelector('input[name="q"], input[type="search"], form[action*="search"]');
    }
  }

  

  /* ---------- Engine-specific setup ---------- */

  setupGoogleSearchDetection() {
    this.setupGoogleInputMonitoring();
    this.setupGoogleURLMonitoring();
    this.checkCurrentGoogleSearch();
  }

  setupDuckDuckGoDetection() {
    this.observeSearchBarChange('input[name="q"]');
  }

  setupCommerceDetection() {
    // Amazon / Flipkart — site-specific search inputs
    // Amazon: #twotabsearchtextbox, Flipkart: input[type=text] inside .LM6RPg
    this.observeSearchBarChange('input#twotabsearchtextbox, input[name="q"], input[type="search"]');
  }

  setupGenericSearchDetection() {
    // Attach to generic search forms and dynamic forms
    this.attachToSearchForms();
    this.setupMutationObserver();
  }

  observeSearchBarChange(selector) {
    const tryAttach = () => {
      const input = document.querySelector(selector);
      if (!input) return;
      // Avoid double attaching
      if (this.observedInputs.has(input)) return;
      this.observedInputs.add(input);

      input.addEventListener('change', () => {
        const q = (input.value || '').trim();
        if (q) this.trackSearch(q, 'input');
      });

      const form = input.closest('form');
      if (form) {
        form.addEventListener('submit', () => {
          const q = (input.value || '').trim();
          if (q) this.trackSearch(q, 'form');
        });
      }
    };

    // Try immediate & then a couple of retries for SPA pages
    tryAttach();
    setTimeout(tryAttach, 500);
    setTimeout(tryAttach, 1500);
  }

  setupGoogleInputMonitoring() {
    const googleSelectors = [
      'textarea[name="q"]',
      'input[name="q"]',
      '[role="combobox"]',
      '.gLFyf'
    ];

    const checkInputs = () => {
      googleSelectors.forEach(selector => {
        const inputs = document.querySelectorAll(selector);
        inputs.forEach(input => {
          if (!this.observedInputs.has(input)) {
            this.observeSearchInput(input);
            this.observedInputs.add(input);
          }
        });
      });
    };

    checkInputs();
    if (this.observedInputs.size === 0) {
      setTimeout(checkInputs, 800);
      setTimeout(checkInputs, 2000);
    }
    // In case inputs are added dynamically
    this.googleInputsInterval = setInterval(checkInputs, 2000);
  }

  observeSearchInput(input) {
    const form = input.closest('form');
    if (form) {
      form.addEventListener('submit', (ev) => {
        const q = (input.value || '').trim();
        if (q) this.handleSearchSubmission(q);
      });
    }

    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        // small delay to allow SPA to update URL or input value
        setTimeout(() => {
          const q = (input.value || '').trim();
          if (q) this.handleSearchSubmission(q);
        }, 120);
      }
    });
  }

  setupGoogleURLMonitoring() {
    let last = location.href;
    setInterval(() => {
      const current = location.href;
      if (current !== last) {
        const wasSearch = /\/search/.test(last);
        const isSearch = /\/search/.test(current);
        last = current;
        if (isSearch) {
          this.handleGoogleSearchURL(current);
        }
      }
    }, 500);
  }

  handleGoogleSearchURL(url) {
    const q = this.extractQueryFromGoogleURL(url);
    if (q && q !== this.currentQuery) {
      this.trackSearch(q, 'google-url');
    }
  }

  extractQueryFromGoogleURL(url) {
    try {
      const params = new URL(url).searchParams;
      return (params.get('q') || '').trim();
    } catch (e) {
      return '';
    }
  }

  checkCurrentGoogleSearch() {
    if (/\/search/.test(location.href)) {
      const q = this.extractQueryFromGoogleURL(location.href);
      if (q) setTimeout(() => this.trackSearch(q, 'google-initial'), 1000);
    }
  }

  attachToSearchForms() {
    const forms = document.querySelectorAll('form');
    forms.forEach((form) => {
      if (this.isSearchForm(form)) this.observeGenericSearchForm(form);
    });
  }

  isSearchForm(form) {
    const inputs = form.querySelectorAll('input[type="text"], input[type="search"], textarea');
    return Array.from(inputs).some(input => {
      const attrs = ['name', 'placeholder', 'aria-label', 'title'];
      const values = attrs.map(a => (input.getAttribute(a) || '').toLowerCase());
      return values.some(v => v.includes('search') || v === 'q' || v === 's');
    });
  }

  observeGenericSearchForm(form) {
    const handleSubmit = (ev) => {
      const q = this.extractQueryFromForm(form);
      if (q) this.trackSearch(q, 'form-generic');
    };

    form.addEventListener('submit', handleSubmit);

    const inputs = form.querySelectorAll('input, textarea');
    inputs.forEach(input => {
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') setTimeout(handleSubmit, 50);
      });
    });
  }

  extractQueryFromForm(form) {
    const inputs = form.querySelectorAll('input[type="text"], input[type="search"], textarea');
    for (const input of inputs) {
      if ((input.value || '').trim()) return input.value.trim();
    }
    return '';
  }

  setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) {
            if (node.tagName === 'FORM') this.observeGenericSearchForm(node);
            else {
              const forms = node.querySelectorAll?.('form') || [];
              forms.forEach(f => this.observeGenericSearchForm(f));
            }
          }
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  checkExistingSearch() {
    if (this.currentEngine === 'google' && /\/search/.test(location.href)) {
      const q = this.extractQueryFromGoogleURL(location.href);
      if (q) setTimeout(() => this.trackSearch(q, 'existing-google'), 1200);
    }
  }

  /* ---------------- Tracking (searches & clicks) ---------------- */

async trackSearch(query, source) {
    const now = Date.now();
    // Debounce to avoid duplicates (input + URL + form)
    if (!query) return;
    if (query === this.currentQuery && (now - this.lastTrackedAt) < 1200) return;
    if ((now - this.lastTrackedAt) < 800 && query === this.currentQuery) return;

    this.currentQuery = query;
    this.lastTrackedAt = now;

    const payload = {
      query,
      source,
      url: location.href,
      tabId: this.tabId,
      sessionId: this.sessionId
    };

    try {
      // 1. IMMEDIATE STORAGE (existing functionality - unchanged)
      const storagePromise = this.sendMessage({ type: 'SAVE_SEARCH_BASIC', data: payload }, 3000);
      
     

      // 3. WAIT FOR STORAGE (maintains existing behavior)
      const resp = await storagePromise;
      if (resp && resp.success && resp.data && resp.data.searchId) {
        this.lastSearchId = resp.data.searchId;
      }
      
      console.log('🔍 Search tracked:', query, 'source:', source);
      
    } catch (err) {
      console.error('Failed to send SAVE_SEARCH_BASIC', err);
    }
  }


  handleSearchSubmission(query) {
    if (query && query.trim() && query !== this.currentQuery) {
      this.trackSearch(query.trim(), this.currentEngine || 'unknown');
    }
  }

setupResultTracking() {
    document.addEventListener('click', async (event) => {
        try {
            const link = event.target.closest('a');
            if (!link || !link.href) return;

            let resultUrl = link.href;
            
            // 🎯 HANDLE MISSING QUERY - USE EXISTING EXTRACTION FUNCTIONS
            if (!this.currentQuery) {
                console.log('🔍 No current query - attempting recovery');
                
                // Use existing extractQueryFromGoogleURL for Google
                if (window.location.hostname.includes('google.')) {
                    this.currentQuery = this.extractQueryFromGoogleURL(window.location.href);
                }
                
                // Use existing extractQueryFromForm for other sites
                if (!this.currentQuery) {
                    const forms = document.querySelectorAll('form');
                    for (const form of forms) {
                        if (this.isSearchForm(form)) {
                            this.currentQuery = this.extractQueryFromForm(form);
                            if (this.currentQuery) break;
                        }
                    }
                }
                
                // Fallback: Look for search inputs directly
                if (!this.currentQuery) {
                    const searchInputs = document.querySelectorAll('input[name="q"], input[type="search"], textarea[name="q"]');
                    for (const input of searchInputs) {
                        if (input.value && input.value.trim()) {
                            this.currentQuery = input.value.trim();
                            break;
                        }
                    }
                }

                if (this.currentQuery) {
                    console.log('✅ Query recovered:', this.currentQuery);
                } else {
                    console.log('❌ Cannot track - no query available');
                    return;
                }
            }

            // ==================== CLEAN URL (if cleanResultUrl exists) ====================
            if (typeof this.cleanResultUrl === 'function') {
                resultUrl = this.cleanResultUrl(resultUrl);
            }
            
            // Basic URL validation
            if (!resultUrl.startsWith('http')) {
                console.log('🚫 Skipping invalid URL:', resultUrl);
                return;
            }

            // ==================== TRACKING LOGIC ====================
            event.preventDefault();
            event.stopImmediatePropagation();

            const clickPayload = {
                query: this.currentQuery,
                resultUrl: resultUrl,
                tabId: this.tabId,
                sessionId: this.sessionId,
            };

            console.log('🔍 Tracking click:', {
                query: this.currentQuery,
                resultUrl: resultUrl
            });

            // ==================== SEND & NAVIGATE ====================
            try {
                const resp = await this.sendMessage({ 
                    type: 'TRACK_RESULT_CLICK', 
                    data: clickPayload 
                }, 1500);
                
                if (resp && resp.success) {
                    console.log('✅ Click tracked');
                    setTimeout(() => { window.location.href = resultUrl; }, 50);
                    return;
                }
            } catch (e) {
                console.log('⚠️ Tracking failed, navigating anyway');
            }

            // ==================== GUARANTEED NAVIGATION ====================
            setTimeout(() => { window.location.href = resultUrl; }, 100);

        } catch (err) {
            console.error('Error in click tracking:', err);
            if (link && link.href) {
                setTimeout(() => { window.location.href = link.href; }, 50);
            }
        }
    }, true);
}
  async trackResultClick(resultUrl) {
    // This method is kept for completeness if other code wants to call it directly
    const payload = {
      query: this.currentQuery,
      resultUrl,
      tabId: this.tabId,
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      via: 'contentScript',
      searchId: this.lastSearchId || null,
      referringUrl: location.href
    };

    try {
      await this.sendMessage({ type: 'TRACK_RESULT_CLICK', data: payload }, 2000);
      console.log('🔍 Result click tracked (direct):', resultUrl);
    } catch (err) {
      console.error('trackResultClick failed:', err);
    }
  }

// 🎯 CLEAN LINK URL BEFORE TRACKING
cleanResultUrl(url) {
    try {
        const urlObj = new URL(url);
        
        // 🚫 REMOVE THESE TRACKING & SENSITIVE PARAMETERS
        const paramsToRemove = [
            // Session/tracking parameters
            'sessionid', 'session', 'sid', 'token', 'auth', 'auth_token',
            'access_token', 'refresh_token', 'oauth_token',
            // Personal identifiers
            'userid', 'user_id', 'uid', 'email', 'username',
            // Tracking parameters
            'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
            'gclid', 'fbclid', 'msclkid', 'trk', 'tracking', 'ref',
            'source', 'medium', 'campaign', 'term', 'content',
            // E-commerce tracking
            'tag', 'affiliate', 'aff_id', 'partner', 'clickid',
            // Security tokens
            'csrf', 'csrf_token', 'nonce', 'state', 'code',
            // Temporary tokens
            'temp_token', 'temp_id', 'verify', 'verification'
        ];

        // Remove unwanted parameters
        paramsToRemove.forEach(param => {
            urlObj.searchParams.delete(param);
            urlObj.searchParams.delete(param.toLowerCase());
            urlObj.searchParams.delete(param.toUpperCase());
        });

        // 🔧 KEEP THESE IMPORTANT PARAMETERS:
        // - Product IDs: 'id', 'pid', 'product_id', 'itemid'  
        // - Search parameters: 'q', 'query', 'search', 'keywords'
        // - Category parameters: 'category', 'cat', 'type'
        // - Page parameters: 'page', 'offset', 'limit'

        // Return clean URL
        const cleanUrl = urlObj.toString();
        
        console.log('🔗 URL cleaned:', {
            original: url.length,
            cleaned: cleanUrl.length,
            removed: url.length - cleanUrl.length
        });

        return cleanUrl;

    } catch (e) {
        console.error('Error cleaning URL, using original:', e);
        return url; // Fallback to original URL
    }
}
  /* cleanup */
  destroy() {
    this.observedInputs.clear();
    this.isInitialized = false;
    this.currentQuery = null;
    this.lastSearchId = null;
    console.log('🔍 Search Tracker destroyed');
  }
}

/* ----------------- Auto-init ----------------- */

function initializeSearchTracker() {
  const tracker = new SearchTracker();

  setTimeout(() => {
    tracker.initialize().catch(error => {
      console.error('Failed to initialize search tracker:', error);
    });
  }, 100);

  window.addEventListener('beforeunload', () => {
    tracker.destroy();
  });

  // Expose for debugging if needed
  window.SearchTracker = SearchTracker;
  return tracker;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeSearchTracker);
} else {
  initializeSearchTracker();
}
}})();