// dashboard.js - Now with Theme Toggle, Flippable Cards, and Snapshot Modal
document.addEventListener('DOMContentLoaded', async () => {
  try {
    initializeTheme(); // Load theme first
    await initializeDashboard();
    setupCustomTooltips(); // For LTP/STP buttons
    setupMetricCardFlips(); // For metric cards
  } catch (error) {
    console.error('Dashboard init failed:', error);
    showError('Matrix initialization failed');
  }
});

let currentView = 'ltp';  // Default: Long-term profile

async function initializeDashboard() {
  await loadOverviewStats();
  await loadDomainEngagement();
  setupTabs();
  setupEventListeners();
  console.log('Nexus matrix online');
  await loadSnapshots();
}

/**
 * NEW: Load theme from localStorage
 */
function initializeTheme() {
  const savedTheme = localStorage.getItem('nexus-theme') || 'dark';
  document.body.dataset.theme = savedTheme;
  updateThemeIcon(savedTheme);
}

/**
 * NEW: Update theme button icon
 */
function updateThemeIcon(theme) {
  const icon = document.querySelector('#themeToggle i');
  if (icon) {
    icon.className = theme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
  }
}

function setupEventListeners() {
  document.getElementById('backToPopup').addEventListener('click', () => window.close());

  const snapshotSearch = document.getElementById('snapshotSearch');
  if (snapshotSearch) snapshotSearch.addEventListener('input', debounce(loadSnapshots, 300));

  document.querySelectorAll('.view-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentView = btn.dataset.view;
      updateDashboardForView();
    });
  });

  document.getElementById('generateNewFacts').addEventListener('click', generateNewFacts);

  // NEW: Theme toggle listener
  document.getElementById('themeToggle').addEventListener('click', () => {
    const currentTheme = document.body.dataset.theme;
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.body.dataset.theme = newTheme;
    localStorage.setItem('nexus-theme', newTheme);
    updateThemeIcon(newTheme);
  });

  // NEW: Modal close listeners
  const modal = document.getElementById('snapshotModal');
  const modalContent = modal.querySelector('.modal-content');
  document.getElementById('modalClose').addEventListener('click', hideModal);
  modal.addEventListener('click', hideModal);
  modalContent.addEventListener('click', e => e.stopPropagation());
}

/**
 * NEW: Hide modal function
 */
function hideModal() {
  const modal = document.getElementById('snapshotModal');
  modal.style.display = 'none';
  document.body.style.overflow = 'auto';
}

/**
 * NEW: Setup flippable metric cards
 */
function setupMetricCardFlips() {
  const metricCards = document.querySelectorAll('.metric-card');
  metricCards.forEach(card => {
    const node = card.querySelector('.metric-node');
    let flipTimeout;

    card.addEventListener('mouseenter', () => {
      // Set timeout to flip
      flipTimeout = setTimeout(() => {
        node.classList.add('is-flipped');
      }, 700); // 700ms delay
    });

    card.addEventListener('mouseleave', () => {
      // Clear timeout if it hasn't flipped yet
      clearTimeout(flipTimeout);
      // Flip back
      node.classList.remove('is-flipped');
    });
  });
}


function setupTabs() {
  const tabBtns = document.querySelectorAll('.nav-node');
  const tabPanes = document.querySelectorAll('.tab-lattice');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      tabPanes.forEach(p => p.classList.remove('active'));
      document.getElementById(`${tab}-tab`).classList.add('active');
      document.querySelector('.nav-core.scroll-target').scrollIntoView({ 
        behavior: 'smooth',
        block: 'start'
      });
      const loaders = {
        snapshots: loadSnapshots,
        searches: loadSearches,
        facts: loadFacts,
        profile: loadProfile
      };
      const loader = loaders[tab];
      if (loader) loader();
    });
  });
}

async function updateDashboardForView() {
  console.log(`Switching to ${currentView.toUpperCase()} view`);
  await Promise.all([
    loadOverviewStats(),
    loadDomainEngagement(),
    loadSnapshots(),
    loadSearches(),
    loadProfile()
  ]);
}

async function loadOverviewStats() {
  try {
    const stats = await sendMessage({ 
      type: 'GET_STATS', 
      view: currentView 
    });
    updateElement('totalSnapshots', stats?.snapshotCount || 0);
    updateElement('totalHours', stats?.totalActiveTime || '0m');
    updateElement('totalSearches', stats?.uniqueSearchesCount || 0);
    updateElement('totalNodes', stats?.topDomainCount || 0); 
    updateElement('currentViewIndicator', currentView.toUpperCase());
    updateElement('nodesLabel', 'Nodes');
  } catch (error) {
    console.error('Stats load error:', error);
  }
}

