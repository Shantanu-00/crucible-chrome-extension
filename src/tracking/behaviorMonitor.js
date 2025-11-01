// src/tracking/behaviorMonitor.js
(async () => {
    // 1. AWAIT the settings promise from environmentCheck.js
    await window.chromeworldSettingsPromise;

    // 2. NOW check the settings, which are guaranteed to be populated
    if (typeof window.chromeworldSettings === 'undefined' || !window.chromeworldSettings.profileSyncEnabled) {
        console.log('Chromeworld: Behavior Monitor disabled by settings.');
    } else {
        console.log('Chromeworld: Behavior Monitor ENABLED.');
class BehaviorMonitor {
  constructor(opts = {}) {
    this.sessionId = 'pending';
    this.tabId = 'pending';
    this.domain = window.location.hostname || 'pending';
    this.url = window.location.href || '';
    this.startTime = new Date().toISOString();

    this.sanitizeParams = opts.sanitizeParams || [
      'token', 'auth', 'session', 'sessionid', 'sid', 'access_token', 'jwt'
    ];

    // Engagement state
    this.engagement = {
      activeTime: 0,       // seconds
      scrollDepth: 0,      // 0-100 %
      clicks: 0,
      copies: 0,
      pastes: 0,
      highlights: 0,
      tabSwitches: 0
    };

    // Content sample tracking
    this.saveCount = 0;
    this.contentSampleSent = false;
    this.contentSample = null;

    // Internal timers and thresholds
    this.lastInteractionAt = Date.now();
    this.lastVisibilityChangeAt = null;
    this.leftTabAt = null;
    this.minTabSwitchInterval = opts.minTabSwitchInterval || 2000; // ms to count as a real tab leave
    this.pingIntervalMs = opts.pingIntervalMs || 5000; // check active/inactive every 5s
    this.activeWindowMs = opts.activeWindowMs || 5000; // interaction is considered active if within last 5s
    this.saveIntervalMs = opts.saveIntervalMs || 15000; // send data to background every 15s

    // Scroll tracking
    this.maxScrollPercent = 0;
    this.scrollDebounceMs = 250;

    // State
    this.isInitialized = false;
    this.listeners = [];
    this.intervals = [];

    // Early exit when extension environment restricts
    if (window.chromeworldRestricted) return;
  }

  // Public init
  async initialize() {
    if (this.isInitialized) return;

    if (!this.shouldTrack()) return;

    await this.obtainSessionAndTabIds();
    this.url = this.sanitizeUrl(this.url);
    this.setupListeners();
    this.startHeartbeat();
    this.startPeriodicSave();

    this.isInitialized = true;
    console.log('BehaviorMonitor initialized', { sessionId: this.sessionId, tabId: this.tabId, domain: this.domain });
  }

  shouldTrack() {
    const url = window.location.href || '';
    const domain = window.location.hostname || '';
    if (!domain || domain === 'null' || url === 'about:blank') return false;
    const ignore = [
      'chrome-devtools://', 'devtools://', 'chrome-extension://', 'chrome://', 'google.com/warmup.html','https://www.google.com/search?q='
    ];
    return !ignore.some(p => url.includes(p));
  }

  async obtainSessionAndTabIds() {
    try {
      const res = await new Promise((resolve) => {
        if (!chrome?.runtime?.sendMessage) return resolve(null);
        chrome.runtime.sendMessage({ type: 'GET_SESSION_ID' }, (r) => resolve(r));
      });

      if (res?.success) {
        this.sessionId = res.data.sessionId;
        this.tabId = res.data.tabId || await this.requestTabId();
      } else {
        this.sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
        this.tabId = await this.requestTabId();
      }
    } catch (e) {
      this.sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      this.tabId = this.generateFallbackTabId();
    }
  }

  requestTabId() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'GET_TAB_ID' }, (resp) => {
          resolve(resp?.success ? resp.data.tabId : this.generateFallbackTabId());
        });
      } catch (e) {
        resolve(this.generateFallbackTabId());
      }
    });
  }

  // Remove sensitive query params and fragments
  sanitizeUrl(rawUrl) {
    try {
      const u = new URL(rawUrl, window.location.origin);
      this.sanitizeParams.forEach(p => u.searchParams.delete(p));
      u.hash = '';
      return u.toString();
    } catch (e) {
      return rawUrl.split('#')[0].split('?')[0];
    }
  }

  setupListeners() {
    // Interaction events mark activity
    const markInteraction = () => { this.lastInteractionAt = Date.now(); };
    const interactionEvents = ['mousemove','mousedown','keydown','touchstart','scroll'];
    interactionEvents.forEach(ev => {
      const h = () => markInteraction();
      window.addEventListener(ev, h, { passive: true });
      this.listeners.push({ target: window, type: ev, handler: h });
    });

    // Clicks
    const clickHandler = (e) => {
      if (e.isTrusted) { this.engagement.clicks++; this.lastInteractionAt = Date.now(); }
    };
    document.addEventListener('click', clickHandler, { passive: true });
    this.listeners.push({ target: document, type: 'click', handler: clickHandler });

    // Copy
    const copyHandler = (e) => {
      if (e.isTrusted) { this.engagement.copies++; this.lastInteractionAt = Date.now(); }
    };
    document.addEventListener('copy', copyHandler);
    this.listeners.push({ target: document, type: 'copy', handler: copyHandler });

    // Paste
    const pasteHandler = (e) => {
      if (e.isTrusted) { this.engagement.pastes++; this.lastInteractionAt = Date.now(); }
    };
    document.addEventListener('paste', pasteHandler);
    this.listeners.push({ target: document, type: 'paste', handler: pasteHandler });

    // Selection / highlights
    const selectionHandler = () => {
      const s = window.getSelection?.()?.toString()?.trim();
      if (s && s.split(/\s+/).length >= 3) {
        this.engagement.highlights++;
        this.lastInteractionAt = Date.now();
      }
    };
    document.addEventListener('selectionchange', selectionHandler);
    this.listeners.push({ target: document, type: 'selectionchange', handler: selectionHandler });

    // Scroll depth
    let scrollTimer = null;
    const scrollHandler = () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        const docEl = document.documentElement;
        const scrollTop = window.scrollY || docEl.scrollTop || 0;
        const scrollHeight = docEl.scrollHeight - window.innerHeight;
        const pct = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
        if (pct > this.maxScrollPercent) {
          this.maxScrollPercent = Math.min(100, Math.round(pct));
          this.engagement.scrollDepth = this.maxScrollPercent;
        }
      }, this.scrollDebounceMs);
    };
    window.addEventListener('scroll', scrollHandler, { passive: true });
    this.listeners.push({ target: window, type: 'scroll', handler: scrollHandler });

    // Visibility / tab switch handling
    const visibilityHandler = () => {
      const now = Date.now();
      if (document.hidden) {
        this.leftTabAt = now;
      } else {
        if (this.leftTabAt && (now - this.leftTabAt) > this.minTabSwitchInterval) {
          this.engagement.tabSwitches++;
        }
        this.leftTabAt = null;
        this.lastInteractionAt = now;
      }
      this.lastVisibilityChangeAt = now;
    };
    document.addEventListener('visibilitychange', visibilityHandler);
    this.listeners.push({ target: document, type: 'visibilitychange', handler: visibilityHandler });

    // Cleanup on unload
    const beforeUnload = () => this.destroy();
    window.addEventListener('beforeunload', beforeUnload);
    this.listeners.push({ target: window, type: 'beforeunload', handler: beforeUnload });
  }

  startHeartbeat() {
    // At every ping, if there was interaction in the active window, add ping interval seconds to activeTime
    const tick = () => {
      const now = Date.now();
      const sinceInteraction = now - this.lastInteractionAt;
      const active = sinceInteraction <= this.activeWindowMs && !document.hidden;
      if (active) {
        this.engagement.activeTime += this.pingIntervalMs / 1000;
      }
    };
    tick(); // immediate
    const id = setInterval(tick, this.pingIntervalMs);
    this.intervals.push(id);
  }

  computeWordCount() {
    try {
      const text = document.body?.innerText || '';
      const words = text.trim().split(/\s+/).filter(Boolean);
      return words.length;
    } catch (e) {
      return 0;
    }
  }

  // Content Sample Extraction Methods
  extractContentSample() {
    if (this.contentSample) return this.contentSample;

    try {
      const mainContent = this.findMainContent();
      if (!mainContent) return this.getFallbackContent();

      const clone = mainContent.cloneNode(true);
      
      // Remove unwanted elements
      const unwantedSelectors = [
        'script', 'style', 'nav', 'header', 'footer', 
        '.ad', '[class*="ad"]', '.advertisement', '.banner-ad',
        '.menu', '.navigation', '.sidebar', '.comments', 
        '.social-share', '.share-buttons', '.newsletter', 
        'iframe', 'noscript', '.hidden', '[aria-hidden="true"]',
        'form', 'button', '.popup', '.modal', '.cookie-consent'
      ];
      
      unwantedSelectors.forEach(selector => {
        clone.querySelectorAll(selector).forEach(el => el.remove());
      });

      // Extract clean text
      let text = clone.textContent || '';
      text = text.replace(/\s+/g, ' ').trim();
      
      // Limit to reasonable size for topic inference
      this.contentSample = text.substring(0, 5000); // Max 5000 chars
      return this.contentSample;
      
    } catch (e) {
      console.error('Content extraction failed:', e);
      return this.getFallbackContent();
    }
  }

  findMainContent() {
    const selectors = [
      'main', 'article', '[role="main"]', 
      '.content', '.main-content', '.post-content',
      '.article', '.blog-post', '.story-content',
      '#content', '#main', '#article'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && this.isSubstantialContent(element)) {
        return element;
      }
    }
    return document.body;
  }

  isSubstantialContent(element) {
    const text = element.textContent || '';
    const cleanText = text.replace(/\s+/g, ' ').trim();
    return cleanText.length > 200;
  }

  getFallbackContent() {
    // Fallback: get text from body but clean it
    const clone = document.body.cloneNode(true);
    
    // Remove common noise
    const noiseSelectors = ['script', 'style', 'nav', 'header', 'footer', '.ad', '.menu'];
    noiseSelectors.forEach(selector => {
      clone.querySelectorAll(selector).forEach(el => el.remove());
    });
    
    const text = clone.textContent || '';
    return text.replace(/\s+/g, ' ').trim().substring(0, 3000);
  }

