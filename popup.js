'use strict';

let currentDomain = null;
let currentPath = null;
let currentConfig = { enabled: true, pages: {} };
let clickModeActive = false;

// --- Helpers ---

function iconFor(label) {
  const l = label.toLowerCase();
  if (l.startsWith('image') || l.startsWith('img')) return '🖼️';
  if (l.startsWith('input') || l.startsWith('textarea')) return '✏️';
  return '🔤';
}

function pluralBlurs(n) {
  return n === 1 ? '1 blur' : `${n} blurs`;
}

function showStatus(text, type = 'ok') {
  const bar = document.getElementById('statusBar');
  bar.textContent = text;
  bar.className = 'status-bar ' + type;
  clearTimeout(bar._t);
  bar._t = setTimeout(() => { bar.textContent = ''; bar.className = 'status-bar'; }, 2800);
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(s) { return String(s).replace(/"/g, '&quot;'); }

// --- Send message to content script ---

function sendToTab(msg) {
  return new Promise(resolve => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (!tabs[0]) return resolve(null);
      chrome.tabs.sendMessage(tabs[0].id, msg, res => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(res);
      });
    });
  });
}

// --- Get current page's items from config ---

function pageItems() {
  if (!currentPath || !currentConfig.pages) return [];
  return (currentConfig.pages[currentPath] || {}).items || [];
}

// --- Render items for the CURRENT PAGE PATH only ---

function renderItems() {
  const list = document.getElementById('itemsList');
  const clearBtn = document.getElementById('clearBtn');
  const countBadge = document.getElementById('countBadge');
  const dot = document.getElementById('statusDot');
  const items = pageItems();

  countBadge.textContent = pluralBlurs(items.length);
  clearBtn.style.display = items.length > 0 ? 'flex' : 'none';
  dot.className = 'dot' + (currentConfig.enabled && items.length > 0 ? ' active' : '');
  document.getElementById('toggleEnabled').checked = currentConfig.enabled;

  if (items.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="icon">👆</div>
        <strong>No blurs set for this page.</strong><br/>
        Blurs are saved per page — add one below.
      </div>`;
    return;
  }

  list.innerHTML = items.map((item, idx) => {
    const intensity = item.intensity || 8;
    const typeTag   = item.text ? '🔤 text' : item.label.startsWith('Image') ? '🖼️ image' : '✏️ input';
    return `
      <div class="blur-item" data-idx="${idx}">
        <div class="item-top">
          <span class="item-icon">${iconFor(item.label)}</span>
          <div class="item-text">
            <div class="item-label" title="${escHtml(item.label)}">${escHtml(item.label)}</div>
            <div class="item-selector">${escHtml(typeTag)} · ${escHtml(item.selector)}</div>
          </div>
          <button class="delete-btn" data-idx="${idx}" title="Remove">✕</button>
        </div>
        <div class="item-intensity">
          <span class="intensity-label">Blur</span>
          <input type="range" class="mini-slider" min="2" max="20" step="1"
                 value="${intensity}" data-idx="${idx}" />
          <span class="mini-val">${intensity}px</span>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.mini-slider').forEach(sliderEl => {
    const valEl = sliderEl.nextElementSibling;
    sliderEl.addEventListener('input', function () {
      const v    = parseInt(this.value);
      const item = pageItems()[parseInt(this.dataset.idx)];
      valEl.textContent = v + 'px';
      if (item) sendToTab({ type: 'preview_intensity', selector: item.selector, text: item.text || null, altMatch: item.altMatch || null, intensity: v });
    });
    sliderEl.addEventListener('change', function () {
      const v    = parseInt(this.value);
      const item = pageItems()[parseInt(this.dataset.idx)];
      if (item) {
        item.intensity = v;
        chrome.storage.local.set({ [currentDomain]: currentConfig });
        sendToTab({ type: 'update_item_intensity', selector: item.selector, text: item.text || null, altMatch: item.altMatch || null, path: currentPath, intensity: v });
      }
    });
  });

  list.querySelectorAll('.delete-btn').forEach(btn => {
    const idx = parseInt(btn.dataset.idx);
    btn.addEventListener('click', () => removeItem(idx));
  });
}