async function loadDomainEngagement() {
  try {
    const topics = await sendMessage({ 
      type: 'GET_DOMAIN_BEHAVIORS', 
      limit: 6,
      view: currentView 
    });
    const container = document.getElementById('topDomainsList');
    if (!container) return;

    updateElement('domainLatticeHeader', `Topic Lattice (${currentView.toUpperCase()})`);
    updateElement('domainListTitle', `Prime Topics (${currentView.toUpperCase()})`);
    updateElement('domainMetricsTitle', `Topic Metrics (${currentView.toUpperCase()})`);

    if (!Array.isArray(topics) || topics.length === 0) {
      container.innerHTML = getPlaceholderHTML('fas fa-database', 'No Topics Found', 'Start browsing to generate data.');
      updateElement('avgEngagement', '0%');
      updateElement('totalDomainTime', 'N/A');
      updateElement('contentFocus', 'N/A');
      return;
    }

    container.innerHTML = `
      <div class="domain-grid">
        ${topics.map((t, index) => `
          <div class="domain-card ${index === 0 ? 'active' : ''}" 
               data-index="${index}" 
               data-topic='${escapeHtml(JSON.stringify(t))}'>
            <div class="domain-icon">${getTopicIcon(t.topic)}</div>
            <div class="domain-name">${escapeHtml(t.topic)}</div>
            <div class="domain-weight">${Math.round(t.weight * 100)}%</div>
          </div>
        `).join('')}
      </div>
    `;

    container.querySelectorAll('.domain-card').forEach(card => {
      card.addEventListener('click', () => {
        selectDomainCard(card, parseInt(card.dataset.index, 10));
      });
    });

    if (topics.length > 0) {
      await updateTopicMetrics(topics[0]);
    }
  } catch (error) {
    console.error('Topic load error:', error);
  }
}

function selectDomainCard(cardElement, index) {
  document.querySelectorAll('.domain-card').forEach(card => {
    card.classList.remove('active');
  });
  cardElement.classList.add('active');
  const topicData = JSON.parse(cardElement.dataset.topic);
  updateTopicMetrics(topicData);
}

function getTopicIcon(topic) {
  const iconMap = {
    'Technology': '💻', 'Software': '🔧', 'Programming': '👨‍💻', 'Artificial Intelligence': '🤖',
    'Computer Science': '💾', 'Web Development': '🌐', 'Business': '💼', 'Finance': '💰',
    'Science': '🔬', 'Education': '🎓', 'Health': '🏥', 'Medicine': '💊', 'News': '📰',
    'Politics': '🏛️', 'Entertainment': '🎬', 'Movies': '🎥', 'Music': '🎵', 'Sports': '⚽',
    'Travel': '✈️', 'Food': '🍕', 'Gaming': '🎮', 'Default': '🌐'
  };
  const normalizedTopic = topic.toLowerCase();
  for (const [key, icon] of Object.entries(iconMap)) {
    if (key.toLowerCase() === normalizedTopic) return icon;
  }
  for (const [key, icon] of Object.entries(iconMap)) {
    if (normalizedTopic.includes(key.toLowerCase())) return icon;
  }
  return iconMap['Default'];
}

async function updateTopicMetrics(topic) {
  try {
    const profile = await sendMessage({ type: 'GET_USER_PROFILE_F', view: currentView });
    if (!profile) return;
    updateElement('domainMetric1Key', 'Topic Weight');
    updateElement('avgEngagement', `${Math.round(topic.weight * 100)}%`);
    updateElement('domainMetric2Key', 'Focus Style');
    updateElement('totalDomainTime', profile.behavior);
    updateElement('domainMetric3Key', 'Content Pref');
    updateElement('contentFocus', profile.contentStyle);
  } catch (error) {
    console.error('Topic metrics update error:', error);
  }
}

/**
 * UPDATED: Load snapshots for modal
 */