startPeriodicSave() {
  const saveNow = async () => {
    try {
      // Increment save counter
      this.saveCount++;
      
      // Build payload - ADD contentSample field here
      const endTime = new Date().toISOString();
      const payload = {
        sessionId: this.sessionId,
        tabId: this.tabId,
        domain: this.domain,
        url: this.sanitizeUrl(this.url),
        startTime: this.startTime,
        endTime,
        engagement: {
          activeTime: Math.round(this.engagement.activeTime),
          scrollDepth: this.engagement.scrollDepth || Math.round(this.maxScrollPercent),
          clicks: this.engagement.clicks,
          copies: this.engagement.copies,
          pastes: this.engagement.pastes,
          highlights: this.engagement.highlights,
          tabSwitches: this.engagement.tabSwitches
        },
        wordCount: this.computeWordCount(),
        lastUpdated: endTime,
        saveCount: this.saveCount,
        contentSample: null // ADD THIS FIELD - initialize as null
      };

      // Add content sample only on 3rd save and never again
      if (this.saveCount >= 3 && !this.contentSampleSent) {
        const contentSample = this.extractContentSample();
        if (contentSample && contentSample.length > 100) {
          payload.contentSample = contentSample; // UPDATE the field
          this.contentSampleSent = true;
          console.log('📄 Content sample extracted and sent on 3rd save', { 
            saveCount: this.saveCount,
            length: contentSample.length,
            preview: contentSample.substring(0, 100) + '...' 
          });
        }
      }

      // Send to background
      if (chrome?.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ 
          type: 'SAVE_BEHAVIOR_DATA', 
          data: payload 
        }, (resp) => {
          // optional callback handling
        });
      }

    } catch (e) {
      console.log('BehaviorMonitor save failed refresh the page as', e);
    }
  };

  // Immediate save and periodic
  saveNow();
  const id = setInterval(saveNow, this.saveIntervalMs);
  this.intervals.push(id);
}
async finalizeAndSave() {
  // final flush
  await new Promise((res) => {
    try {
      const endTime = new Date().toISOString();
      const payload = {
        sessionId: this.sessionId,
        tabId: this.tabId,
        domain: this.domain,
        url: this.sanitizeUrl(this.url),
        startTime: this.startTime,
        endTime,
        engagement: this.engagement,
        wordCount: this.computeWordCount(),
        lastUpdated: endTime,
        saveCount: this.saveCount,
        contentSample: null // ADD THIS FIELD
      };

      // Include content sample only if we're at 3rd+ save and not sent yet
      if (this.saveCount >= 3 && !this.contentSampleSent) {
        const contentSample = this.extractContentSample();
        if (contentSample && contentSample.length > 100) {
          payload.contentSample = contentSample; // UPDATE the field
          this.contentSampleSent = true;
        }
      }

      if (chrome?.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'SAVE_BEHAVIOR_DATA', data: payload }, () => res());
      } else {
        res();
      }
    } catch (_) { res(); }
  });
}

  destroy() {
    // stop intervals
    this.intervals.forEach(clearInterval);
    this.intervals = [];

    // remove listeners
    this.listeners.forEach(({ target = document, type, handler }) => {
      try { target.removeEventListener(type, handler); } catch (e) {}
    });
    this.listeners = [];

    // final save
    this.finalizeAndSave().catch(() => {});

    this.isInitialized = false;
    console.log('BehaviorMonitor destroyed', { 
      totalSaves: this.saveCount, 
      contentSampleSent: this.contentSampleSent 
    });
  }

  generateFallbackTabId() {
    return `tab-${Math.floor(Math.random() * 1e9)}`;
  }
}

// Auto-init
let behaviorMonitorInstance = null;
function initializeBehaviorMonitor() {
  if (behaviorMonitorInstance) {
    behaviorMonitorInstance.destroy();
  }
  behaviorMonitorInstance = new BehaviorMonitor();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => behaviorMonitorInstance.initialize());
  } else {
    behaviorMonitorInstance.initialize();
  }
  return behaviorMonitorInstance;
}

// Initialize
initializeBehaviorMonitor();
}})();