// --- Remove a single item from the CURRENT PAGE ---

function removeItem(idx) {
  const items = pageItems();
  const item  = items[idx];
  if (!item) return;
  const page  = currentConfig.pages[currentPath] || { items: [] };
  page.items  = page.items.filter((_, i) => i !== idx);
  currentConfig.pages[currentPath] = page;
  chrome.storage.local.set({ [currentDomain]: currentConfig }, () => {
    renderItems();
    sendToTab({ type: 'remove_item', selector: item.selector, text: item.text || null, altMatch: item.altMatch || null, path: currentPath });
    showStatus('Blur removed from this page');
  });
}

// --- Toggle site-wide enabled ---

document.getElementById('toggleEnabled').addEventListener('change', function () {
  currentConfig.enabled = this.checked;
  sendToTab({ type: 'set_enabled', enabled: this.checked });
  document.getElementById('statusDot').className =
    'dot' + (this.checked && pageItems().length > 0 ? ' active' : '');
  showStatus(this.checked ? 'Blurs enabled for this site' : 'Blurs paused for this site');
});

// --- Add element (enter click mode) ---

document.getElementById('addBtn').addEventListener('click', function () {
  if (clickModeActive) {
    clickModeActive = false;
    this.innerHTML = '<span>＋</span> Select element to blur';
    this.classList.remove('active');
    sendToTab({ type: 'click_mode', enabled: false });
    return;
  }
  clickModeActive = true;
  this.innerHTML = '✕ Cancel selection';
  this.classList.add('active');
  sendToTab({ type: 'click_mode', enabled: true });
  showStatus('Click any element on the page to blur it', 'info');
  setTimeout(() => window.close(), 600);
});

// --- Clear all blurs on THIS PAGE ---

document.getElementById('clearBtn').addEventListener('click', function () {
  const n = pageItems().length;
  if (!confirm(`Remove all ${n} blur(s) on ${currentPath}?`)) return;
  if (currentConfig.pages[currentPath]) currentConfig.pages[currentPath].items = [];
  chrome.storage.local.set({ [currentDomain]: currentConfig }, () => {
    renderItems();
    sendToTab({ type: 'clear_page', path: currentPath });
    showStatus('All blurs cleared for this page');
  });
});

// --- Init ---

chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  if (!tabs[0]) { showStatus('No active tab found', 'warn'); return; }

  let tabUrl;
  try { tabUrl = new URL(tabs[0].url); } catch (_) {
    document.getElementById('domainName').textContent = 'Unsupported page';
    showStatus('Cannot run on this page', 'warn');
    return;
  }

  if (tabUrl.protocol === 'chrome:' || tabUrl.protocol === 'chrome-extension:') {
    document.getElementById('domainName').textContent = 'Chrome page';
    showStatus('Extension does not run on Chrome pages', 'warn');
    return;
  }

  currentDomain = tabUrl.hostname;
  currentPath = tabUrl.pathname;

  // Show domain + path in header
  document.getElementById('domainName').textContent = currentDomain;
  document.getElementById('pathName').textContent = currentPath === '/' ? '/' : currentPath;

  chrome.storage.local.get(currentDomain, data => {
    const raw = data[currentDomain];
    // Migrate old flat format
    if (raw && raw.items && !raw.pages) {
      currentConfig = { enabled: raw.enabled !== false, pages: { '/': { items: raw.items } } };
    } else {
      currentConfig = raw || { enabled: true, pages: {} };
      if (!currentConfig.pages) currentConfig.pages = {};
    }
    renderItems();
  });
});

// --- Refresh when item added via click-mode ---

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'item_added' && msg.domain === currentDomain && msg.path === currentPath) {
    chrome.storage.local.get(currentDomain, data => {
      const raw = data[currentDomain];
      currentConfig = (raw && raw.pages) ? raw : { enabled: true, pages: {} };
      renderItems();
      showStatus(`Added: ${msg.label}`);
    });
  }
});