async function loadSnapshots() {
  try {
    const snapshots = await sendMessage({ 
      type: 'GET_SNAPSHOTS', 
      limit: 20, 
      view: currentView
    });
    const container = document.getElementById('snapshotsList');
    if (!container) return;

    if (!Array.isArray(snapshots) || snapshots.length === 0) {
      container.innerHTML = getPlaceholderHTML('fas fa-camera-retro', 'Archive empty', 'Initiate captures');
      return;
    }

    container.innerHTML = snapshots.map(s => {
      const displayTitle = s.title ? truncateText(escapeHtml(s.title), 60) : '';
      const displayUrl = escapeHtml(s.domain || s.url || 'No URL');
      // Store all data in the data-snapshot attribute
      return `
      <div class="archive-item" data-snapshot='${escapeHtml(JSON.stringify(s))}'>
        <div class="archive-url">${displayUrl}</div>
        ${displayTitle ? `<div class="archive-title">${displayTitle}</div>` : ''}
        <div class="archive-summary">${truncateText(escapeHtml(s.summary || 'No summary'), 120)}</div>
        <div class="archive-meta">
          <span class="view-badge ${currentView}">${currentView.toUpperCase()}</span>
          <span class="archive-date">${formatDate(s.timestamp)}</span>
        </div>
        <!-- REMOVED: archive-actions div and button -->
      </div>
    `}).join('');

    // Add event listeners (CSP-compliant)
    container.querySelectorAll('.archive-item').forEach(item => {
      item.addEventListener('click', () => {
        const snapshotData = JSON.parse(item.dataset.snapshot);
        openSnapshotModal(snapshotData);
      });
    });

  } catch (error) {
    console.error('Snapshots load error:', error);
  }
}

/**
 * NEW: Open snapshot in modal
 */
function openSnapshotModal(data) {
  const modal = document.getElementById('snapshotModal');
  const url = data.url || '#';
  const displayUrl = data.domain || url;
  
  updateElement('modalTitle', data.title || 'No Title');
  updateElement('modalSummary', data.summary || 'No summary available for this node.');
  updateElement('modalDate', formatDate(data.timestamp));
  
  const urlEl = document.getElementById('modalUrl');
  urlEl.href = url;
  urlEl.textContent = displayUrl;

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden'; // Prevent background scroll
}


