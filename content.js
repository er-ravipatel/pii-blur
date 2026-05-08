(function () {
  'use strict';

  const domain    = window.location.hostname;
  let currentPath = window.location.pathname;
  const STYLE_ID  = 'pii-blur-injected';
  const CACHE_KEY = 'pii_blur_v2_' + domain;
  let clickMode   = false;
  let lastCSS     = '';
  let activeJSItems = [];   // items matched by JS (text + image src)

  // ---------------------------------------------------------------------------
  // Inline style blur — JS matched elements
  // ---------------------------------------------------------------------------

  function blurEl(el, intensity = 8) {
    if (!el || ['SCRIPT','STYLE','HEAD','HTML'].includes(el.tagName)) return;
    el.style.setProperty('filter', `blur(${intensity}px)`, 'important');
    el.style.setProperty('-webkit-filter', `blur(${intensity}px)`, 'important');
    el.dataset.piiBlurred = intensity;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.setAttribute('autocomplete','off');
  }

  function unblurEl(el) {
    el.style.removeProperty('filter');
    el.style.removeProperty('-webkit-filter');
    delete el.dataset.piiBlurred;
  }

  function unblurAllJS() {
    document.querySelectorAll('[data-pii-blurred]').forEach(unblurEl);
  }

  // ---------------------------------------------------------------------------
  // CSS <style> tag — ONLY for <input>/<textarea> elements.
  // Their position in a form is stable; structural nth-child selectors hold.
  // Images and text use JS matching instead (see below).
  // ---------------------------------------------------------------------------

  function buildCSS(items) {
    return items.map(({ selector, intensity = 8 }) => {
      try {
        document.querySelectorAll(selector);
        return `${selector}{filter:blur(${intensity}px)!important;-webkit-filter:blur(${intensity}px)!important;}`;
      } catch (_) { return ''; }
    }).filter(Boolean).join('\n');
  }

  function injectStyles(cssItems) {
    const css = buildCSS(cssItems);
    if (css === lastCSS) return;
    lastCSS = css;
    let el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      const parent = document.head || document.documentElement;
      parent.insertBefore(el, parent.firstChild);
    }
    el.textContent = css;
  }

  function clearCSS() {
    lastCSS = '';
    const el = document.getElementById(STYLE_ID);
    if (el) el.textContent = '';
  }

  // ---------------------------------------------------------------------------
  // JS matching — images matched by alt/aria-label, text matched by textContent.
  // Runs in MutationObserver so elements are caught as they enter the DOM.
  //
  // Item shape:
  //   { selector, text, altMatch, intensity }
  //   - text:     exact textContent match (for span/div/p)
  //   - altMatch: exact alt / aria-label match (for img)
  //   - selector: broad CSS selector used as a pre-filter (perf optimisation)
  // ---------------------------------------------------------------------------

  function textOf(el) {
    return (el.innerText || el.textContent || '').trim();
  }

  function altOf(el) {
    return (el.alt || el.getAttribute('aria-label') || '').trim();
  }

  // Each JS item matches on selector + one content condition:
  //   item.text     → exact textContent  (for span, div, p, …)
  //   item.altMatch → exact alt/aria-label (for img)
  function matchesItem(el, item) {
    if (item.text)     return textOf(el) === item.text;
    if (item.altMatch) return altOf(el)  === item.altMatch;
    return false;
  }

  function applyJSItem(item, root) {
    root = root || document;
    try {
      const nodes = [
        ...(root !== document && root.matches?.(item.selector) ? [root] : []),
        ...root.querySelectorAll(item.selector),
      ];
      nodes.forEach(el => { if (matchesItem(el, item)) blurEl(el, item.intensity || 8); });
    } catch (_) {}
  }

  function applyAllJSItems(items, root) {
    items.forEach(item => applyJSItem(item, root));
  }

  // ---------------------------------------------------------------------------
  // Split items by blur mechanism
  //   CSS  → <input> and <textarea> only (stable structural selectors)
  //   JS   → everything else: img (altMatch) and text (text)
  // ---------------------------------------------------------------------------

  function splitItems(items) {
    const css = items.filter(i => !i.text && !i.altMatch);  // inputs only
    const js  = items.filter(i =>  i.text ||  i.altMatch);  // text + images
    return { css, js };
  }

  // ---------------------------------------------------------------------------
  // Config helpers
  // ---------------------------------------------------------------------------

  function migrate(raw) {
    if (!raw) return { enabled: true, pages: {} };
    if (raw.items && !raw.pages) return { enabled: raw.enabled !== false, pages: { '/': { items: raw.items } } };
    if (!raw.pages) raw.pages = {};
    return raw;
  }

  function resolveItems(config, path) {
    const p = path || currentPath;
    const pages = config.pages || {};
    if (pages[p]) return pages[p].items || [];
    const prefix = Object.keys(pages)
      .filter(k => k !== '/' && p.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    if (prefix) return pages[prefix].items || [];
    return (pages['/'] || {}).items || [];
  }

  // ---------------------------------------------------------------------------
  // Apply everything for the current path
  // ---------------------------------------------------------------------------

  function applyConfig(config) {
    if (!config || !config.enabled) { clearCSS(); unblurAllJS(); activeJSItems = []; return; }
    const items = resolveItems(config);
    const { css, js } = splitItems(items);
    injectStyles(css);
    activeJSItems = js;
    unblurAllJS();
    applyAllJSItems(js);
  }

  // ---------------------------------------------------------------------------
  // Two-phase init
  // ---------------------------------------------------------------------------

  function applyFromCache() {
    try {
      const config = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (config && config.enabled !== false) applyConfig(config);
    } catch (_) {}
  }

  function loadAndInject() {
    chrome.storage.local.get(domain, data => {
      const config = migrate(data[domain]);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(config)); } catch (_) {}
      applyConfig(config);
    });
  }

  applyFromCache();  // Phase 1 — sync, zero delay (uses localStorage cache)
  loadAndInject();   // Phase 2 — async ~5ms, updates cache

  // ---------------------------------------------------------------------------
  // MutationObserver
  //  1. Re-inject <style> tag if removed by the page framework
  //  2. Apply JS-matched blurs to nodes as they arrive in the DOM
  // ---------------------------------------------------------------------------

  const observer = new MutationObserver(mutations => {
    if (lastCSS && !document.getElementById(STYLE_ID)) {
      const el = document.createElement('style');
      el.id = STYLE_ID;
      (document.head || document.documentElement).insertBefore(el, null);
      el.textContent = lastCSS;
    }
    if (!activeJSItems.length) return;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        applyAllJSItems(activeJSItems, node.parentElement || document);
      }
    }
  });

  function startObserver() {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.documentElement) startObserver();
  else document.addEventListener('DOMContentLoaded', startObserver);

  // ---------------------------------------------------------------------------
  // SPA navigation
  // ---------------------------------------------------------------------------

  function onPathChange() {
    const p = window.location.pathname;
    if (p === currentPath) return;
    currentPath = p;
    unblurAllJS();
    applyFromCache();
    loadAndInject();
  }

  const _push    = history.pushState.bind(history);
  const _replace = history.replaceState.bind(history);
  history.pushState    = function (...a) { _push(...a);    setTimeout(onPathChange, 0); };
  history.replaceState = function (...a) { _replace(...a); setTimeout(onPathChange, 0); };
  window.addEventListener('popstate', () => setTimeout(onPathChange, 0));

  // ---------------------------------------------------------------------------
  // Selector / label builders
  // ---------------------------------------------------------------------------

  function textOf2(el) { return textOf(el); } // alias to avoid hoisting issue

  function labelFor(el) {
    if (el.tagName === 'IMG') return 'Image — ' + (el.alt || el.src.split('/').pop().split('?')[0] || 'photo');
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
      return 'Input — ' + (el.placeholder || el.name || el.id || el.type || 'field');
    const t = textOf(el).slice(0, 40);
    return t || el.tagName.toLowerCase();
  }

  // Broad class-based selector (used as a pre-filter for JS items)
  function broadSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    let part = el.tagName.toLowerCase();
    const cls = [...el.classList]
      .filter(c => !/^(active|hover|focus|open|visible|hidden|disabled|loading|ng-|js-)/.test(c))
      .slice(0, 2);
    if (cls.length) part += '.' + cls.map(c => CSS.escape(c)).join('.');
    // Anchor to nearest ID ancestor for precision
    let anc = el.parentElement;
    while (anc && anc !== document.documentElement) {
      if (anc.id) return '#' + CSS.escape(anc.id) + ' ' + part;
      anc = anc.parentElement;
    }
    return part;
  }

  // Structural nth-child selector — only used for <input>/<textarea>
  function nodePart(node) {
    if (node.id) return '#' + CSS.escape(node.id);
    let part = node.tagName.toLowerCase();
    const cls = [...node.classList]
      .filter(c => !/^(active|hover|focus|open|visible|hidden|disabled|loading|ng-|js-)/.test(c))
      .slice(0, 2);
    if (cls.length) part += '.' + cls.map(c => CSS.escape(c)).join('.');
    if (node.parentElement) {
      const idx = [...node.parentElement.children].indexOf(node) + 1;
      part += `:nth-child(${idx})`;
    }
    return part;
  }

  function structuralSelectorFor(el) {
    const parts = [];
    let node = el;
    while (node && node.tagName && node !== document.documentElement) {
      parts.unshift(nodePart(node));
      const sel = parts.join(' > ');
      try { if (document.querySelectorAll(sel).length === 1) return sel; } catch (_) {}
      if (node.id) break;
      node = node.parentElement;
      if (parts.length >= 12) break;
    }
    return parts.join(' > ');
  }

  // ---------------------------------------------------------------------------
  // Click-to-blur
  // ---------------------------------------------------------------------------

  function handleClick(e) {
    if (!clickMode) return;
    e.preventDefault();
    e.stopPropagation();

    const el        = e.target;
    const label     = labelFor(el);
    const intensity = 8;
    let   selector, text, altMatch;

    if (el.tagName === 'IMG') {
      // Images: broad selector + alt/aria-label as content condition
      selector = broadSelector(el);
      altMatch = altOf(el) || null;
      text     = null;
    } else if (['INPUT','TEXTAREA','SELECT'].includes(el.tagName)) {
      // Inputs: structural CSS selector — position in a form is stable
      selector = structuralSelectorFor(el);
      altMatch = null;
      text     = null;
    } else {
      // Text elements: broad selector + exact textContent match
      selector = broadSelector(el);
      text     = textOf(el);
      altMatch = null;
    }

    // Instant visual feedback
    blurEl(el, intensity);

    chrome.storage.local.get(domain, data => {
      const config = migrate(data[domain]);
      if (!config.pages[currentPath]) config.pages[currentPath] = { items: [] };
      const exists = config.pages[currentPath].items.some(
        i => i.selector === selector && i.text === text && i.altMatch === altMatch
      );
      if (!exists) {
        config.pages[currentPath].items.push({ selector, text, altMatch, label, intensity });
        chrome.storage.local.set({ [domain]: config }, () => {
          try { localStorage.setItem(CACHE_KEY, JSON.stringify(config)); } catch (_) {}
          applyConfig(config);
          chrome.runtime.sendMessage({ type: 'item_added', domain, path: currentPath, label });
        });
      }
    });
  }

  function enableClickMode() {
    clickMode = true;
    document.body.classList.add('pii-click-mode');
    document.addEventListener('click', handleClick, true);
  }

  function disableClickMode() {
    clickMode = false;
    document.body.classList.remove('pii-click-mode');
    document.removeEventListener('click', handleClick, true);
  }

  // ---------------------------------------------------------------------------
  // Messages from popup
  // ---------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.type) {

      case 'get_status':
        chrome.storage.local.get(domain, data => {
          const config = migrate(data[domain]);
          sendResponse({ domain, path: currentPath, config, pageItems: resolveItems(config) });
        });
        return true;

      case 'set_enabled':
        chrome.storage.local.get(domain, data => {
          const config = migrate(data[domain]);
          config.enabled = msg.enabled;
          chrome.storage.local.set({ [domain]: config }, () => {
            try { localStorage.setItem(CACHE_KEY, JSON.stringify(config)); } catch (_) {}
            applyConfig(config);
          });
        });
        break;

      case 'click_mode':
        msg.enabled ? enableClickMode() : disableClickMode();
        break;

      case 'remove_item':
        chrome.storage.local.get(domain, data => {
          const config  = migrate(data[domain]);
          const page    = config.pages[msg.path] || { items: [] };
          page.items    = page.items.filter(i =>
            !(i.selector === msg.selector && i.text === msg.text && i.altMatch === msg.altMatch)
          );
          config.pages[msg.path] = page;
          chrome.storage.local.set({ [domain]: config }, () => {
            try { localStorage.setItem(CACHE_KEY, JSON.stringify(config)); } catch (_) {}
            unblurAllJS();
            applyConfig(config);
          });
        });
        break;

      case 'preview_intensity':
        chrome.storage.local.get(domain, data => {
          const config = migrate(data[domain]);
          const items  = resolveItems(config).map(i =>
            i.selector === msg.selector && i.text === msg.text && i.altMatch === msg.altMatch
              ? { ...i, intensity: msg.intensity } : i
          );
          const { css, js } = splitItems(items);
          injectStyles(css);
          unblurAllJS();
          applyAllJSItems(js);
        });
        break;

      case 'update_item_intensity':
        chrome.storage.local.get(domain, data => {
          const config = migrate(data[domain]);
          const page   = config.pages[msg.path] || { items: [] };
          const item   = page.items.find(i =>
            i.selector === msg.selector && i.text === msg.text && i.altMatch === msg.altMatch
          );
          if (item) {
            item.intensity = msg.intensity;
            chrome.storage.local.set({ [domain]: config }, () => {
              try { localStorage.setItem(CACHE_KEY, JSON.stringify(config)); } catch (_) {}
              applyConfig(config);
            });
          }
        });
        break;

      case 'clear_page':
        chrome.storage.local.get(domain, data => {
          const config = migrate(data[domain]);
          config.pages[msg.path] = { items: [] };
          chrome.storage.local.set({ [domain]: config }, () => {
            try { localStorage.setItem(CACHE_KEY, JSON.stringify(config)); } catch (_) {}
            clearCSS();
            unblurAllJS();
            activeJSItems = [];
          });
        });
        break;
    }
  });

})();
