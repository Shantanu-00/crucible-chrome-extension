// popup.js - With New Status & Session Logic (and ID Fixes)
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initializePopup();
    setupEventListeners();
  } catch (error) {
    console.error('Popup initialization failed:', error);
    showError('Initialization failed.');
  }
});

async function initializePopup() {
  await Promise.all([
    loadMetrics(),
    loadToggleStates(), // This now also triggers the status update
    loadSessionTime()   // This replaces the old startSessionTimer
  ]);
}

function setupEventListeners() {
  document.getElementById('openDashboard').addEventListener('click', openDashboard);
  // FIX: Changed 'toggleProfileSync' to 'toggleProfileForge' to match HTML
  document.getElementById('toggleProfileForge').addEventListener('change', toggleProfileSync);
  document.getElementById('toggleAI').addEventListener('change', toggleAI);
  document.getElementById('toggleOrb').addEventListener('click', toggleOrb);
}

/**
 * Fetches the session start time from the background script
 * and calculates the elapsed minutes.
 */
async function loadSessionTime() {
  try {
    // This message 'GET_SESSION_START_TIME' is now handled by background.js
    const response = await sendMessage({ type: 'GET_SESSION_START_TIME' });
    
    if (response && response.success && response.data.startTime) {
      const startTime = new Date(response.data.startTime).getTime(); // Parse ISO string
      const now = Date.now();
      const elapsedMs = now - startTime;
      const elapsedMinutes = Math.floor(elapsedMs / 60000);
      updateElement('sessionTime', `Session: ${elapsedMinutes}m`);
    } else {
      updateElement('sessionTime', 'Session: 0m');
    }
  } catch (error) {
    console.error('Load session time error:', error);
    updateElement('sessionTime', 'Session: N/A');
  }
}

/**
 * Fetches all settings in one call.
 */
async function loadToggleStates() {
  let aiEnabled = false;
  let profileEnabled = false;

  try {
    // Use the new single message
    const response = await sendMessage({ type: 'GET_ALL_SETTINGS' });
    
    if (response && response.success) {
      const settings = response.data;
      aiEnabled = settings.aiEnabled;
      profileEnabled = settings.profileSyncEnabled;
      
      document.getElementById('toggleAI').checked = aiEnabled;
      // FIX: Changed 'toggleProfileSync' to 'toggleProfileForge' to match HTML
      document.getElementById('toggleProfileForge').checked = profileEnabled;
      // Note: We don't need to set the orb toggle, it's just a button.
    }
  } catch (error) {
    console.error('Load toggle states error:', error);
  } finally {
    // Update the status text based on the final states
    updateStatus(aiEnabled, profileEnabled);
  }
}

/**
 * Updates the "Status" text based on the toggle states.
 */
function updateStatus(aiEnabled, profileEnabled) {
  const statusEl = document.getElementById('status');
  if (aiEnabled && profileEnabled) {
    statusEl.textContent = 'Status: Active';
  } else if (profileEnabled) {
    statusEl.textContent = 'Status: Syncing';
  } else if (aiEnabled) {
    // AI is on, but tracking is off
    statusEl.textContent = 'Status: Analyzing';
  } else {
    statusEl.textContent = 'Status: Offline';
  }
}

async function toggleProfileSync(event) {
  const enabled = event.target.checked;
  try {
    await sendMessage({ 
      type: 'TOGGLE_TRACKING', // This message is now handled
      enabled: enabled 
    });
    showNotification(enabled ? 'Profile Sync Resumed' : 'Profile Sync Paused');
    const aiEnabled = document.getElementById('toggleAI').checked;
    updateStatus(aiEnabled, enabled);
  } catch (error) {
    event.target.checked = !enabled; // Revert toggle on failure
    showError('Failed to update sync');
  }
}

async function toggleAI(event) {
  const enabled = event.target.checked;
  try {
    await sendMessage({ 
      type: 'TOGGLE_AI', // This message is now handled
      enabled: enabled 
    });
    showNotification(enabled ? 'AI Features Enabled' : 'AI Features Disabled');
    // FIX: Changed 'toggleProfileSync' to 'toggleProfileForge' to match HTML
    const profileEnabled = document.getElementById('toggleProfileForge').checked;
    updateStatus(enabled, profileEnabled);
  } catch (error) {
    event.target.checked = !enabled; // Revert toggle on failure
    showError('Failed to update AI setting');
  }
}

// This now toggles the theme
async function toggleOrb() {
  try {
    // This message 'TOGGLE_ORB' now toggles the theme state
    const response = await sendMessage({ type: 'TOGGLE_ORB' });
    if (response && response.success) {
      // response.data.orbTheme is the *new* state
      showNotification(response.data.orbTheme ? 'Orb Theme: Alt' : 'Orb Theme: Default');
    }
  } catch (error) {
    showError(error.message);
  }
}

// --- Other functions (unchanged from previous version) ---

async function loadMetrics() {
  try {
    // Get 'ltp' (Long-Term Profile) stats
    const stats = await sendMessage({ type: 'GET_STATS', view: 'ltp' });
    if (stats && stats.success && stats.data) {
      // Re-map your metric names to the data from databaseService.js
      // FIX: Changed 'nexusPoints' to 'crucibleNodes' to match HTML
      updateElement('crucibleNodes', stats.data.uniqueSearchesCount || 0);
      updateElement('queryPulse', stats.data.topDomainCount || 0);     // Was queryPulse
      updateElement('totalFlux', stats.data.totalActiveTime || '0m');  // Was totalFlux
      updateElement('nodes', stats.data.snapshotCount || 0);         // Was nodes
    }
  } catch (error) {
    console.error('Load metrics error:', error);
  }
}

async function openDashboard() {
  chrome.tabs.create({ 
    url: chrome.runtime.getURL('src/dashboard/dashboard.html'),
    active: true 
  });
}

function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    if (!chrome.runtime || !chrome.runtime.id) {
        // Handle cases where the script runs in a context without chrome.runtime
        // (e.g., testing, or if the extension context is invalidated)
        console.warn("Chrome runtime not available.");
        return reject(new Error("Extension context invalidated."));
    }
    chrome.runtime.sendMessage(msg, response => {
      if (chrome.runtime.lastError) {
        console.error('❌ Runtime error:', chrome.runtime.lastError.message);
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response && response.success === false) { // Check for explicit failure
        console.error('❌ Response error:', response.error);
        reject(new Error(response.error || 'Request failed'));
      } else {
        resolve(response); // Resolve with the response (even if undefined or success:true)
      }
    });
  });
}

function updateElement(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function showNotification(msg, type = 'success') {
  const existing = document.querySelector('.notification');
  if (existing) existing.remove();

  const notif = document.createElement('div');
  notif.className = `notification ${type}`;
  notif.textContent = msg;
  document.body.appendChild(notif);
  setTimeout(() => notif.remove(), 2500);
}

function showError(msg) {
  showNotification(msg, 'error');
}