async function loadSearches() {
  try {
    const searches = await sendMessage({ 
      type: 'GET_RECENT_SEARCHES', 
      limit: 30, 
      view: currentView
    });
    const container = document.getElementById('searchesList');
    if (!container) return;

    if (!Array.isArray(searches) || searches.length === 0) {
      container.innerHTML = getPlaceholderHTML('fas fa-search', 'Log initializing', 'Queries auto-logged');
      return;
    }

    container.innerHTML = searches.map(s => {
      const clicks = s.resultsClicked ? s.resultsClicked.length : 0;
      return `
        <div class="log-item">
          <div class="log-content">
            <div class="log-query">${escapeHtml(s.query || 'Unknown')}</div>
            <div class="log-meta">
              <span><i class="fas fa-clock"></i> ${formatDate(s.timestamp)}</span>
              <span class="view-badge ${currentView}">${currentView.toUpperCase()}</span>
            </div>
          </div>
          <div class="log-stats">
            <span class="log-intent">${escapeHtml(s.intentType || 'Query')}</span>
            <span class="log-interactions"><i class="fas fa-mouse-pointer"></i> ${clicks} clicks</span>
          </div>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Searches load error:', error);
  }
}

async function loadFacts() {
  const container = document.getElementById('factsList');
  if (container) {
    container.innerHTML = getPlaceholderHTML('fas fa-brain', 'Core awakening', 'Insights forthcoming');
  }
}

async function loadProfile() {
  try {
    const profile = await sendMessage({ 
      type: 'GET_USER_PROFILE_F',
      view: currentView 
    });

    if (!profile) {
        updateElement('profileSummaryText', 'Profile data unavailable.');
        return;
    }
    const summaryText = profile.summary || 'No summary available. Start browsing to generate an analysis.';
    updateElement('profileSummaryText', summaryText);
    updateElement('profileTotalSnapshots', profile.totalSnapshots || 0);
    updateElement('profileTotalTime', profile.totalTime || '0m');
    updateElement('profileActiveDays', profile.activeDays || 0);
    
    if (currentView === 'stp') {
      updateElement('profileActiveDaysLabel', 'Session');
      updateElement('profileActiveDays', '1');
    } else {
      updateElement('profileActiveDaysLabel', 'Sessions Analyzed');
    }
    updateElement('profileBehavior', profile.behavior || 'N/A');
    updateElement('profileContentStyle', profile.contentStyle || 'N/A');
    const container = document.getElementById('interestsContainer');
    if (container) {
      const interests = profile.interests || [];
      if (Array.isArray(interests) && interests.length > 0) {
        container.innerHTML = interests
          .slice(0, 8) 
          .map(i => `<span class="interest-tag">${escapeHtml(i.topic)}</span>`)
          .join('');
      } else {
        container.innerHTML = getPlaceholderHTML('fas fa-constellation', 'Vectors mapping', 'No topics found.');
      }
    }
    updateElement('profileViewIndicator', `${currentView.toUpperCase()}`);
  } catch (error) {
    console.error('Profile load error:', error);
    updateElement('profileSummaryText', 'Failed to load profile. Please try refreshing.');
  }
}

async function generateNewFacts() {
  const btn = document.getElementById('generateNewFacts');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Evolving...';
  try {
    showNotification('Feature upcoming');
  } catch (error) {
    showError('Evolution failed');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

// --- Utilities ---
function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
        console.warn('Chrome runtime not available for messaging (likely in dev).');
    }
    chrome.runtime.sendMessage(msg, response => {
      if (chrome.runtime.lastError) {
        console.error('❌ Runtime error:', chrome.runtime.lastError);
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response && !response.success) {
        console.error('❌ Response error:', response.error);
        reject(new Error(response.error || 'Request failed'));
      } else if (response && response.success) {
        resolve(response.data);
      } else {
        reject(new Error('Invalid response format'));
      }
    });
  });
}

function updateElement(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function getPlaceholderHTML(icon, title, subtitle) {
  return `
    <div class="grid-placeholder">
      <i class="fas ${icon}"></i>
      <p>${title}</p>
      <small>${subtitle}</small>
    </div>
  `;
}

function truncateText(text, len) {
  if (!text) return '';
  return text.length > len ? text.slice(0, len) + '...' : text;
}

function formatDate(dateStr) {
  if (!dateStr) return 'Unknown';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString();
}

function escapeHtml(str) {
  if (!str) return '';
  // Simplified escape for JSON attribute
  if (typeof str === 'object') {
    str = JSON.stringify(str);
  }
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
}

function showNotification(msg) {
  console.log('Notification:', msg);
}
function showError(msg) {
  console.error('Error:', msg);
}
function debounce(fn, ms) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), ms);
  };
}

// --- UPDATED: Custom Tooltip Logic (for non-metric-card elements) ---
let tooltipElement;
let tooltipTimeout;

function setupCustomTooltips() {
  tooltipElement = document.getElementById('customTooltip');
  if (!tooltipElement) return;

  document.body.addEventListener('mouseover', e => {
    // Only target elements with [data-tooltip], not the metric cards
    const target = e.target.closest('[data-tooltip]');
    if (target) {
      const tooltipText = target.getAttribute('data-tooltip');
      showTooltip(tooltipText, e);
    }
  });

  document.body.addEventListener('mouseout', e => {
    const target = e.target.closest('[data-tooltip]');
    if (target) {
      hideTooltip();
    }
  });

  document.body.addEventListener('mousemove', e => {
    if (tooltipElement.style.display === 'block') {
      updateTooltipPos(e);
    }
  });
}

function showTooltip(text, e) {
  clearTimeout(tooltipTimeout);
  tooltipElement.textContent = text;
  tooltipElement.style.display = 'block';
  updateTooltipPos(e);
}

function hideTooltip() {
  // UPDATED: Increased delay to 300ms
  tooltipTimeout = setTimeout(() => {
    tooltipElement.style.display = 'none';
  }, 300);
}

function updateTooltipPos(e) {
  if (!tooltipElement) return;
  let x = e.clientX + 15;
  let y = e.clientY + 15;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  // We need getBoundingClientRect to run *after* text is set, but it's
  // tricky. Let's assume a max-width from CSS.
  const tooltipWidth = Math.min(250, tooltipElement.offsetWidth); 
  const tooltipHeight = tooltipElement.offsetHeight;

  if (x + tooltipWidth > viewportWidth - 10) {
    x = e.clientX - tooltipWidth - 15;
  }
  if (y + tooltipHeight > viewportHeight - 10) {
    y = e.clientY - tooltipHeight - 15;
  }
  if (x < 10) x = 10;
  if (y < 10) y = 10;
  
  tooltipElement.style.left = `${x}px`;
  tooltipElement.style.top = `${y}px`;
}
