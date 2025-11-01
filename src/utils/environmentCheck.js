// src/utils/environmentCheck.js

// 1. Synchronously create a settings promise
let _settingsResolve;
window.chromeworldSettingsPromise = new Promise((resolve) => {
    _settingsResolve = resolve;
});

// 2. Synchronously set a "default" disabled state.
// This prevents errors if scripts access it before the promise resolves.
window.chromeworldSettings = {
    isRestricted: true,
    profileSyncEnabled: false,
    aiEnabled: false,
    orbTheme: false
};

// 3. Start the async work in an IIFE
(async function() {
    'use strict';
    
    const isRestrictedPage = () => {
        const url = window.location.href.toLowerCase();
        
        if (url.startsWith('chrome://') || 
            url.startsWith('devtools://') ||
            url.startsWith('chrome-extension://') && window.location.pathname.endsWith('.html') ||
            url.includes('chrome.google.com/webstore')) {
            return true;
        }
        
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
            return true;
        }
        
        return false;
    };
    
    if (isRestrictedPage()) {
        console.warn('Chromeworld: Skipping execution on restricted page.');
        _settingsResolve(window.chromeworldSettings); // Resolve with restricted state
        throw new Error('Chromeworld: Restricted page bypass'); // This stops injection
    }
    
    // 4. Fetch settings
    try {
        // Add a check for runtime, in case it's invalid (e.g., on extension reload)
        if (!chrome.runtime || !chrome.runtime.id) {
            throw new Error("Extension context is invalid or not available.");
        }
        
        const settings = await chrome.runtime.sendMessage({ type: 'GET_ALL_SETTINGS' });
        
        if (settings && settings.success) {
            // Populate the real settings
            window.chromeworldSettings = {
                isRestricted: false,
                profileSyncEnabled: settings.data.profileSyncEnabled,
                aiEnabled: settings.data.aiEnabled,
                orbTheme: settings.data.orbTheme
            };
            console.log('Chromeworld: Settings loaded.', window.chromeworldSettings);
        } else {
            throw new Error(settings?.error || 'Failed to fetch settings from background.');
        }

    } catch (error) {
        // This is likely the "Unknown error"
        console.error('Chromeworld: Failed to fetch settings, using defaults. Error:', error.message);
        // We DO NOT throw an error here. We just let the default (disabled) settings apply.
        // This prevents the "An unknown error occurred" message.
    }

    // 5. Resolve the promise with whatever settings we ended up with
    // (either the real ones or the default disabled ones)
    _settingsResolve(window.chromeworldSettings);

    // 6. Set up the dynamic listener
    if (chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.type === 'SETTINGS_UPDATED') {
                console.log('Chromeworld: Received settings update. Re-fetching...');
                
                (async () => {
                    try {
                        const settings = await chrome.runtime.sendMessage({ type: 'GET_ALL_SETTINGS' });
                        if (settings && settings.success) {
                            // Update the global settings object
                            window.chromeworldSettings = {
                                ...window.chromeworldSettings,
                                isRestricted: false,
                                profileSyncEnabled: settings.data.profileSyncEnabled,
                                aiEnabled: settings.data.aiEnabled,
                                orbTheme: settings.data.orbTheme
                            };
                            console.log('Chromeworld: Settings updated dynamically.', window.chromeworldSettings);
                            
                            // Send a custom event that contentHub.js can listen for
                            window.dispatchEvent(new CustomEvent('chromeworldSettingsUpdated'));
                        }
                    } catch (e) {
                         console.error('Chromeworld: Failed to re-fetch settings on update.', e);
                    }
                })();
                return true; // Keep message port open
            }
        });
    }
})();