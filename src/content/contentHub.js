// SETTINGS GUARD CLAUSE
// First, check if the global settings object (from environmentCheck.js) exists.
(async () => {
    // 1. AWAIT the settings promise
    await window.chromeworldSettingsPromise;

    // 2. NOW check the settings
    if (typeof window.chromeworldSettings === 'undefined') {
        console.log('Chromeworld: Content Hub disabled (no settings loaded).');
    } else {

    // --- GLOBAL STATE FOR THE HUB ---
    let hubInstance = null;

    /**
     * Creates and initializes the ContentHub
     */
    function initializeHub() {
        if (hubInstance) {
            // Already initialized, just ensure theme is correct
            hubInstance.applyTheme();
            return;
        }
        
        if (window.chromeworldSettings.aiEnabled) {
            console.log('Chromeworld: Initializing Content Hub...');
            hubInstance = new ContentHub();
        } else {
            console.log('Chromeworld: AI is disabled, not initializing hub.');
        }
    }

    /**
     * Destroys the ContentHub instance and removes its UI
     */
    function teardownHub() {
        if (hubInstance) {
            console.log('Chromeworld: Tearing down Content Hub...');
            hubInstance.destroy();
            hubInstance = null;
        }
    }


    // ================================================================
    // ===== START OF YOUR ORIGINAL conhuby.txt CLASS           =====
    // ================================================================
    
// src/content/contentHub.js - v12.6 (Crucible Vortex UI - Comet Pass Removed)
class ContentHub {
  constructor() {
    // REMOVED: The old "window.chromeworldRestricted" check is no longer needed here.
    
    // Core State
    this.sessionId = null;
    this.tabId = null;
    this.orb = null;
    this.overlay = null;
    this.isOverlayVisible = false;
    this.isProcessing = false;
    this.hasProcessed = false;
    
    // UI State
    this.theme = localStorage.getItem('cw-theme') || 'dark';
    this.isDrawerOpen = false;
    this.totalChunksToProcess = 0;
    this.isMainViewSummary = true; // This now controls both panels
    
    // 🌟 NEW: Loading status
    this.loadingStatusInterval = null;
    this.loadingMessages = [
      'Analyzing page structure...',
      'Extracting key content...',
      'Identifying main themes...',
      'Consulting user profile...',
      'Warming up AI cores...',
      'Generating initial summaries...'
    ];
    // Pipeline Data
    this.chunks = [];
    this.chunkSummaries = [];
    this.comprehensiveSummary = null;
    this.personalizedInsight = null;
    this.userProfile = null;
    this.insightChunkMap = new Map();
    this.cta_text = null;
    // 🌟 REVISED: For the Insight card CTA
    
    // Configs
    this.CONFIG = {
      CHAR_PER_TOKEN: 4,
      CHUNK_MIN: 600,
      CHUNK_MAX: 4000,
      CHUNK_OVERLAP: 200,
      MAX_CHUNKS: 5,
      SAFE_SUMMARY_CHARS: 500,
      MIN_BLOCK_LENGTH: 60,
      MIN_WORD_COUNT: 10,
      MAX_LINK_DENSITY: 0.4,
      PROFILE_WEIGHT: 0.7,
      STRUCTURE_WEIGHT: 0.2,
 
      POSITION_WEIGHT: 0.1,
      SUMMARY_PAUSE_MS: 3000 // Shortened for a snappier demo
    };
    this.STOP_WORDS = new Set([
      'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'in', 'on', 'at',
      'to', 'for', 'of', 'with', 'by', 'as', 'from', 'this', 'that', 'it', 'its', 'they',
      'their', 'them', 'we', 'our', 'us', 'you', 'your', 'he', 'his', 'him', 'she', 'her',
      'what', 'which', 'who', 'when', 'where', 'why', 'how', 'all', 'any', 'some', 'many'
    ]);
    this.HEURISTIC_TOPICS = {
      AUTOMOTIVE: ['car', 'auto', 'motor', 'vehicle', 'ev', 'tesla', 'rolls-royce', 'dealership', 'truck'],
      TECHNOLOGY: ['ai', 'tech', 'software', 'app', 'code', 'semiconductor', 'gadget', 'cloud', 'gemini', 'chip'],
      FINANCE: ['stock', 'market', 'invest', 'loan', 'bank', 'earnings', 'gdp', 'fed', 'portfolio'],
      NEWS: ['breaking', 'report', 'update', 'latest', 'today', 'bbc', 'cnn', 'news'],
      SCIENCE: ['lab', 'study', 'research', 'biology', 'physics', 'astronomy', 'quantum', 'experiment'],
      BUSINESS: ['business', 'corp', 'ceo', 'strategy', 'acquisition', 'merger', 'product'],
      LIFESTYLE: ['style', 'fashion', 'health', 'food', 
'travel', 'home', 'diet'],
    };

    this.init();
  }

  async init() {
    console.log('🎯 Content Hub initializing (Crucible Vortex v12.6)...');
    await this.initializeSession();
    await this.loadUserProfile();
    this.injectOrbUI();
    // 🌟 REMOVED: this.injectCtaCard();
    this.setupMessageHandlers();
    
    // 🌟 ADDED: Apply theme on initialization
    this.applyTheme();
        
    console.log('✅ Content Hub ready with profile-first pipeline');
  }

  // ==================== NEW METHODS ====================
      
  /**
   * 🌟 NEW: Applies the correct theme to the orb based on global settings.
   */
  applyTheme() {
    if (!this.orb) return;
    
    // Read the global setting from environmentCheck.js
    const useAltTheme = window.chromeworldSettings.orbTheme; 
    console.log(`Chromeworld: Applying Orb Theme (Alt: ${useAltTheme})`);
    
    if (useAltTheme) {
        this.orb.classList.add('theme-alt');
    } else {
        this.orb.classList.remove('theme-alt');
    }
  }
  
  /**
   * 🌟 NEW: Cleans up the UI and event listeners when the hub is disabled.
   */
  destroy() {
    console.log('Chromeworld: Destroying Content Hub instance.');
    if (this.orb) {
        this.orb.remove();
        this.orb = null;
    }
    if (this.overlay) {
        this.overlay.remove();
        this.overlay = null;
    }
    // Stop any pending intervals
    this.stopLoadingMessages();
    
    // You would also remove any global listeners here if you had them
    // (e.g., document.addEventListener(...))
  }

// ==================== SESSION & PROFILE ====================
  // ... (unchanged)
  async initializeSession() {
    try {
      const response = await this.sendToBackground({ type: 'GET_SESSION_ID' }, 5000);
      if (response?.success && response?.data) {
        this.sessionId = response.data.sessionId;
        this.tabId = response.data.tabId;
      }
    } catch (error) {
      console.error('Session initialization failed:', error);
      this.sessionId = `session-fallback-${Date.now()}`;
      this.tabId = `tab-fallback-${Date.now()}`;
    }
  }

  async loadUserProfile() {
    try {
      const response = await this.sendToBackground({ type: 'GET_USER_PROFILE' }, 3000);
      if (response?.success && response?.data) {
        this.userProfile = response.data;
      }
    } catch (error) {
      console.warn('Failed to load user profile, using fallback:', error);
      this.userProfile = { 
        summary: 'General user with broad interests', 
        topics: [],
        confidence: 0,
        focusStyle: 'balanced'
      };
    }
  }

  // ==================== ORB & CTA UI ====================
  /**
   * 🌟 MODIFIED: Fixed HTML typo and bound `this` for event listener.
   * 🌟 MODIFIED: Changed SVG strokes to `currentColor` for theming.
   * 🌟 MODIFIED: Added alt logo img for theme-alt.
   */
  injectOrbUI() {
    const existingOrb = document.getElementById('chromeworld-orb');
    if (existingOrb) existingOrb.remove();

    this.injectStyles();

    // Get logo URL (requires "web_accessible_resources" in manifest)
    const logoUrl = chrome.runtime.getURL('src/images/hammer48.jpg');

    this.orb = document.createElement('div');
    this.orb.id = 'chromeworld-orb';
    this.orb.className = 'cw-orb';
    // 🌟 FIXED: Corrected `class.orb-core"` to `class="orb-core"`
    // 🌟 CHANGED: SVG strokes/fills to `currentColor`
    // 🌟 ADDED: orb-icon-default and orb-icon-alt for theme switching
    this.orb.innerHTML = `
      <div class="orb-glow"></div>
      <div class="orb-core">
        <svg class="orb-icon orb-icon-default" viewBox="0 0 24 24" width="28" height="28">
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.5"/>
          <circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="1" opacity="0.6"/>
          <path d="M12 2 L12 22 M2 12 L22 12" stroke="currentColor" stroke-width="0.8" opacity="0.4"/>
          <circle cx="12" cy="12" r="2" fill="currentColor" 
          opacity="0.8"/>
        </svg>
        <img src="${logoUrl}" class="orb-icon orb-icon-alt" width="32" height="32" />
      </div>
      <div id="cw-final-pulse"></div>
    `;

    document.body.appendChild(this.orb);
    
    // 🌟 MODIFIED: Bound `this` context for the event listener
    this.orb.addEventListener('click', this.handleOrbClick.bind(this));
    console.log('🔵 Orb UI injected');
  }

  startOrbSpin() {
    if (!this.orb) return; // Add safety check
    this.orb.classList.add('processing');
  }

  stopOrbSpin() {
    if (!this.orb) return; // Add safety check
    this.orb.classList.remove('processing');
  }

  blastOrbWave() {
    const pulse = document.getElementById('cw-final-pulse');
    if (pulse) {
      pulse.classList.add('animate');
      setTimeout(() => pulse.classList.remove('animate'), 1500);
    }
  }

  async handleOrbClick() {
    if (this.isProcessing) return;
    // If it's already processed, just toggle the view
    if (this.hasProcessed) {
      this.toggleOverlay();
      return;
    }

    // --- First-time processing logic ---
    this.isProcessing = true;
    this.startOrbSpin();
    this.showOverlay();
    // Shows processing view
    this.overlay.querySelector('.cw-overlay').classList.add('is-processing-pipeline'); // 🌟 ADD THIS
    await this.runPipeline();
  }

  // 🌟 REMOVED: CTA Card functions (injectCtaCard, showCtaCard, hideCtaCard)


// ==================== STYLES ====================
/**
 * 🌟 MODIFIED: Kept all original conhuby.txt CSS and ADDED orb theme CSS.
 * 🌟 MODIFIED: Fixed @keyframes rotate bug.
 * 🌟 MODIFIED: Updated orb theme CSS to be "purple" theme.
 * 🌟 MODIFIED: Removed transform:scale() from overlay to prevent zoom bug.
 * 🌟 MODIFIED: Changed .cw-vortex-status margin-top to 24px to fix centering.
 * 🌟 ADDED: CSS for theme-alt logo orb.
 * 🌟 ADDED: CSS for header logo in overlay.
 * 🌟 🌟 🌟 REPLACED: The <img> tag fix with an EMOJI fix.
 * 🌟 🌟 🌟 ADDED: The "Lava Red" pulse fix.
 */
injectStyles() {
    // This entire function is updated for the new UI/UX
    if (document.getElementById('cw-styles')) return;
    const style = document.createElement('style');
    style.id = 'cw-styles';
    style.textContent = `
      /* CSS Reset */
      .cw-overlay-container,
      .cw-overlay-container * {
        all: revert;
        box-sizing: border-box;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
      .cw-overlay-container {
        font-family: 'Inter', -apple-system, system-ui, sans-serif;
        line-height: 1.5;
      }

      :root {
        --cw-font: 'Inter', -apple-system, system-ui, sans-serif;
        --cw-accent: #00d4ff;
        --cw-accent-alt: #7c3aed;
        --cw-accent-red: #f87171;
        --cw-accent-glow: rgba(0, 212, 255, 0.7);
        /* Light Theme */
        --cw-bg-light: #f4f4f5;
        --cw-bg-secondary-light: #ffffff;
        --cw-text-light: #18181b;
        --cw-text-muted-light: #52525b;
        --cw-border-light: rgba(0, 0, 0, 0.1);
        --cw-grid-light: rgba(124, 58, 237, 0.05);
        --cw-insight-bg-light: rgba(220, 38, 38, 0.05);
        --cw-insight-border-light: rgba(220, 38, 38, 0.3);
        --cw-vortex-light: #7c3aed;
        --cw-orb-float-light: rgba(0, 212, 255, 0.2);
        --cw-highlight-light: rgba(0, 212, 255, 0.3);
        /* Dark Theme (Default) */
        --cw-bg-dark: #0a0a0f;
        --cw-bg-secondary-dark: #12121a;
        --cw-text-dark: #f0f0f5;
        --cw-text-muted-dark: #a0a0b8;
        /* Lighter for visibility */
        --cw-border-dark: rgba(124, 58, 237, 0.2);
        --cw-grid-dark: rgba(0, 212, 255, 0.08);
        --cw-insight-bg-dark: rgba(248, 113, 113, 0.1);
        --cw-insight-border-dark: rgba(248, 113, 113, 0.4);
        --cw-vortex-dark: #00d4ff;
        --cw-orb-float-dark: rgba(0, 212, 255, 0.1);
        --cw-highlight-dark: rgba(0, 212, 255, 0.2);
      }
      
      .cw-overlay {
        --cw-bg: var(--cw-bg-dark);
        --cw-bg-secondary: var(--cw-bg-secondary-dark);
        --cw-text: var(--cw-text-dark);
        --cw-text-muted: var(--cw-text-muted-dark);
        --cw-border: var(--cw-border-dark);
        --cw-grid: var(--cw-grid-dark);
        --cw-insight-bg: var(--cw-insight-bg-dark);
        --cw-insight-border: var(--cw-insight-border-dark);
        --cw-vortex: var(--cw-vortex-dark);
        --cw-orb-float: var(--cw-orb-float-dark);
        --cw-highlight: var(--cw-highlight-dark);
      }
      
      .cw-overlay.light-theme {
        --cw-bg: var(--cw-bg-light);
        --cw-bg-secondary: var(--cw-bg-secondary-light);
        --cw-text: var(--cw-text-light);
        --cw-text-muted: var(--cw-text-muted-light);
        --cw-border: var(--cw-border-light);
        --cw-grid: var(--cw-grid-light);
        --cw-insight-bg: var(--cw-insight-bg-light);
        --cw-insight-border: var(--cw-insight-border-light);
        --cw-vortex: var(--cw-vortex-light);
        --cw-orb-float: var(--cw-orb-float-light);
        --cw-highlight: var(--cw-highlight-light);
      }
      
      /* Orb */
      .cw-orb {
        position: fixed !important;
        right: 24px; bottom: 24px;
        width: 64px; height: 64px; z-index: 1000001 !important;
        cursor: pointer; transition: transform 0.3s ease; border-radius: 50%;
      }
      .cw-orb:hover { transform: scale(1.1);
      }
      .cw-orb.processing .orb-core {
        animation: rotate-center 1.5s linear infinite; /* 🌟 FIXED: Use rotate-center animation */
      }
      /* 🌟 ADDED: Default Orb Glow */
      .cw-orb .orb-glow {
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        border-radius: 50%;
        box-shadow: 0 0 35px 8px var(--cw-accent-glow), 0 0 15px 4px var(--cw-accent-glow) inset;
        opacity: 0.8;
        transition: box-shadow 0.4s ease, opacity 0.4s ease;
      }
      #cw-final-pulse {
        position: absolute; left: 50%;
        top: 50%; width: 64px; height: 64px;
        background: var(--cw-accent-alt); border-radius: 50%;
        transform: translate(-50%, -50%) scale(0); opacity: 0.7; pointer-events: none;
      }

      /* 🌟 LAVA PULSE FIX 🌟 */
      .cw-orb.theme-alt #cw-final-pulse {
        background: #ff4500; /* Lava red-orange */
      }
      
      #cw-final-pulse.animate { animation: final-pulse 1.5s ease-out;
      }
      @keyframes final-pulse {
        from { transform: translate(-50%, -50%) scale(0);
        opacity: 0.7; }
        to { transform: translate(-50%, -50%) scale(40); opacity: 0;
      }
      }

      /* Animated Grid + Orbs */
      .cw-animated-grid {
        position: fixed;
        inset: 0; background-color: var(--cw-bg);
        background-image:
          linear-gradient(to right, var(--cw-grid) 1px, transparent 1px),
          linear-gradient(to bottom, var(--cw-grid) 1px, transparent 1px);
        background-size: 40px 40px; animation: move-grid 20s linear infinite;
        z-index: 1; transition: background-color 0.3s ease;
      }
      @keyframes move-grid {
        0% { background-position: 0 0;
      }
        100% { background-position: 40px 40px;
      }
      }
      .cw-floating-orbs {
        position: fixed;
        inset: 0; z-index: 2;
        pointer-events: none; overflow: hidden;
      }
      .cw-floating-orb {
        position: absolute;
        border-radius: 50%; background: var(--cw-orb-float);
        box-shadow: 0 0 20px var(--cw-orb-float);
        animation: float-orb 30s infinite alternate ease-in-out;
      }
      .cw-floating-orb:nth-child(1) { width: 50px; height: 50px; top: 10%; left: 15%; animation-duration: 25s;
      }
      .cw-floating-orb:nth-child(2) { width: 30px; height: 30px; top: 40%; left: 80%; animation-duration: 30s;
      }
      .cw-floating-orb:nth-child(3) { width: 80px; height: 80px; top: 70%; left: 30%; animation-duration: 35s;
      }
      .cw-floating-orb:nth-child(4) { width: 40px; height: 40px; top: 80%; left: 90%; animation-duration: 28s;
      }
      .cw-floating-orb:nth-child(5) { width: 60px; height: 60px; top: 20%; left: 50%; animation-duration: 32s;
      }
      @keyframes float-orb {
        0% { transform: translate(0, 0);
      }
        100% { transform: translate(40px, 60px) scale(1.1);
      }
      }
      /* Starfield */
      .cw-starfield {
        position: fixed;
        inset: 0;
        z-index: 1; /* Behind grid */
        pointer-events: none;
      }
      .cw-star {
        position: absolute;
        width: 2px;
        height: 2px;
        background: var(--cw-text-muted);
        border-radius: 50%;
        opacity: 0.5;
        animation: twinkle 5s infinite alternate;
      }
      .cw-star:nth-child(1) { top: 10%; left: 10%; animation-delay: 0s;
      }
      .cw-star:nth-child(2) { top: 30%; left: 80%; animation-delay: 1s;
      }
      .cw-star:nth-child(3) { top: 50%; left: 50%; animation-delay: 3s;
      }
      .cw-star:nth-child(4) { top: 80%; left: 20%; animation-delay: 2s;
      }
      .cw-star:nth-child(5) { top: 60%; left: 90%; animation-delay: 4s;
      }
      .cw-star:nth-child(6) { top: 90%; left: 60%; animation-delay: 1.5s;
      }

      /* 🌟 REMOVED: "Your Name" Style Comet CSS */
      .cw-background-comets {
         display: none;
         /* Hide container */
      }

      /* Overlay Layout */
      /* 🌟 FIXED: Removed transform:scale() to prevent zoom bug */
      .cw-overlay {
        position: fixed;
        inset: 0; z-index: 1000000;
        display: flex; flex-direction: column;
        color: var(--cw-text); background: transparent;
        opacity: 0; visibility: hidden;
        transition: opacity 0.4s ease, visibility 0.4s ease;
      }
      .cw-overlay.visible {
        opacity: 1; visibility: visible;
      }
      
      /* Header */
      .cw-header {
        display: flex;
        justify-content: space-between; align-items: center;
        padding: 0 24px; min-height: 72px;
        background: color-mix(in srgb, var(--cw-bg) 80%, transparent);
        backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
        flex-shrink: 0; z-index: 10;
        border-bottom: 1px solid var(--cw-border);
        transition: background-color 0.3s ease;
      }
      .cw-header-title {
        display: flex; /* 🌟 ADDED */
        align-items: center; /* 🌟 ADDED */
        gap: 12px; /* 🌟 ADDED */
        font-size: 22px; font-weight: 700;
        background: linear-gradient(135deg, var(--cw-accent), var(--cw-accent-alt));
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        background-clip: text; color: transparent;
      }
      .cw-header-logo { /* 🌟 ADDED */
        width: 32px;
        height: 32px;
        border-radius: 8px;
        background: rgba(255,255,255,0.1);
        padding: 2px;
        /* Un-clip the logo from the text gradient */
        -webkit-background-clip: padding-box;
        background-clip: padding-box;
        color: initial; 
      }
      .cw-header-controls { display: flex; align-items: center; gap: 8px;
      }
      .cw-header-controls {
        filter: drop-shadow(0 0 3px rgba(255,255,255,0.25));
      }
      
      /* 🌟 🌟 🌟 START: HACKATHON EMOJI FIX 🌟 🌟 🌟 */
      .cw-icon-btn {
        background: transparent;
        border: none;
        color: var(--cw-text);
        opacity: 0.85;
        cursor: pointer; padding: 8px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        transition: color 0.3s, background 0.3s, opacity 0.3s;
        
        /* Emoji styles */
        font-size: 20px; /* Make emoji icon sized */
        line-height: 1; /* Center emoji */
        width: 40px; /* Ensure circular background */
        height: 40px; /* Ensure circular background */
        font-family: 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif; /* Force emoji font */
      }
      .cw-icon-btn:hover {
        color: var(--cw-text);
        opacity: 1;
        background: var(--cw-border);
      }
      .cw-icon-btn.active {
        color: var(--cw-accent); /* Emoji will inherit this color! */
        opacity: 1;
        background: var(--cw-border);
      }
      
      /* Theme Toggle Logic */
      #cw-theme-toggle .cw-icon-moon { display: none; }
      #cw-theme-toggle .cw-icon-sun { display: block; }
      .light-theme #cw-theme-toggle .cw-icon-moon { display: block; }
      .light-theme #cw-theme-toggle .cw-icon-sun { display: none; }
      
      /* 🌟 🌟 🌟 END: HACKATHON EMOJI FIX 🌟 🌟 🌟 */

      
      /* Content Wrapper (Grid) */
      .cw-content-wrapper {
        flex: 1;
        position: relative;
        overflow: hidden; z-index: 5;
        display: grid;
        grid-template-columns: 0px 1fr;
        transition: grid-template-columns 0.4s ease-out;
      }
      .cw-content-wrapper.drawer-open {
        grid-template-columns: 320px 1fr;
      }
      
      /* Main View */
      .cw-main-view {
        grid-column: 2;
        position: relative;
        overflow: hidden; height: 100%;
        display: flex;
      }
      
      /* Processing Vortex (Comet Spinner) */
      .cw-processing-vortex {
        position: absolute;
        inset: 0; display: flex;
        flex-direction: column; /* Stack spinner and status */
        align-items: center;
        justify-content: center;
        z-index: 100; opacity: 0;
        transition: opacity 0.5s ease, transform 0.5s ease;
        transform: scale(1);
      }
      .cw-processing-vortex.visible { opacity: 1; }
      .cw-processing-vortex.collapsing { transform: scale(0);
      opacity: 0; }
      
      .cw-vortex-orbit-container {
        width: 120px;
        /* Bigger */
        height: 120px;
        /* Bigger */
        position: relative;
        animation: rotate-simple 2s linear infinite; /* 🌟 FIXED: Use rotate-simple animation */
      }
      .cw-vortex-comet {
        position: absolute;
        top: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 12px;
        height: 12px;
        background-color: var(--cw-accent-red);
        border-radius: 50%;
        box-shadow: 0 0 10px 3px var(--cw-accent-red), 0 0 15px 5px rgba(248, 113, 113, 0.5);
      }
      /* Translucent Tail */
      .cw-vortex-comet::after {
        content: '';
        position: absolute;
        top: 6px; /* Start from center of comet head */
        left: 50%;
        transform: translateX(-50%);
        width: 3px;
        height: 70px; /* Longer */
        background: linear-gradient(to top, transparent, rgba(248, 113, 113, 0.6));
        /* More translucent */
        border-radius: 2px;
        opacity: 0.8;
      }
      
      /* Vortex Status Text */
      /* 🌟 FIXED: Reduced margin-top to fix centering */
      .cw-vortex-status {
        margin-top: 24px;
        color: var(--cw-text-muted);
        font-size: 15px;
        white-space: nowrap;
        min-height: 24px;
        /* New styles */
        font-weight: 500;
        letter-spacing: 0.5px;
        background: color-mix(in srgb, var(--cw-bg-secondary) 50%, transparent);
        padding: 4px 12px;
        border-radius: 20px;
        border: 1px solid var(--cw-border);
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      }

      /* Floating Chunks */
      .cw-chunk-popups-container {
        position: absolute;
        inset: 0;
        z-index: 99; perspective: 1000px;
      }
     .cw-floating-chunk {
        position: absolute;
        width: 320px; height: 180px; padding: 16px;
        background: var(--cw-bg-secondary); border: 1px solid var(--cw-border);
        border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        opacity: 0; transform: scale(0.8) rotateY(-30deg);
        transition: all 0.8s cubic-bezier(0.165, 0.84, 0.44, 1);
        animation: float-vacuum 10s infinite alternate ease-in-out;
      }
      .cw-floating-chunk h4 {
        margin: 0 0 8px 0;
        color: var(--cw-accent);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        font-size: 16px;
      }
      .cw-floating-chunk p {
        margin: 0; font-size: 14px;
        color: var(--cw-text-muted);
        line-height: 1.5; height: 105px; overflow: hidden;
        mask-image: linear-gradient(to bottom, black 80%, transparent 100%);
      }
     .cw-chunk-slot-1 { top: 15%; left: 10%; transition-delay: 0s;
     }
      .cw-chunk-slot-2 { top: 20%; left: 65%; transition-delay: 0.1s;
      }
      .cw-chunk-slot-3 { top: 50%; left: 5%; transition-delay: 0.2s;
      }
      .cw-chunk-slot-4 { top: 55%; left: 70%; transition-delay: 0.3s;
      }
      .cw-chunk-slot-5 { top: 70%; left: 40%; transition-delay: 0.4s;
      }
      .cw-floating-chunk.visible {
        opacity: 1; transform: scale(1) rotateY(0);
      }
     .cw-floating-chunk.collapsing {
        animation: none;
        transform: translate(var(--vortex-x, 0), var(--vortex-y, 0)) scale(0.1) rotateZ(180deg);
        opacity: 0; 
        transition: all 1.8s cubic-bezier(0.68, -0.55, 0.265, 1.55);
      }
      /* Summary Card (Center) */
      .cw-summary-center {
        position: absolute;
        top: 50%; left: 50%;
        width: 650px; max-width: 90%; max-height: 80vh;
        transform: translate(-50%, -50%) scale(0.7);
        background: var(--cw-bg-secondary); border: 1px solid var(--cw-border);
        border-radius: 16px; box-shadow: 0 20px 50px rgba(0,0,0,0.3);
        padding: 24px; z-index: 200; opacity: 0;
        transition: all 0.6s cubic-bezier(0.165, 0.84, 0.44, 1);
        display: flex; flex-direction: column;
      }
      .cw-summary-center.visible {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
      }
      .cw-summary-center.shifting {
        transition: all 0.8s cubic-bezier(0.23, 1, 0.32, 1);
        opacity: 0;
      }
      .cw-summary-center h3 {
        margin: 0 0 16px 0;
        color: var(--cw-accent);
        font-size: 22px; font-weight: 600; text-align: center;
      }
      .cw-summary-center-content {
        overflow-y: auto;
        font-size: 16px;
        color: var(--cw-text-muted); line-height: 1.7; padding-right: 10px;
      }
      
      /* Final Layout */
      .cw-main-content {
        position: absolute;
        inset: 0;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 24px; padding: 24px; z-index: 50;
        opacity: 0; transition: opacity 0.5s ease 0.3s;
      }
      .cw-main-content.visible { opacity: 1;
      }
      
      .cw-panel-left, .cw-panel-right {
        display: flex;
        flex-direction: column;
        height: 100%; min-height: 0; position: relative;
      }
      
      /* Base Panel */
      .cw-panel-base {
        background: var(--cw-bg-secondary);
        border: 1px solid var(--cw-border);
        border-radius: 16px; padding: 24px;
        flex: 1; display: flex; flex-direction: column; min-height: 0;
        box-shadow: 0 8px 30px rgba(0,0,0,0.1);
        position: absolute; inset: 0; opacity: 1; transform: translateY(0);
        transition: opacity 0.4s ease, transform 0.4s ease, visibility 0.4s ease;
      }
      .cw-panel-base.hidden {
        opacity: 0; transform: translateY(20px);
        pointer-events: none;
        visibility: hidden;
      }
      .cw-panel-base h3 { 
        margin: 0 0 16px 0;
        color: var(--cw-accent);
        font-weight: 600; font-size: 20px; flex-shrink: 0;
      }
      .cw-panel-content { 
        flex: 1;
        overflow-y: auto; color: var(--cw-text-muted); 
        line-height: 1.6; font-size: 15px; padding-right: 5px;
        overflow-x: hidden;
      }
      .cw-summary-panel {
        transform: translateX(-50px); opacity: 0;
        animation: slide-in-left 0.6s ease-out 0.2s forwards;
      }
      
      /* Chunks Panel */
      .cw-chunks-panel .cw-panel-content {
        display: flex;
        flex-direction: column; gap: 12px;
      }
      .cw-panel-chunk {
        padding: 12px 16px;
        border-radius: 8px;
        background: color-mix(in srgb, var(--cw-bg) 50%, transparent);
        border: 1px solid var(--cw-border);
        cursor: pointer;
        transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
      }
      .cw-panel-chunk:hover {
        transform: scale(1.02);
        background: color-mix(in srgb, var(--cw-bg) 80%, transparent);
      }
      .cw-panel-chunk.highlighted {
        transform: scale(1.03);
        box-shadow: 0 0 15px var(--cw-accent-glow);
        background: var(--cw-highlight);
        border-color: var(--cw-accent);
      }
      .cw-panel-chunk h5 { margin: 0 0 4px 0;
      color: var(--cw-text); font-size: 15px; }
      .cw-panel-chunk p { margin: 0; font-size: 13px; color: var(--cw-text-muted);
      }
      
      /* Insight Card */
      .cw-insight-card {
        background: var(--cw-insight-bg);
        border: 1px solid var(--cw-insight-border);
        border-radius: 16px; padding: 24px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.15); backdrop-filter: blur(10px);
        flex: 1; min-height: 0;
        display: flex; flex-direction: column;
        transform: translateX(50px); opacity: 0;
        animation: slide-in-right 0.6s ease-out 0.4s forwards;
      }
     .cw-insight-card > h3 { 
        margin: 0 0 16px 0;
        color: var(--cw-accent);
        font-weight: 600; 
        font-size: 20px; 
        flex-shrink: 0;
      }
      .cw-insight-headline { 
        font-size: 22px;
        font-weight: 700; margin-bottom: 8px; color: var(--cw-text);
        margin-top: 0;
      }
      .cw-insight-subheading { 
        font-size: 15px;
        color: var(--cw-text-muted); margin-bottom: 20px; flex-shrink: 0;
      }
      .cw-insight-bullets { 
        list-style: none;
        padding: 0; margin: 0; 
        display: flex; flex-direction: column; gap: 12px;
      }
      .cw-insight-bullet {
        padding: 14px;
        background: color-mix(in srgb, var(--cw-bg) 50%, transparent);
        border-radius: 8px; border-left: 3px solid var(--cw-accent-red);
        font-size: 15px; color: var(--cw-text);
        line-height: 1.5; overflow-wrap: break-word;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }
      .cw-insight-bullet:hover {
        transform: scale(1.02);
        box-shadow: 0 5px 15px rgba(0,0,0,0.1);
      }

      /* Insight CTA Button */
      .cw-insight-cta {
        all: revert;
        box-sizing: border-box;
        font-family: var(--cw-font);
        display: block;
        margin-top: 20px;
        padding: 12px 16px;
        background: var(--cw-accent);
        color: var(--cw-bg);
        text-decoration: none;
        border-radius: 8px;
        font-weight: 600;
        font-size: 15px;
        text-align: center;
        cursor: pointer;
        transition: all 0.3s ease;
        border: 1px solid var(--cw-accent);
      }
      .cw-insight-cta:hover {
        background: color-mix(in srgb, var(--cw-accent) 80%, white);
        box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        transform: translateY(-2px);
      }
      .cw-insight-cta span {
        margin-left: 8px;
        font-weight: normal;
      }
      .cw-overlay.light-theme .cw-insight-cta {
        color: var(--cw-bg-secondary-light);
        background: var(--cw-accent-alt);
        border-color: var(--cw-accent-alt);
      }
      .cw-overlay.light-theme .cw-insight-cta:hover {
         background: color-mix(in srgb, var(--cw-accent-alt) 80%, white);
      }
      
      /* Drawer (for new swap logic) */
      .cw-drawer {
        grid-column: 1;
        width: 100%;
        background: var(--cw-bg-secondary);
        border-right: 1px solid var(--cw-border);
        z-index: 300; display: flex;
        flex-direction: column; overflow: hidden;
        position: relative;
      }
    .cw-drawer-header { 
        padding: 24px 16px;
        border-bottom: 1px solid var(--cw-border); 
        font-weight: 600; 
        color: var(--cw-accent);
        font-size: 20px;
        flex-shrink: 0;
      }
      .cw-drawer-content { 
        flex: 1; overflow-y: auto;
        overflow-x: hidden;
        padding: 16px; 
        display: flex; flex-direction: column; gap: 12px;
      }
      
      /* Drawer Handle (More visible) */
      .cw-drawer-handle {
        position: absolute;
        left: 0;
        top: 50%;
        transform: translateY(-50%) translateX(-100%);
        width: 36px;
        height: 80px;
        background: color-mix(in srgb, var(--cw-bg-secondary) 85%, transparent);
        border: 1px solid var(--cw-border);
        border-left: 0;
        border-top-right-radius: 12px;
        border-bottom-right-radius: 12px;
        cursor: pointer;
        z-index: 299;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--cw-text-muted);
        opacity: 0;
        transition: all 0.4s ease;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        box-shadow: 2px 0 15px rgba(0,0,0,0.2);
        /* 🌟 Emoji styles 🌟 */
        font-size: 20px;
        font-family: 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif;
      }
      .cw-drawer-handle.visible { 
        opacity: 1;
        transform: translateY(-50%) translateX(0);
      }
      .cw-drawer-handle:hover { 
        color: var(--cw-text);
        background: color-mix(in srgb, var(--cw-bg-secondary) 95%, transparent);
      }
      .cw-drawer-handle.is-open { 
        transform: translateY(-50%) translateX(320px);
      }
      .cw-drawer-handle::after {
        content: '';
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        border-radius: inherit;
        box-shadow: 0 0 15px var(--cw-accent-glow);
        opacity: 0;
        animation: pulse-glow 2s infinite;
      }
      @keyframes pulse-glow {
        0% { opacity: 0;
      }
        50% { opacity: 0.7;
      }
        100% { opacity: 0;
      }
      }

      .cw-drawer-chunk {
        padding: 12px;
        border-radius: 8px;
        background: color-mix(in srgb, var(--cw-bg) 30%, transparent);
        border: 1px solid var(--cw-border);
        cursor: pointer;
        transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
      }
      .cw-drawer-chunk:hover {
        transform: scale(1.02);
        background: color-mix(in srgb, var(--cw-bg) 60%, transparent);
      }
      .cw-drawer-chunk.highlighted {
        transform: scale(1.03);
        box-shadow: 0 0 15px var(--cw-accent-glow);
        background: var(--cw-highlight);
        border-color: var(--cw-accent);
      }
      .cw-drawer-chunk h5 { margin: 0 0 4px 0;
      color: var(--cw-text); }
      .cw-drawer-chunk p { margin: 0; font-size: 12px; color: var(--cw-text-muted);
      }
      
      /* Comet Animation (Horizontal) */
      .cw-comet-sky {
        position: absolute;
        inset: 0;
        z-index: 201;
        pointer-events: none;
        overflow: hidden;
        opacity: 0;
      }
      .cw-comet-sky.animate {
        opacity: 1;
        animation: fade-out-sky 3s ease-out 1.5s forwards;
      }
      .cw-comet-streak {
        position: absolute;
        top: 30%;
        left: 110%;
        width: 500px;
        height: 3px;
        background: linear-gradient(to left, var(--cw-accent-glow), transparent);
        border-radius: 2px;
        box-shadow: 0 0 15px 5px var(--cw-accent-glow);
        opacity: 1;
        animation: comet-fly-horizontal 2.5s ease-in-out 0.5s forwards;
      }
      
      @keyframes comet-fly-horizontal {
        0% {
          transform: translateX(0);
          opacity: 1;
        }
        100% {
          transform: translateX(-150vw);
          opacity: 1;
        }
      }
      @keyframes fade-out-sky {
        from { opacity: 1;
      }
        to { opacity: 0;
      }
      }
      
      /* Modal for Chunk Viewer */
      .cw-modal-backdrop {
        position: absolute;
        inset: 0; z-index: 1000;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(5px);
        -webkit-backdrop-filter: blur(5px);
        opacity: 0; visibility: hidden;
        transition: opacity 0.3s ease, visibility 0.3s ease;
        display: flex; align-items: center; justify-content: center;
      }
      .cw-modal-backdrop.visible {
        opacity: 1; visibility: visible;
      }
      .cw-modal-content {
        background: var(--cw-bg-secondary);
        border: 1px solid var(--cw-border);
        border-radius: 16px; padding: 24px;
        width: 700px; max-width: 90%; max-height: 80vh;
        box-shadow: 0 20px 50px rgba(0,0,0,0.3);
        display: flex; flex-direction: column;
        transform: scale(0.9);
        transition: transform 0.3s ease;
      }
      .cw-modal-backdrop.visible .cw-modal-content {
        transform: scale(1);
      }
      .cw-modal-content h3 {
        margin: 0 0 16px 0;
        color: var(--cw-accent);
        font-size: 20px;
        white-space: normal;
        overflow-wrap: break-word;
      }
      .cw-modal-text {
        overflow-y: auto;
        font-size: 15px;
        color: var(--cw-text-muted); line-height: 1.7;
      }
      
      /* Scrollbar Fix */
      .cw-summary-center-content::-webkit-scrollbar,
      .cw-panel-content::-webkit-scrollbar,
     
      .cw-drawer-content::-webkit-scrollbar,
      .cw-modal-text::-webkit-scrollbar {
        width: 6px;
      }
      .cw-summary-center-content::-webkit-scrollbar-track,
      .cw-panel-content::-webkit-scrollbar-track,
      
      .cw-drawer-content::-webkit-scrollbar-track,
      .cw-modal-text::-webkit-scrollbar-track {
        background: var(--cw-border);
        border-radius: 3px;
      }
      .cw-summary-center-content::-webkit-scrollbar-thumb,
      .cw-panel-content::-webkit-scrollbar-thumb,
    
      .cw-drawer-content::-webkit-scrollbar-thumb,
      .cw-modal-text::-webkit-scrollbar-thumb {
        background: var(--cw-accent-alt);
        border-radius: 3px;
      }

      /* 🌟 ADDED: CSS for Orb Icon Centering (from contentHub.js) */
      /* 🌟 MODIFIED: Added default theme styles */
      .orb-core {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        color: white; /* Default icon color (dark orb) */
        background: #1a1a2e; /* Dark core background */
        border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, 0.1);
        box-shadow: 0 0 10px rgba(0,0,0,0.5) inset;
      }
      
      /* 🌟 ADDED: CSS for Orb Theme Toggling (from contentHub.js) */
      /* 🌟 MODIFIED: Changed to a "purple" theme */
      
      /* 🌟 ADDED: Orb icon theme switching */
      .orb-icon {
        transition: opacity 0.3s ease;
      }
      .orb-icon-alt {
        display: none; /* Hide by default */
        border-radius: 50%; /* Round the logo */
      }
      .cw-orb.theme-alt .orb-icon-default {
        display: none; /* Hide default SVG */
      }
      .cw-orb.theme-alt .orb-icon-alt {
        display: block; /* Show alt logo */
      }
      /* 🌟 END: Orb icon theme switching */
      
      .cw-orb.theme-alt .orb-core {
        /* color: var(--cw-accent-alt); */ /* 🌟 REMOVED: No longer needed for icon */
        background: #1a1a2e; /* Dark core background */
        border: 2px solid rgba(255, 255, 255, 0.1); /* Keep light border */
        box-shadow: 0 0 10px rgba(0,0,0,0.5) inset; /* Keep dark inset */
        filter: none; /* Remove old filter */
        transition: filter 0.4s ease, background 0.4s ease, color 0.4s ease, border 0.4s ease;
      }
      .cw-orb.theme-alt .orb-glow {
         /* Purple glow */
         box-shadow: 0 0 35px 8px var(--cw-accent-alt), 0 0 15px 4px var(--cw-accent-alt) inset;
         transition: box-shadow 0.4s ease;
      }
      .cw-orb .orb-core {
         /* Add transition for returning to default */
         transition: filter 0.4s ease, background 0.4s ease, color 0.4s ease, border 0.4s ease, box-shadow 0.4s ease;
      }
      
      /* Animations */
      
      /* 🌟 FIXED: Split rotate animation to fix vortex centering */
      @keyframes rotate-center {
        from { transform: translate(-50%, -50%) rotate(0deg);
      }
        to { transform: translate(-50%, -50%) rotate(360deg);
      }
      }
      
      @keyframes rotate-simple {
        from { transform: rotate(0deg);
      }
        to { transform: rotate(360deg);
      }
      }
      
      @keyframes slide-in-left {
        from { transform: translateX(-50px);
        opacity: 0; }
        to { transform: translateX(0); opacity: 1;
      }
      }
      @keyframes slide-in-right {
        from { transform: translateX(50px);
        opacity: 0; }
        to { transform: translateX(0); opacity: 1;
      }
      }
        @keyframes float-vacuum {
        0% { transform: translate(0, 0) rotateZ(0deg);
      }
        25% { transform: translate(5px, 10px) rotateZ(1deg);
      }
        50% { transform: translate(0, 15px) rotateZ(0deg);
      }
        75% { transform: translate(-5px, 10px) rotateZ(-1deg);
      }
        100% { transform: translate(0, 0) rotateZ(0deg);
      }
      }
      
      @keyframes twinkle {
        from { opacity: 0.2;
        transform: scale(0.8); }
        to { opacity: 0.7; transform: scale(1);
      }
      }
    `;
    
    document.head.appendChild(style);
  }
  // ==================== OVERLAY UI ====================
  createOverlay() {
    if (document.querySelector('.cw-overlay-container')) return; // Prevent duplicates
    
    // Get logo URL (requires "web_accessible_resources" in manifest)
    const logoUrl = chrome.runtime.getURL('src/images/icon48.png');

    this.overlay = document.createElement('div');
    this.overlay.className = 'cw-overlay-container';
    const overlayContent = document.createElement('div');
    overlayContent.className = 'cw-overlay';
    if (this.theme === 'light') {
      overlayContent.classList.add('light-theme');
    }
    
// 🌟 🌟 🌟 MODIFIED: Replaced all SVGs and IMGs with EMOJIS 🌟 🌟 🌟
overlayContent.innerHTML = `
      <div class="cw-starfield">
        <div class="cw-star"></div><div class="cw-star"></div>
        <div class="cw-star"></div><div class="cw-star"></div>
        <div class="cw-star"></div><div class="cw-star"></div>
      </div>
      <div class="cw-animated-grid"></div>
      <div class="cw-floating-orbs">
        <div class="cw-floating-orb"></div><div class="cw-floating-orb"></div>
        <div class="cw-floating-orb"></div><div class="cw-floating-orb"></div>
        <div class="cw-floating-orb"></div>
      </div>
  
     
      <div class="cw-background-comets">
      </div>
      
      <div class="cw-header">

        <div class="cw-header-title">
          <img src="${logoUrl}" class="cw-header-logo" />
          Crucible Insights
        </div>
        <div class="cw-header-controls">
        
          <button class="cw-icon-btn" id="cw-swap-view" title="Swap Panels">
            🔄
          </button>

          <button class="cw-icon-btn" id="cw-theme-toggle" title="Toggle Theme">
            <span class="cw-icon-sun">☀️</span>
            <span class="cw-icon-moon">🌙</span>
          </button>
          
          <button class="cw-icon-btn" id="cw-close-overlay" title="Close">
            ✖️
          </button>
        </div>
      </div>
      
      <div class="cw-content-wrapper" id="cw-content-wrapper">
      
        <div class="cw-drawer" id="cw-drawer">
          </div>
    
         
        <div class="cw-main-view" id="cw-main-view">
        
          <div class="cw-processing-vortex" id="cw-processing-vortex">
            <div class="cw-vortex-orbit-container">
              <div class="cw-vortex-comet"></div>
            </div>
            <div class="cw-vortex-status" id="cw-vortex-status">Initializing...</div>
          </div>
  
         
          <div class="cw-chunk-popups-container" id="cw-chunk-popups-container"></div>
          
          <div class="cw-summary-center" id="cw-summary-center"></div>

          <div class="cw-main-content" id="cw-main-content">
            <div class="cw-panel-left" id="cw-panel-left">
              </div>
            <div class="cw-panel-right" id="cw-panel-right"></div>
    
           
          </div>
        
          <div class="cw-comet-sky" id="cw-comet-sky">
            <div class="cw-comet-streak"></div>
          </div>
          
          <div class="cw-modal-backdrop" id="cw-chunk-modal">
            <div class="cw-modal-content">
              <h3 id="cw-modal-title"></h3>
 
              <div class="cw-modal-text" id="cw-modal-text"></div>
            </div>
          </div>

        </div> <div class="cw-drawer-handle" id="cw-drawer-handle">
          </div>

      </div> `;
    this.overlay.appendChild(overlayContent);
    
    // 🌟 MODIFIED: Bound `this` context for event listeners
    this.overlay.querySelector('#cw-close-overlay').addEventListener('click', this.hideOverlay.bind(this));
    this.overlay.querySelector('#cw-theme-toggle').addEventListener('click', this.toggleTheme.bind(this));
    this.overlay.querySelector('#cw-swap-view').addEventListener('click', this.swapMainView.bind(this));
    this.overlay.querySelector('#cw-drawer-handle').addEventListener('click', this.toggleDrawer.bind(this));
    
    this.overlay.querySelector('#cw-chunk-modal').addEventListener('click', (e) => {
      if (e.target.id === 'cw-chunk-modal') {
        this.closeChunkModal();
      }
    });

    // 🌟 MODIFIED: Set initial drawer icon with emoji
    this.overlay.querySelector('#cw-drawer-handle').innerHTML = `⋮`;
    document.body.appendChild(this.overlay);
  }

  showOverlay() {
    if (!this.overlay) this.createOverlay();
      const overlayElement = this.overlay.querySelector('.cw-overlay');
  overlayElement.classList.add('visible');
    if (!this.hasProcessed) {
      this.overlay.querySelector('#cw-processing-vortex').classList.add('visible');
      // Start loading messages
      this.startLoadingMessages();
    } else {
      const processingView = this.overlay.querySelector('#cw-processing-vortex');
      if (processingView) processingView.classList.remove('visible');
    }
    
    this.overlay.querySelector('.cw-overlay').classList.add('visible');
    this.isOverlayVisible = true;
    document.body.style.overflow = 'hidden';
  }

  hideOverlay() {
    if (!this.overlay) return;
    this.overlay.querySelector('.cw-overlay').classList.remove('visible');
    this.isOverlayVisible = false;
    document.body.style.overflow = '';
  }

  toggleOverlay() {
    if (this.isOverlayVisible) {
      this.hideOverlay();
    } else {
      this.showOverlay();
    }
  }
  
  toggleTheme() {
    this.theme = this.theme === 'dark' ?
'light' : 'dark';
    this.overlay.querySelector('.cw-overlay').classList.toggle('light-theme');
    localStorage.setItem('cw-theme', this.theme);

  }
  
  // 🌟 MODIFIED: Drawer Toggle Logic now uses EMOJIS
  toggleDrawer() {
    if (!this.overlay) return; // Safety check
    this.isDrawerOpen = !this.isDrawerOpen;
    const wrapper = this.overlay.querySelector('#cw-content-wrapper');
    const handle = this.overlay.querySelector('#cw-drawer-handle');
    
    wrapper.classList.toggle('drawer-open');
    handle.classList.toggle('is-open');

    // 🌟 MODIFIED: New icon toggle
    handle.innerHTML = this.isDrawerOpen ? `‹` : `⋮`;
  }
  
  // Main Panel Swap Logic (swaps drawer too)
  swapMainView() {
    if (!this.hasProcessed || !this.overlay) return; // Safety check
    this.isMainViewSummary = !this.isMainViewSummary;
    const swapBtn = this.overlay.querySelector('#cw-swap-view');
    const mainPanel = this.overlay.querySelector('#cw-panel-left');
    const drawer = this.overlay.querySelector('#cw-drawer');
    
    if (!mainPanel || !drawer) return;
    if (this.isMainViewSummary) {
      swapBtn.classList.remove('active');
      mainPanel.innerHTML = this.getSummaryPanelHTML();
      drawer.innerHTML = this.getChunksPanelHTML(true);
      // true = isForDrawer
    } else {
      swapBtn.classList.add('active');
      mainPanel.innerHTML = this.getChunksPanelHTML(false).replace('hidden', '');;
      // false = notForDrawer
      drawer.innerHTML = this.getSummaryPanelHTML(true);
    }
    
    // Re-attach listeners after swapping content
    this.addChunkClickListeners();
    this.addInsightHoverListeners();
  }

  // ==================== UI/UX FLOW & RENDERING ====================
  
  // Loading messages
  startLoadingMessages() {
    const statusEl = this.overlay?.querySelector('#cw-vortex-status'); // Safety check
    if (!statusEl) return;
    
    let msgIndex = 0;
    statusEl.textContent = this.loadingMessages[msgIndex];
    this.loadingStatusInterval = setInterval(() => {
      msgIndex = (msgIndex + 1) % this.loadingMessages.length;
      if (this.overlay) { // Check if still exists
        statusEl.textContent = this.loadingMessages[msgIndex];
      }
    }, 1500);
  }

  stopLoadingMessages() {
    if (this.loadingStatusInterval) {
      clearInterval(this.loadingStatusInterval);
      this.loadingStatusInterval = null;
    }
  }

  // STAGE 1: Update vortex status
  updateVortexStatus(count, total) {
    
    const statusEl = this.overlay?.querySelector('#cw-vortex-status'); // Safety check
    if (statusEl) {
      statusEl.textContent = `Processing Chunk ${count} / ${total}...`;
    }
  }

  // STAGE 1: Render a floating chunk (unchanged)
  renderFloatingChunk(summary, index) {
    const container = this.overlay?.querySelector('#cw-chunk-popups-container'); // Safety check
    const vortex = this.overlay?.querySelector('.cw-processing-vortex'); // Safety check
    if (!container || !vortex) return;
    
    const card = document.createElement('div');
    card.className = `cw-floating-chunk cw-chunk-slot-${(index % 5) + 1}`;
    card.dataset.chunkId = summary.chunkId;
    card.innerHTML = `
      <h4>${this.escapeHTML(summary.title)}</h4>
      <p>${this.escapeHTML(summary.text)}</p>
    `;
    const vortexRect = vortex.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const vortexCenterX = (vortexRect.left - containerRect.left) + (vortexRect.width / 2);
    const vortexCenterY = (vortexRect.top - containerRect.top) + (vortexRect.height / 2);
    const slotStyle = getComputedStyle(card);
    const cardLeft = parseFloat(slotStyle.left) / 100 * containerRect.width;
    const cardTop = parseFloat(slotStyle.top) / 100 * containerRect.height;
    const cardWidth = parseFloat(slotStyle.width);
    const cardHeight = parseFloat(slotStyle.height);
    const targetX = vortexCenterX - (cardLeft + cardWidth / 2);
    const targetY = vortexCenterY - (cardTop + cardHeight / 2);

    card.style.setProperty('--vortex-x', `${targetX}px`);
    card.style.setProperty('--vortex-y', `${targetY}px`);

    container.appendChild(card);
    setTimeout(() => {
      card.classList.add('visible');
    }, 50 * index);
  }
  
  // Slower transition
// Slower transition
  async transitionToSummaryView() {
    const vortex = this.overlay?.querySelector('#cw-processing-vortex'); // Safety check
    const summaryCard = this.overlay?.querySelector('#cw-summary-center'); // Safety check
    if (!vortex || !summaryCard) return; // Exit if overlay was destroyed
    
    // 1. Stop loading text
    this.stopLoadingMessages();
    const statusEl = this.overlay.querySelector('#cw-vortex-status');
    if (statusEl) statusEl.textContent = '';
    
    // 2. Collapse all floating chunks (sequentially)
    this.overlay.querySelectorAll('.cw-floating-chunk').forEach((card, index) => {
      card.style.transitionDelay = `${index * 150}ms`;
      card.classList.add('collapsing');
    });
    // 3. Wait for collapse animation to be *fully* visible
    // (1.8s transition + (5 * 150ms delay) = 1800 + 750 = 2550ms)
    await this.sleep(2600);
    // 4. Hide vortex spinner
    if (vortex) vortex.classList.add('collapsing');
    // 5. Wait for vortex to start collapsing
    await this.sleep(300);
    // 6. Render and show summary card (as vortex fades)
    summaryCard.innerHTML = `
      <h3>Comprehensive Summary</h3>
      <div class="cw-summary-center-content">
        ${this.formatFullChunkText(this.comprehensiveSummary)}
      </div>
    `;
    summaryCard.classList.add('visible');
    
    // 7. Wait for summary card to be visible
    await this.sleep(600);
    const popups = this.overlay.querySelector('#cw-chunk-popups-container');
    if (vortex) vortex.remove();
    if (popups) popups.remove();
  }
  
  // STAGE 3: Transition to Final View
  async transitionToFinalView() {
    if (!this.overlay) return; // Guard against destroyed instance
    const summaryCard = this.overlay.querySelector('#cw-summary-center');
    const mainContent = this.overlay.querySelector('#cw-main-content');
    const panelLeft = this.overlay.querySelector('#cw-panel-left');
    const panelRight = this.overlay.querySelector('#cw-panel-right');
    const cometSky = this.overlay.querySelector('#cw-comet-sky');
    const drawer = this.overlay.querySelector('#cw-drawer');
    
    if (!summaryCard || !mainContent || !panelLeft || !panelRight || !cometSky || !drawer) return;
    
    // 1. Start comet animation (now visible)
    cometSky.classList.add('animate');
    // 2. Start summary card shift (it just fades)
    summaryCard.classList.add('shifting');
    // 3. Wait for shift to be part-way
    await this.sleep(300);
    // 4. Hide center summary, show final layout
    mainContent.classList.add('visible');
    // 5. Render final panels (default view)
    panelLeft.innerHTML = this.getSummaryPanelHTML();
    drawer.innerHTML = this.getChunksPanelHTML(true);
    // true = isForDrawer
    this.renderInsightsPanel(panelRight); // This now renders the CTA as well
    
    // 6. Add click/hover handlers
    this.addChunkClickListeners();
    this.addInsightHoverListeners();
    
    // 7. Wait for comet to finish
    await this.sleep(2000);
    // 8. Clean up
    summaryCard.remove();
    cometSky.remove();
    
    // 9. Show drawer handle
    this.overlay.querySelector('#cw-drawer-handle').classList.add('visible');
  }

// Helper to get Summary Panel HTML
  getSummaryPanelHTML(isForDrawer = false) {
    const id = isForDrawer ?
'cw-drawer-summary' : 'cw-summary-panel';
    const panelClass = isForDrawer ? '' : 'cw-summary-panel';
    // Animation class
    
    const header = isForDrawer ?
`
<div class="cw-drawer-header">Comprehensive Summary</div>` : `<h3>Comprehensive Summary</h3>`;
    const contentClass = isForDrawer ? 'cw-drawer-content' : 'cw-panel-content';
    const content = `
      ${header}
      <div class="${contentClass}">
        ${this.formatFullChunkText(this.comprehensiveSummary)}
      </div>
    `;
    if (isForDrawer) {
      return content;
    }
    
    return `
      <div class="cw-panel-base ${panelClass}" id="${id}">
        ${content}
      </div>
    `;
  }
  // Helper to get Chunks Panel HTML
  getChunksPanelHTML(isForDrawer = false) {
    const chunksHTML = this.chunkSummaries.map(summary => `
      <div class="${isForDrawer ? 'cw-drawer-chunk' : 'cw-panel-chunk'}" data-chunk-id="${summary.chunkId}" id="cw-chunk-${isForDrawer ? 'drawer' : 'panel'}-${summary.chunkId}">
        <h5>${this.escapeHTML(summary.title)}</h5>
        <p>${this.escapeHTML(summary.text)}</p>
      </div>
    `).join('');
    const header = isForDrawer ? `<div class="cw-drawer-header">Source Chunks</div>` : `<h3>Extracted Chunks</h3>`;
    const contentClass = isForDrawer ? 'cw-drawer-content' : 'cw-panel-content';
    const content = `
      ${header}
      <div class="${contentClass}">
        ${chunksHTML}
      </div>
    `;
    if (isForDrawer) {
      return content;
      // Drawer has its own structure
    }

    return `
  <div class="cw-panel-base cw-chunks-panel" id="cw-chunks-panel">        ${content}
      </div>
    `;
  }

  // STAGE 3: Render Insights Panel (UPDATED to include CTA and Title)
  renderInsightsPanel(targetContainer) {
    if (!this.personalizedInsight) {
      this.personalizedInsight = {
        headline: 'Insights Unavailable',
        subheading: 'Could not generate personalized insights for this page.',
        bullets: ['Please try again on a different page.']
      };
    }

    // Check for CTA text and create button HTML
    const ctaButtonHTML = this.cta_text
      ?
`
        <a class="cw-insight-cta" id="cw-insight-cta" target="_blank">
          ${this.escapeHTML(this.cta_text)} <span>↗</span>
        </a>
      `
      : '';
    targetContainer.innerHTML = `
      <div class="cw-insight-card">
        <h3>Key Insights</h3>
        <h2 class="cw-insight-headline">${this.escapeHTML(this.personalizedInsight.headline)}</h2>
        <p class="cw-insight-subheading">${this.escapeHTML(this.personalizedInsight.subheading)}</p>
        <ul class="cw-insight-bullets">
          ${(this.personalizedInsight.bullets || []).map((bullet, idx) => `
            <li class="cw-insight-bullet" data-insight-index="${idx}">
              ${this.escapeHTML(bullet)}
            
            </li>
          `).join('')}
        </ul>
        ${ctaButtonHTML} 
      </div>
    `;
    // Set the href for the CTA button after rendering
    if (this.cta_text) {
      const ctaButton = targetContainer.querySelector('#cw-insight-cta');
      if (ctaButton) {
        const query = encodeURIComponent(this.cta_text);
        ctaButton.href = `https://www.google.com/search?q=${query}`;
      }
    }
  }
  
  // Chunk Modal Logic
  addChunkClickListeners() {
    this.overlay?.querySelectorAll('.cw-panel-chunk, .cw-drawer-chunk').forEach(el => {
      el.addEventListener('click', (e) => {
        const chunkId = e.currentTarget.dataset.chunkId;
        this.openChunkModal(chunkId);
      });
    });
  }
  
  /**
   * 🌟 MODIFIED: Reverted to show summary text, not full source text.
   */
  openChunkModal(chunkId) {
    if (!this.overlay) return; // Safety check
    
    const chunkSummary = this.chunkSummaries.find(s => s.chunkId == chunkId);
    
    if (!chunkSummary) {
      console.error('Chunk summary not found for ID:', chunkId);
      return;
    }

    // 🌟 FIXED: Use the summary title and summary text
    this.overlay.querySelector('#cw-modal-title').textContent = `${this.escapeHTML(chunkSummary.title)}`;
    this.overlay.querySelector('#cw-modal-text').innerHTML = this.formatFullChunkText(chunkSummary.text);
    
    this.overlay.querySelector('#cw-chunk-modal').classList.add('visible');
  }
  
  closeChunkModal() {
    if (!this.overlay) return; // Safety check
    this.overlay.querySelector('#cw-chunk-modal').classList.remove('visible');
  }
  
  // Rewritten Insight Hover Logic for scrolling and visibility
  addInsightHoverListeners() {
    if (!this.overlay) return; // Safety check
    const bullets = this.overlay.querySelectorAll('.cw-insight-bullet');
    const handleHighlight = (insightIndex, add) => {
      if (!this.overlay) return; // Check if overlay still exists
      const chunkId = this.insightChunkMap.get(parseInt(insightIndex));
      if (chunkId === undefined) return;
  
      // Find both possible chunk elements
      const panelChunk = this.overlay.querySelector(`#cw-chunk-panel-${chunkId}`);
      const drawerChunk = this.overlay.querySelector(`#cw-chunk-drawer-${chunkId}`);
  
      // Check visibility based on current view state
      // isMainViewSummary = true  -> Summary is in Main, Chunks are in Drawer
      // isMainViewSummary = false -> Chunks are in Main, Summary is in Drawer
      
      if (this.isMainViewSummary) {
        // Chunks are in the DRAWER
        if (drawerChunk) {
          if (add) {
   
           drawerChunk.classList.add('highlighted');
           if (this.isDrawerOpen) { // Only scroll if drawer is open
              drawerChunk.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
          } else {
            drawerChunk.classList.remove('highlighted');
          }
        }
      } else {
        // Chunks are in the MAIN PANEL
        if (panelChunk) {
          if (add) {
            panelChunk.classList.add('highlighted');
            panelChunk.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          } else {
            panelChunk.classList.remove('highlighted');
          }
        }
      }
    };
    bullets.forEach(bullet => {
      bullet.addEventListener('mouseenter', (e) => {
        handleHighlight(e.currentTarget.dataset.insightIndex, true);
      });
      
      bullet.addEventListener('mouseleave', (e) => {
        handleHighlight(e.currentTarget.dataset.insightIndex, false);
      });
    });
  }

  // ==================== 🚀 REVISED PIPELINE ====================
 async runPipeline() {
    try {
      // Step 1 & 2
      const blocks = this.extractContentBlocks();
      this.chunks = this.chunkContent(blocks);
      const sortedChunks = [...this.chunks].sort((a, b) => b.score - a.score);
      const topChunks = sortedChunks.slice(0, this.CONFIG.MAX_CHUNKS);
      topChunks.sort((a, b) => a.id - b.id);
      this.totalChunksToProcess = topChunks.length;

      // Step 3
      console.log('⚡ [Pipeline] Processing chunks...');
      this.stopLoadingMessages();
      let index = 0;
      for (const chunk of topChunks) {
        await this.processChunkWithProfile(chunk, ++index);
      }
      
      // STAGE 2
      console.log('📚 [Pipeline] Generating summary...');
      const summaryPromise = this.generateSummaryOfSummaries();
      // Longer wait for chunks to be visible
      await Promise.all([summaryPromise, this.sleep(2000)]);
      await this.transitionToSummaryView();
      
      // STAGE 3
      console.log('✨ [Pipeline] Generating insights...');
      const insightPromise = this.generatePersonalizedInsight();
      const timerPromise = this.sleep(this.CONFIG.SUMMARY_PAUSE_MS);
      await Promise.all([insightPromise, timerPromise]);
      
      this.mapInsightsToChunks();
      
      await this.transitionToFinalView();
      console.log('🎉 [Pipeline] Complete!');
    } catch (error) {
      console.error('❌ [Pipeline] Failed:', error);
      this.showError(error.message);
    } finally {
      this.isProcessing = false;
      this.hasProcessed = true;
      this.stopOrbSpin();
      this.blastOrbWave();
      this.stopLoadingMessages();
      // Ensure this stops
      this.overlay?.querySelector('.cw-overlay')?.classList.remove('is-processing-pipeline');
    }
  }

  async processChunkWithProfile(chunk, index) {
    // ... (unchanged)
    this.updateVortexStatus(index, this.totalChunksToProcess);
    let summary;
    try {
      const response = await this.sendToBackground({
        type: 'SUMMARIZE_CHUNK_WITH_PROFILE',
        data: {
          text: chunk.text.substring(0, this.CONFIG.CHUNK_MAX),
          chunkId: chunk.id,
          score: chunk.score,
          profileSummary: this.userProfile?.summary,
          profileTopics: this.userProfile?.topics,
          profileConfidence: this.userProfile?.confidence,
  
          profileFocusStyle: this.userProfile?.focusStyle
        }
      }, 45000);
      if (!response?.success) throw new Error(response?.error || 'AI task failed');
      const resultData = this.parseAIResponse(response, `chunk ${chunk.id}`);
      summary = {
        chunkId: chunk.id,
        title: resultData.title ||
        `Chunk ${chunk.id + 1}`,
        text: resultData.summary ||
        chunk.text.substring(0, 120) + '...',
        score: chunk.score,
        sourceChunk: chunk, // This 'chunk' is from topChunks, which is from this.chunks
        profileAware: !!resultData.profileAware
      };
    } catch (error) {
      console.warn(`⚠️ [Processing] Chunk ${chunk.id} failed:`, error);
      summary = {
        chunkId: chunk.id,
        title: `Chunk ${chunk.id + 1} (Analysis Failed)`,
        text: chunk.text.substring(0, 120) + '...',
        score: chunk.score,
        sourceChunk: chunk,
        profileAware: false
      };
    }
    
    this.chunkSummaries.push(summary);
    this.renderFloatingChunk(summary, index - 1);
  }

  async generateSummaryOfSummaries() {
    try {
      const response = await this.sendToBackground({
        type: 'GENERATE_SUMMARY_OF_SUMMARIES',
        data: { 
          chunkSummaries: this.chunkSummaries,
          profileSummary: this.userProfile?.summary,
          profileTopics: this.userProfile?.topics,
          profileFocusStyle: this.userProfile?.focusStyle
        }
      }, 50000);
      if (!response?.success) throw new Error(response?.error || 'Summary failed');
      const resultData = this.parseAIResponse(response, 'summary-of-summaries');
      this.comprehensiveSummary = resultData.comprehensiveSummary ||
'No summary could be generated.';
    } catch (error) {
      console.warn('⚠️ [Summary] Generation failed, using fallback:', error);
      this.comprehensiveSummary = this.chunkSummaries.map(s => s.text).join('\n\n') || 'No summary available.';
    }
  }

  async generatePersonalizedInsight() {
    // ... (unchanged logic, but stores CTA)
    try {
      if (!this.comprehensiveSummary) throw new Error('No summary available');
      const pageDomain = await this.getWebPageDomain();
      const contentDomain = await this.getWebpageContentDomain();
      const response = await this.sendToBackground({
        type: 'GENERATE_FINAL_INSIGHT',
        data: {
          comprehensiveSummary: this.comprehensiveSummary,
          profileSummary: this.userProfile?.summary,
          profileTopics: this.userProfile?.topics,
          pageDomain: pageDomain,
          contentDomain: contentDomain,
          chunkIds: this.chunkSummaries.map(s => s.chunkId),
          
          chunkScores: this.chunkSummaries.map(s => s.score)
        }
      }, 40000);
      if (!response?.success) throw new Error(response?.error || 'Insight failed');
      
      const resultData = this.parseAIResponse(response, 'final-insight');
      this.personalizedInsight = resultData;
      this.cta_text = resultData.cta ||
null; // Store the CTA
      
    } catch (error) {
      console.warn('⚠️ [Insight] Generation failed, setting fallback:', error);
      this.personalizedInsight = null;
      this.cta_text = null; // Ensure CTA is null on fail
    }
  }

  showError(message) {
    // ... (unchanged)
    this.stopLoadingMessages();
    const processingView = this.overlay?.querySelector('#cw-processing-vortex'); // Safety check
    if (processingView) {
      processingView.innerHTML = `
        <div style="padding: 20px; text-align: center; color: var(--cw-accent-red);">
          <h2 style="margin-bottom: 16px;">Analysis Failed</h2>
          <p style="color: var(--cw-text-muted);">${this.escapeHTML(message)}</p>
        </div>
      `;
    }
    this.isProcessing = false;
    this.hasProcessed = true; 
    this.stopOrbSpin();
  }

  // ==================== (Unchanged Core Logic) ====================
  // ... (extractContentBlocks, isValidContentElement, etc...)
  // ================================================================

  // ==================== 🚀 PRODUCTION CONTENT EXTRACTION ====================
  extractContentBlocks() {
    console.log('🔍 [Extraction] Starting multi-strategy content extraction...');
    const contentCandidates = [
      { selector: 'article', priority: 10 },
      { selector: 'main', priority: 9 },
      { selector: '[role="main"]', priority: 8 },
      { selector: '.post-content, .article-content, .entry-content, .content-body', priority: 7 },
      { selector: '#content, #main-content, #article', priority: 6 },
      { selector: 'body', priority: 1 }
    ];
    let mainContent = null;
    for (const candidate of contentCandidates) {
      const element = document.querySelector(candidate.selector);
      if (element && this.hasSubstantialContent(element)) {
        mainContent = element;
        break;
      }
    }
    if (!mainContent) mainContent = document.body;
    const contentSelectors = [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'blockquote',
      '.paragraph', '.text-block', '.content-block',
      '.article-body p', '.post-body p',
      'div.content', 'div.text', 'div.paragraph',
      'div[class*="content"]', 'div[class*="text"]', 'div[class*="paragraph"]' // ✅ FIXED: Was [class**="paragraph"]
    ].join(',');
    const candidates = Array.from(mainContent.querySelectorAll(contentSelectors))
      .filter(el => this.isValidContentElement(el));
    const blocks = this.groupContentBlocks(candidates);
    console.log(`✅ [Extraction] Created ${blocks.length} content blocks`);
    return blocks;
  }
  hasSubstantialContent(element) {
    if (!element) return false;
    const text = element.textContent.trim();
    const wordCount = text.split(/\s+/).length;
    return wordCount >= 100;
  }
  isValidContentElement(el) {
    if (!el || !el.textContent) return false;
    if (el.closest('.cw-overlay-container, .cw-orb, #chromeworld-orb')) return false; // Hardened selector
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const text = el.textContent.replace(/[\s\u200B-\u200D\uFEFF]+/g, ' ').trim();
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
    if (text.length < this.CONFIG.MIN_BLOCK_LENGTH || wordCount < this.CONFIG.MIN_WORD_COUNT) return false;
    if (this.isBoilerplateContainer(el)) return false;
    if (this.isCodeBlock(el)) return false;
    if (this.hasHighLinkDensity(el, text)) return false;
    if (this.isLowQualityText(text)) return false;
    return true;
  }
  isBoilerplateContainer(el) {
    const boilerplateSelectors = [
      'nav', 'header', 'footer', 'aside', '.sidebar', '.menu', '.navigation',
      '.ad', '.advertisement', '.sponsor', '.social', '.share', '.sharing',
      '.comments', '.comment-section', '.related', '.recommendations',
      '.breadcrumb', '.pagination', '.popup', '.modal', '.overlay',
      '.cookie', '.banner', '[class*="nav"]', '[class*="menu"]',
      '[id*="nav"]', '[id*="menu"]'
    ];
    return boilerplateSelectors.some(selector => el.closest(selector));
  }
  isCodeBlock(el) {
    const tag = el.tagName.toLowerCase();
    if (['pre', 'code', 'kbd', 'samp'].includes(tag)) return true;
    const codeClasses = ['code', 'highlight', 'syntax', 'snippet'];
    const className = el.className.toLowerCase();
    return codeClasses.some(cls => className.includes(cls));
  }
  hasHighLinkDensity(el, text) {
    const links = el.querySelectorAll('a');
    if (links.length === 0) return false;
    let linkTextLength = 0;
    links.forEach(link => { linkTextLength += link.textContent.trim().length; });
    const linkDensity = text.length > 0 ? linkTextLength / text.length : 0;
    return linkDensity > this.CONFIG.MAX_LINK_DENSITY;
  }
  isLowQualityText(text) {
    const lowQualityPatterns = [
      /^©|copyright|all rights reserved/i, /^follow us|subscribe|newsletter/i,
      /^click here|read more|learn more$/i, /^tags:|category:|posted in/i,
      /^share on|tweet this/i, /^\d+\s*(comments?|shares?|likes?)$/i,
      /^cookie|privacy policy|terms of service/i
    ];
    return lowQualityPatterns.some(pattern => pattern.test(text.trim()));
  }
  groupContentBlocks(candidates) {
    const blocks = [];
    let currentBlock = { text: '', elements: [], tag: null, charCount: 0, type: 'paragraph' };
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      const text = el.textContent.trim();
      const tag = el.tagName.toLowerCase();
      const blockType = this.determineBlockType(el, tag);
      const shouldStartNew = this.shouldStartNewBlock(currentBlock, blockType, tag, text.length);
      if (shouldStartNew && currentBlock.text.length > 0) {
        blocks.push({ ...currentBlock });
        currentBlock = { text: '', elements: [], tag: null, charCount: 0, type: 'paragraph' };
      }
      currentBlock.elements.push(el);
      currentBlock.text += (currentBlock.text ? '\n\n' : '') + text;
      currentBlock.charCount = currentBlock.text.length;
      currentBlock.tag = currentBlock.tag || tag;
      currentBlock.type = blockType;
    }
    if (currentBlock.text.length > 0) blocks.push(currentBlock);
    return blocks.filter(block => block.charCount >= this.CONFIG.MIN_BLOCK_LENGTH);
  }
  determineBlockType(el, tag) {
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'blockquote') return 'quote';
    if (tag === 'li' || el.closest('ul, ol')) return 'list';
    if (tag === 'pre' || tag === 'code') return 'code';
    return 'paragraph';
  }
  shouldStartNewBlock(currentBlock, newBlockType, newTag, newLength) {
    if (newBlockType === 'heading') return true;
    if (currentBlock.type !== newBlockType) return true;
    if (currentBlock.charCount > 1000) return true;
    return false;
  }
  // ==================== 🎯 PROFILE-FIRST CHUNKING ====================
  chunkContent(blocks) {
    console.log(`🔨 [Chunking] Starting profile-aware chunking of ${blocks.length} blocks...`);
    const chunks = [];
    let currentChunk = { text: '', charCount: 0, blocks: [], semanticBoundary: false, startsWithHeading: false };
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const isHeading = block.type === 'heading';
      const isMajorHeading = isHeading && /^h[1-2]$/.test(block.tag);
      const shouldSplit = isMajorHeading && currentChunk.charCount >= this.CONFIG.CHUNK_MIN && block.type !== 'list' && block.type !== 'code';
      if (shouldSplit && currentChunk.blocks.length > 0) {
        chunks.push(this.finalizeChunk(currentChunk, chunks.length));
        currentChunk = { text: block.text, charCount: block.charCount, blocks: [block], semanticBoundary: true, startsWithHeading: true };
        continue;
      }
      currentChunk.blocks.push(block);
      // ========== FIX 1 & 2 ==========
      currentChunk.text += (currentChunk.text ? '\n\n' : '') + block.text;
      
      // ✅ FIXED: Was 'currentBlock'
      currentChunk.charCount = currentChunk.text.length;
      // ===============================
      
      if (!currentChunk.startsWithHeading && isHeading) currentChunk.startsWithHeading = true;
      if (currentChunk.charCount >= this.CONFIG.CHUNK_MAX) {
        const splitChunks = this.intelligentSplit(currentChunk, chunks.length);
        chunks.push(...splitChunks);
        currentChunk = { text: '', charCount: 0, blocks: [], semanticBoundary: false, startsWithHeading: false };
      }
    }
    // ========== FIX 3 ==========
    
    // ✅ FIXED: Was 'currentBlock'
    if (currentChunk.blocks.length > 0) chunks.push(this.finalizeChunk(currentChunk, chunks.length));
    // ===========================
    
    const chunksWithOverlap = this.addChunkOverlap(chunks);
    console.log(`✅ [Chunking] Created ${chunksWithOverlap.length} chunks with overlap`);
    
    // Store original chunks *before* scoring
    this.chunks = chunksWithOverlap;
    return chunksWithOverlap.map((chunk, index) => {
      chunk.score = this.scoreChunkWithProfile(chunk, index);
      return chunk;
    });
  }
  finalizeChunk(chunk, index) {
    return {
      id: index, text: chunk.text, charCount: chunk.charCount,
      blocks: chunk.blocks, semanticBoundary: chunk.semanticBoundary,
      startsWithHeading: chunk.startsWithHeading,
      hasCode: chunk.blocks.some(b => b.type === 'code'),
      hasList: chunk.blocks.some(b => b.type === 'list')
    };
  }
  intelligentSplit(largeChunk, startIndex) {
    const chunks = [];
    const sentences = this.splitIntoSentences(largeChunk.text);
    let currentSplit = { text: '', charCount: 0, blocks: [], semanticBoundary: false, startsWithHeading: largeChunk.startsWithHeading };
    for (const sentence of sentences) {
      const sentenceLength = sentence.length;
      if (currentSplit.charCount + sentenceLength > this.CONFIG.CHUNK_MAX && currentSplit.charCount >= this.CONFIG.CHUNK_MIN) {
        chunks.push(this.finalizeChunk(currentSplit, startIndex + chunks.length));
        currentSplit = { text: sentence, charCount: sentenceLength, blocks: [], semanticBoundary: false, startsWithHeading: false };
      } else {
        currentSplit.text += (currentSplit.text ? ' ' : '') + sentence;
        currentSplit.charCount = currentSplit.text.length;
      }
    }
    if (currentSplit.charCount > 0) chunks.push(this.finalizeChunk(currentSplit, startIndex + chunks.length));
    return chunks;
  }
  splitIntoSentences(text) {
    return text.split(/(?<=[.!?])\s+(?=[A-Z])/).map(s => s.trim()).filter(s => s.length > 0);
  }
  addChunkOverlap(chunks) {
    if (chunks.length <= 1) return chunks;
    const chunksWithOverlap = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = { ...chunks[i] };
      if (i > 0) {
        const prevChunk = chunks[i - 1];
        const overlapText = this.getLastNChars(prevChunk.text, this.CONFIG.CHUNK_OVERLAP);
        chunk.text = overlapText + '\n\n' + chunk.text;
        chunk.charCount = chunk.text.length;
        chunk.hasOverlapPrefix = true;
      }
      chunksWithOverlap.push(chunk);
    }
    return chunksWithOverlap;
  }
  getLastNChars(text, n) {
    if (text.length <= n) return text;
    const substring = text.slice(-n);
    const sentenceStart = substring.search(/[.!?]\s+/);
    if (sentenceStart !== -1) return substring.slice(sentenceStart + 2);
    return substring;
  }
  // ==================== 🎯 PROFILE-WEIGHTED SCORING ====================
  scoreChunkWithProfile(chunk, index) {
    const text = chunk.text.toLowerCase();
    let profileScore = 0, structureScore = 0, positionScore = 0;
    if (this.userProfile?.topics && this.userProfile.topics.length > 0) {
      let topicMatches = 0, topicDepth = 0;
      for (const topic of this.userProfile.topics) {
        const topicLower = topic.toLowerCase();
        const occurrences = (text.match(new RegExp(this.escapeRegExp(topicLower), 'g')) || []).length;
        if (occurrences > 0) {
          topicMatches++;
          topicDepth += Math.min(occurrences * 0.1, 0.3);
        }
      }
      const matchRatio = this.userProfile.topics.length > 0 ?
      topicMatches / this.userProfile.topics.length : 0;
      profileScore = (matchRatio * 0.5) + topicDepth;
    } else {
      profileScore = 0.3;
    }
    if (chunk.startsWithHeading) structureScore += 0.1;
    if (chunk.semanticBoundary) structureScore += 0.05;
    if (chunk.charCount > 1000) structureScore += 0.05;
    positionScore = Math.max(0, 0.1 - (index * 0.01));
    const totalScore = (profileScore * this.CONFIG.PROFILE_WEIGHT) + (structureScore * this.CONFIG.STRUCTURE_WEIGHT) + (positionScore * this.CONFIG.POSITION_WEIGHT);
    const finalScore = Math.min(1.0, totalScore);
    return finalScore;
  }
  
  // ==================== 🌟 HEURISTIC MAPPING ====================
  mapInsightsToChunks() {
    console.log('🗺️ [Mapping] Starting insight-to-chunk mapping...');
    this.insightChunkMap.clear();

    if (!this.personalizedInsight?.bullets || !this.chunkSummaries) {
      console.warn('⚠️ [Mapping] Missing insights or chunks. Skipping.');
      return;
    }

    // Prepare chunk keywords once
    const chunkKeywords = this.chunkSummaries.map(summary => ({
      id: summary.chunkId,
      keywords: this.getKeywords(summary.text)
    }));
    this.personalizedInsight.bullets.forEach((bullet, index) => {
      const insightKeywords = this.getKeywords(bullet);
      let bestChunkId = -1;
      let maxScore = 0;

      for (const chunk of chunkKeywords) {
        const intersection = chunk.keywords.filter(kw => insightKeywords.includes(kw));
        const score = intersection.length;
        
        if (score > maxScore) {
          maxScore = score;
   
           bestChunkId = chunk.id;
        }
      }

      // Set a minimum score threshold
      if (maxScore >= 2) { // Must have at least 2 keyword overlaps
        this.insightChunkMap.set(index, bestChunkId);
        console.log(`[Mapping] Mapped insight ${index} -> chunk ${bestChunkId} (Score: ${maxScore})`);
      } else {
        console.log(`[Mapping] Skipped insight ${index} (Score: ${maxScore}, Threshold: 
2)`);
      }
    });
  }
  
  getKeywords(text) {
    return text
      .toLowerCase()
      .split(/[\s,.'";!?()]+/)
      .filter(word => word.length > 2 && !this.STOP_WORDS.has(word));
  }

  // ==================== DOMAIN EXTRACTION ====================
  // ... (unchanged)
  async getWebPageDomain() {
    try {
      let hostname = window.location.hostname;
      if (hostname.startsWith('www.')) hostname = hostname.substring(4);
      return hostname || 'local-file';
    } catch (e) {
      return 'unknown-domain';
   
    }
  }
  async getWebpageContentDomain() {
    const textAreas = [
      { text: document.title || '', weight: 3 },
      { text: document.querySelector('h1')?.textContent || '', weight: 2 },
      { text: document.querySelector('h2')?.textContent || '', weight: 1.5 },
      { text: document.querySelector('meta[name="description"]')?.content || '', weight: 1 }
    ];
    let topicScores = {};
    let highestScore = 0;
    let dominantTopic = 'General Browsing';
    for (const [topic, keywords] of Object.entries(this.HEURISTIC_TOPICS)) {
      topicScores[topic] = 0;
      const topicName = topic.toLowerCase();
      for (const area of textAreas) {
        const areaText = area.text.toLowerCase();
        for (const keyword of keywords) {
          if (areaText.includes(keyword)) topicScores[topic] += area.weight;
        }
        if (areaText.includes(topicName)) topicScores[topic] += area.weight * 2;
      }
    }
    for (const [topic, score] of Object.entries(topicScores)) {
      if (score > highestScore) {
        highestScore = score;
        dominantTopic = topic;
      }
    }
    return highestScore > 3 ? dominantTopic : 'General Browsing';
  }
  
  // ==================== COMMUNICATION ====================
  // ... (unchanged)
  setupMessageHandlers() {
    if (chrome?.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        // This is just a basic listener. 
        // The main settings listener is now in environmentCheck.js
        sendResponse({ success: true });
        return true; // Keep channel open for async
      });
    }
  }
  async sendToBackground(message, timeout = 10000) {
    return new Promise((resolve) => {
      let done = false;
      const timeoutId = setTimeout(() => {
        if (!done) {
          done = true;
          console.error('[ERROR] Background message timeout:', message.type, timeout);
          resolve({ success: false, error: 'Timeout' });
        }
   
      }, timeout);
      try {
        if (!chrome.runtime || !chrome.runtime.id) {
            // Extension context invalidated, stop trying
            if (!done) {
                done = true;
                clearTimeout(timeoutId);
                console.warn('[WARN] Extension context invalidated. Stopping message send.');
                resolve({ success: false, error: 'Extension context invalidated' });
            }
            return;
        }
        chrome.runtime.sendMessage(message, (resp) => {
          if (done) return;
          done = true;
          clearTimeout(timeoutId);
          if (chrome.runtime.lastError) {
            console.error('[ERROR] Chrome runtime error:', chrome.runtime.lastError.message);
            resolve({ success: false, error: 
            chrome.runtime.lastError.message });
          } else {
            resolve(resp || { success: false, error: 'No response' });
          }
        });
      } catch (e) {
        if (!done) {
          done = true;
          clearTimeout(timeoutId);
        
          console.error('[ERROR] Send message exception:', e);
          resolve({ success: false, error: e.message });
        }
      }
    });
  }
  
  // ==================== API PARSING ====================
  // ... (unchanged)
  parseAIResponse(response, taskType) {
    let resultData = response?.data?.data?.data ||
    response?.data?.result?.data ||
                     response?.data?.data || 
                     response?.data;
    if (!resultData || typeof resultData !== 'object') {
      console.error(`[ERROR] Invalid resultData for ${taskType}:`, resultData);
      throw new Error(`Invalid response structure for ${taskType} - check raw response`);
    }
    return resultData;
  }
  
  // ==================== UTILITIES ====================
  // ... (unchanged)
  escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  }
  escapeRegExp(string) {
    return String(string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  
  // Cleans up AI-generated bullet points
  formatFullChunkText(text) {
    if (!text) return '';
    return this.escapeHTML(text)
      .replace(/(\n|^)\s*[\*|-]\s/g, '$1') // Remove * or - from start of lines
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>');
  }
  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

    // ================================================================
    // ===== END OF YOUR ORIGINAL conhuby.txt CLASS               =====
    // ================================================================


    // 🌟 REPLACED: The old initializeContentHub() function is replaced
    // with this new dynamic loading logic.
    
    /**
     * Main execution logic
     */
    
    // 1. Initial run on page load
    initializeHub();

    // 2. Listen for dynamic updates from the popup/background
    window.addEventListener('chromeworldSettingsUpdated', () => {
        console.log('Chromeworld: Hub received settings update.');
        
        if (window.chromeworldSettings.aiEnabled) {
            // AI is enabled. Either initialize or update theme.
            initializeHub(); // This function is idempotent, it will just call applyTheme
        } else {
            // AI is disabled. Tear down.
            teardownHub(); 
        }
    });

    } // <-- This brace closes the main 'else' block
})(); // <-- This closes the async IIFE