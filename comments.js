// === Prototype Comment System (master, v3) ===
// Drop-in visuele comment/annotatie-laag voor elk HTML prototype.
// Opslag via een server-endpoint (file-backed) met localStorage-fallback,
// of localStorage-only als je geen server hebt.
//
// GEBRUIK:
//   1. Zet (optioneel) een config VOOR dit script:
//        <script>window.CM_CONFIG = { projectName: 'Mijn Project', storagePrefix: 'mijnproject_', ... };</script>
//   2. Laad het script:  <script src="comments.js"></script>
//   Raak deze file zelf niet aan; alles wat per project verschilt staat in CM_CONFIG.

(function() {
  // ============================================================
  //  CONFIGURATIE  —  per project overschrijven via window.CM_CONFIG
  // ============================================================
  const CONFIG = Object.assign({
    // Naam bovenaan de geexporteerde markdown-roadmap + bestandsnaam.
    projectName: document.title || 'Project',
    // localStorage sleutel-prefix. Houd dit uniek per project.
    storagePrefix: 'cm_comments_',
    // Server-endpoint voor opslag op schijf. Zet op null voor
    // localStorage-only (puur statisch prototype, geen server nodig).
    apiEndpoint: '/api/comments',
    // Pins standaard zichtbaar bij het laden van de pagina?
    pinsVisibleDefault: true,
    // Leesbare paginanamen, bv. { 'index.html': 'Home', 'detail.html': 'Detail' }
    pageNames: {},
    // Leesbare scherm/stap-namen voor SPA's of wizards,
    // bv. { 's-start': 'Start', 'step-2': 'Gegevens' }
    screenNames: {},
    // Optionele vaste paginavolgorde in het zijpaneel + de export.
    pageOrder: []
  }, window.CM_CONFIG || {});

  const PAGE_KEY = location.pathname;
  let comments = [];
  let allCommentsData = {};
  let commentMode = false;
  let nextId = 1;
  let pinsVisible = CONFIG.pinsVisibleDefault;
  let panelFilter = 'all';
  let panelPriorityFilter = 'all';
  let panelSearch = '';
  let panelSelectMode = false;
  let panelSelected = new Set();

  // Category definitions
  const CATEGORIES = {
    ux:       { label: 'UX',            color: '#1A6DFF' },
    business: { label: 'Business Rule', color: '#F59E0B' },
    copy:     { label: 'Tekst/Copy',    color: '#8B5CF6' },
    tech:     { label: 'Technisch',     color: '#14B8A6' }
  };

  const PRIORITIES = {
    must:   { label: 'Must have',    color: '#DC2626' },
    should: { label: 'Should have',  color: '#1A6DFF' },
    nice:   { label: 'Nice to have', color: '#10B981' }
  };

  const PAGE_NAMES = CONFIG.pageNames;

  // SVG Icons (inline, no deps)
  const ICONS = {
    plus: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    eye: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.5"/></svg>',
    eyeOff: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.5"/><path d="M2 14L14 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    list: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    download: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2v9M4 8l4 4 4-4M2 13h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chevronLeft: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 3L5 7l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chevronRight: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    search: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.5"/><path d="M9.5 9.5L13 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    close: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  };

  // Load from server (file-backed) on startup
  async function loadComments() {
    try {
      if (!CONFIG.apiEndpoint) throw new Error('localStorage-only');
      const res = await fetch(CONFIG.apiEndpoint);
      allCommentsData = await res.json();
      comments = allCommentsData[PAGE_KEY] || [];
      // Migrate old comments: add category if missing
      comments.forEach(c => { if (!c.category) c.category = 'ux'; });
      // Verwijder legacy comments zonder screen-info
      const hasScreens = document.querySelectorAll('.screen, .view, [data-role-view]').length > 0;
      if (hasScreens) {
        comments = comments.filter(c => !!c.step);
        allCommentsData[PAGE_KEY] = comments;
      }
      nextId = comments.length ? Math.max(...comments.map(c => c.id)) + 1 : 1;
      renderPins();
      updateBadge();
    } catch(e) {
      comments = JSON.parse(localStorage.getItem(CONFIG.storagePrefix + PAGE_KEY) || '[]');
      comments.forEach(c => { if (!c.category) c.category = 'ux'; });
      // Verwijder legacy comments zonder screen-info (worden toch overal getoond)
      const hasScreens = document.querySelectorAll('.screen, .view, [data-role-view]').length > 0;
      if (hasScreens) {
        const before = comments.length;
        comments = comments.filter(c => !!c.step);
        if (comments.length !== before) {
          localStorage.setItem(CONFIG.storagePrefix + PAGE_KEY, JSON.stringify(comments));
        }
      }
      nextId = comments.length ? Math.max(...comments.map(c => c.id)) + 1 : 1;
      renderPins();
      updateBadge();
    }
  }

  // Inject CSS
  const style = document.createElement('style');
  style.textContent = `
    /* Design tokens */
    :root {
      --cm-ink: #1A1A1A;
      --cm-muted: #6B7280;
      --cm-accent: #1A6DFF;
      --cm-bg: #FFFFFF;
      --cm-surface: #F9FAFB;
      --cm-border: #E5E7EB;
      --cm-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --cm-radius-card: 12px;
      --cm-radius-btn: 8px;
    }

    /* === Toolbar === */
    .cm-toolbar {
      position: fixed; bottom: 24px; right: 24px; z-index: 99999;
      display: flex; gap: 4px; align-items: center;
      background: var(--cm-bg); border: 1px solid var(--cm-border);
      border-radius: 999px; padding: 6px 8px;
      font-family: var(--cm-font);
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
      transition: transform 0.25s ease, border-color 0.2s ease;
    }
    .cm-toolbar.cm-mode-active {
      border-color: var(--cm-accent);
      box-shadow: 0 2px 12px rgba(0,0,0,0.08), 0 0 0 2px rgba(26,109,255,0.15);
    }
    .cm-toolbar.collapsed {
      transform: translateX(calc(100% - 40px));
    }
    .cm-toolbar.collapsed > *:not(.cm-btn-collapse) { opacity: 0; pointer-events: none; transition: opacity 0.1s; }
    .cm-toolbar.collapsed > .cm-btn-collapse { opacity: 1; pointer-events: auto; }

    .cm-tbtn {
      display: flex; align-items: center; justify-content: center;
      border: none; border-radius: 50%; width: 34px; height: 34px;
      cursor: pointer; font-family: var(--cm-font);
      background: transparent; color: var(--cm-muted);
      transition: background 0.15s, color 0.15s;
      position: relative; padding: 0; flex-shrink: 0;
    }
    .cm-tbtn:hover { background: var(--cm-surface); color: var(--cm-ink); }

    .cm-tbtn-comment {
      background: var(--cm-accent); color: white; width: 32px; height: 32px;
    }
    .cm-tbtn-comment:hover { background: #155bd4; color: white; }
    .cm-tbtn-comment.active {
      background: #DC2626; color: white;
    }
    .cm-tbtn-comment.active:hover { background: #b91c1c; color: white; }

    .cm-tbtn .cm-tbtn-badge {
      position: absolute; top: -2px; right: -4px;
      background: var(--cm-accent); color: white; border-radius: 99px;
      font-size: 10px; font-weight: 700; padding: 1px 5px; line-height: 1.3;
      min-width: 14px; text-align: center;
      pointer-events: none;
    }

    .cm-btn-collapse {
      display: flex; align-items: center; justify-content: center;
      border: none; background: transparent; color: var(--cm-muted);
      cursor: pointer; padding: 0; width: 28px; height: 28px;
      border-radius: 50%; flex-shrink: 0;
    }
    .cm-btn-collapse:hover { background: var(--cm-surface); color: var(--cm-ink); }

    .cm-toolbar-divider {
      width: 1px; height: 20px; background: var(--cm-border); margin: 0 2px; flex-shrink: 0;
    }

    /* === Cursor in comment mode === */
    body.cm-active { cursor: crosshair !important; }
    body.cm-active * { cursor: crosshair !important; }

    /* === Pins === */
    .cm-pin {
      position: absolute; z-index: 99990;
      width: 24px; height: 24px;
      border-radius: 50%;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      font-size: 10px; font-weight: 700; font-family: var(--cm-font);
      color: white;
      border: 2px solid white;
      transition: transform 0.2s ease;
      animation: cm-pin-appear 0.25s ease-out;
    }
    @keyframes cm-pin-appear {
      0% { transform: scale(0); }
      80% { transform: scale(1.1); }
      100% { transform: scale(1); }
    }
    .cm-pin:hover { transform: scale(1.2); }
    .cm-pin.resolved { background: var(--cm-muted) !important; }
    .cm-pin.cm-pin-must { background: #DC2626; }
    .cm-pin.cm-pin-should { background: var(--cm-accent); }
    .cm-pin.cm-pin-nice { background: #10B981; }

    /* Pin tooltip */
    .cm-pin-tooltip {
      position: absolute; left: 50%; bottom: calc(100% + 6px);
      transform: translateX(-50%); white-space: nowrap;
      background: var(--cm-ink); color: white; font-size: 11px; font-weight: 400;
      padding: 4px 8px; border-radius: 6px; pointer-events: none;
      opacity: 0; transition: opacity 0.15s;
      max-width: 200px; overflow: hidden; text-overflow: ellipsis;
      z-index: 99991;
    }
    .cm-pin:hover .cm-pin-tooltip { opacity: 1; }

    /* === Comment popup === */
    .cm-popup {
      position: absolute; z-index: 99995;
      background: var(--cm-bg); border-radius: var(--cm-radius-card);
      padding: 16px; width: 320px; border: 1px solid var(--cm-border);
      font-family: var(--cm-font);
    }
    .cm-popup-header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 12px;
    }
    .cm-popup-title { font-size: 14px; font-weight: 600; color: var(--cm-ink); }
    .cm-popup-close {
      display: flex; align-items: center; justify-content: center;
      background: none; border: none; cursor: pointer; color: var(--cm-muted);
      width: 28px; height: 28px; border-radius: 50%; padding: 0;
    }
    .cm-popup-close:hover { background: var(--cm-surface); color: var(--cm-ink); }

    /* Chip selector (category + priority) */
    .cm-chip-group {
      display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px;
    }
    .cm-chip-label {
      font-size: 11px; font-weight: 500; color: var(--cm-muted);
      margin-bottom: 4px; display: block;
    }
    .cm-chip {
      border: 1px solid var(--cm-border); background: var(--cm-bg);
      border-radius: 99px; padding: 4px 12px; font-size: 12px;
      cursor: pointer; font-family: var(--cm-font); color: var(--cm-muted);
      transition: all 0.15s; font-weight: 500; line-height: 1.4;
    }
    .cm-chip:hover { border-color: #ccc; }
    .cm-chip.selected {
      font-weight: 600;
    }

    .cm-popup textarea {
      width: 100%; border: 1px solid var(--cm-border); border-radius: var(--cm-radius-btn);
      padding: 10px 12px; font-size: 13px; font-family: var(--cm-font);
      resize: vertical; min-height: 70px; color: var(--cm-ink);
      box-sizing: border-box; outline: none; line-height: 1.5;
    }
    .cm-popup textarea:focus { border-color: var(--cm-accent); }

    .cm-popup-actions {
      display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px;
      align-items: center;
    }
    .cm-popup-actions button {
      border: none; border-radius: var(--cm-radius-btn); padding: 7px 16px;
      font-size: 13px; font-weight: 500; cursor: pointer; font-family: var(--cm-font);
      transition: opacity 0.15s;
    }
    .cm-popup-actions button:hover { opacity: 0.85; }
    .cm-popup .cm-save { background: var(--cm-accent); color: white; }
    .cm-popup .cm-delete { background: transparent; color: #DC2626; padding: 7px 8px; }
    .cm-popup .cm-delete:hover { background: #FEF2F2; }
    .cm-popup .cm-resolve { background: transparent; color: #059669; padding: 7px 8px; }
    .cm-popup .cm-resolve:hover { background: #ECFDF5; }

    /* Existing comment display in popup */
    .cm-existing-tags {
      display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px;
    }
    .cm-tag-pill {
      display: inline-flex; align-items: center;
      font-size: 11px; font-weight: 600;
      padding: 2px 10px; border-radius: 99px; line-height: 1.5;
    }
    .cm-existing-text {
      font-size: 13px; color: var(--cm-ink); line-height: 1.6;
      margin-bottom: 8px; white-space: pre-wrap;
    }
    .cm-existing-meta {
      font-size: 11px; color: var(--cm-muted); margin-bottom: 12px;
    }

    /* === Side panel === */
    .cm-panel {
      position: fixed; top: 0; right: -440px; width: 420px; height: 100vh;
      background: var(--cm-bg); z-index: 99998; border-left: 1px solid var(--cm-border);
      transition: right 0.25s ease; overflow-y: auto;
      font-family: var(--cm-font); display: flex; flex-direction: column;
    }
    .cm-panel.open { right: 0; }

    .cm-panel-header {
      padding: 20px 20px 0 20px;
      display: flex; justify-content: space-between; align-items: center;
    }
    .cm-panel-title { font-size: 16px; font-weight: 700; color: var(--cm-ink); }
    .cm-panel-close {
      display: flex; align-items: center; justify-content: center;
      background: none; border: none; cursor: pointer; color: var(--cm-muted);
      width: 32px; height: 32px; border-radius: 50%; padding: 0;
    }
    .cm-panel-close:hover { background: var(--cm-surface); color: var(--cm-ink); }

    .cm-panel-search {
      padding: 12px 20px 0 20px;
    }
    .cm-panel-search-wrap {
      position: relative;
    }
    .cm-panel-search-wrap svg {
      position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
      color: var(--cm-muted); pointer-events: none;
    }
    .cm-panel-search input {
      width: 100%; border: 1px solid var(--cm-border); border-radius: var(--cm-radius-btn);
      padding: 8px 12px 8px 32px; font-size: 13px; font-family: var(--cm-font);
      color: var(--cm-ink); box-sizing: border-box; outline: none;
      background: var(--cm-surface);
    }
    .cm-panel-search input:focus { border-color: var(--cm-accent); background: var(--cm-bg); }

    .cm-panel-filters {
      padding: 12px 20px 0 20px;
    }
    .cm-panel-filter-row {
      display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px;
    }
    .cm-panel-filter-row:last-child { margin-bottom: 0; }

    .cm-filter-chip {
      border: 1px solid var(--cm-border); background: var(--cm-bg);
      border-radius: 99px; padding: 4px 12px; font-size: 12px;
      cursor: pointer; font-family: var(--cm-font); color: var(--cm-muted);
      transition: all 0.15s; font-weight: 500; white-space: nowrap;
    }
    .cm-filter-chip:hover { border-color: #ccc; }
    .cm-filter-chip.active {
      background: var(--cm-ink); color: white; border-color: var(--cm-ink);
    }
    .cm-filter-chip .cm-filter-count {
      font-size: 10px; margin-left: 3px; opacity: 0.7;
    }

    .cm-panel-body {
      flex: 1; overflow-y: auto; padding: 16px 20px;
    }

    .cm-panel-page-group {
      margin-bottom: 20px;
    }
    .cm-panel-page-header {
      font-size: 12px; font-weight: 700; color: var(--cm-muted);
      text-transform: uppercase; letter-spacing: 0.5px;
      margin-bottom: 8px; padding-bottom: 6px;
      border-bottom: 1px solid var(--cm-border);
    }
    .cm-panel-step-header {
      font-size: 11px; font-weight: 600; color: var(--cm-muted);
      margin: 10px 0 6px 0; padding-left: 2px;
    }

    .cm-panel-item {
      padding: 12px; border: 1px solid var(--cm-border);
      border-radius: 10px; margin-bottom: 8px; cursor: pointer;
      transition: border-color 0.15s;
    }
    .cm-panel-item:hover { border-color: var(--cm-accent); }
    .cm-panel-item.resolved { opacity: 0.45; }
    .cm-panel-item-header {
      display: flex; gap: 6px; align-items: center; flex-wrap: wrap;
      margin-bottom: 6px;
    }
    .cm-panel-item-id {
      font-size: 12px; font-weight: 700; color: var(--cm-accent);
    }
    .cm-panel-item-text {
      font-size: 13px; color: var(--cm-ink); line-height: 1.5;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .cm-panel-item-meta {
      font-size: 11px; color: var(--cm-muted); margin-top: 6px;
    }
    .cm-panel-empty {
      text-align: center; padding: 40px 20px; color: var(--cm-muted); font-size: 13px;
    }

    .cm-panel-footer {
      padding: 12px 20px; border-top: 1px solid var(--cm-border);
      background: var(--cm-bg); flex-shrink: 0; display: flex; flex-direction: column; gap: 8px;
    }
    .cm-panel-footer button {
      width: 100%; background: var(--cm-ink); color: white; border: none;
      border-radius: var(--cm-radius-btn); padding: 10px; font-size: 13px;
      font-weight: 500; cursor: pointer; font-family: var(--cm-font);
      display: flex; align-items: center; justify-content: center; gap: 8px;
    }
    .cm-panel-footer button:hover { opacity: 0.9; }
    .cm-panel-footer .cm-btn-secondary { background: transparent; color: var(--cm-ink); border: 1px solid var(--cm-border); }
    .cm-panel-footer .cm-btn-danger { background: #DC2626; color: white; }
    .cm-panel-footer .cm-btn-danger:disabled { background: #E5E7EB; color: #9CA3AF; cursor: not-allowed; }
    .cm-panel-footer .cm-footer-row { display: flex; gap: 6px; }
    .cm-panel-footer .cm-footer-row button { flex: 1; padding: 9px 6px; font-size: 12px; }
    .cm-select-count { font-size: 11px; color: var(--cm-muted); text-align: center; margin-top: -2px; }
    .cm-panel-item { position: relative; }
    .cm-panel-item.cm-selectable { padding-left: 44px; }
    .cm-panel-item-check { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); width: 20px; height: 20px; border: 1.5px solid var(--cm-border); border-radius: 5px; background: var(--cm-bg); display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .cm-panel-item.cm-selected .cm-panel-item-check { background: #DC2626; border-color: #DC2626; }
    .cm-panel-item.cm-selected .cm-panel-item-check::after { content: "✓"; color: white; font-size: 13px; font-weight: 700; }
    .cm-panel-item.cm-selected { border-color: #DC2626; background: #FEF2F2; }
  `;
  document.head.appendChild(style);

  // Detect current step/screen
  // Supports: .step-section.active (wizard) · .screen.active · .view.active (Bloom)
  // Fallback id: element.id → dataset.view → dataset.screen
  // Substep: als een screen data-substep heeft, wordt dat meegenomen
  function getCurrentStep() {
    // Pianofabriek-prototype: schermen wisselen via het hidden-attribuut.
    // Rollen: [data-role-view] (klant/mailbox/werkbank). Binnen klant: [data-view].
    // Binnen werkbank: [data-admin-view] (list/detail).
    const roles = document.querySelectorAll('[data-role-view]');
    if (roles.length) {
      let role = null;
      roles.forEach(r => { if (!r.hidden) role = r; });
      if (!role) return null;
      const roleName = role.dataset.roleView;
      if (roleName === 'klant') {
        const views = role.querySelectorAll('[data-view]');
        for (const v of views) { if (!v.hidden) return v.dataset.view; }
        return 'klant';
      }
      if (roleName === 'werkbank') {
        const av = role.querySelectorAll('[data-admin-view]');
        for (const v of av) { if (!v.hidden) return 'werkbank-' + v.dataset.adminView; }
        return 'werkbank';
      }
      return roleName; // mailbox
    }
    // Standaard fallback (andere prototypes)
    const activeScreen = document.querySelector('.view.active, .screen.active');
    if (activeScreen) {
      const baseId = activeScreen.id || activeScreen.dataset.view || activeScreen.dataset.screen;
      const sub = activeScreen.dataset.substep;
      return sub ? (baseId || '') + '-' + sub : baseId || null;
    }
    const active = document.querySelector('.step-section.active');
    if (active) return active.id || null;
    return null;
  }

  // Human-readable step/screen name (uit config)
  const SCREEN_NAMES = CONFIG.screenNames;

  function getStepName(stepId) {
    if (!stepId) return null;
    // Check custom screen names first
    if (SCREEN_NAMES[stepId]) return SCREEN_NAMES[stepId];
    const el = document.getElementById(stepId);
    if (el) {
      const h = el.querySelector('h2, h3, .step-title');
      if (h) return h.textContent.trim();
    }
    const m = stepId.match(/step-?(\d+)/i);
    if (m) return 'Stap ' + m[1];
    return stepId;
  }

  // === Pin-verankering ===
  // Pins worden bewaard bij een element (cssPath) plus een relatieve offset (relX/relY,
  // 0..1 binnen dat element), niet als absolute x/y. Zo blijft een pin kleven waar je
  // bedoelde, ook als de layout herschikt, een blok hoger wordt, of op een telefoon.
  function cssEscapeId(id) {
    return (window.CSS && CSS.escape) ? CSS.escape(id) : id.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  // Bouw een stabiel CSS-pad naar een element: stopt bij het eerste id (uniek),
  // anders nth-of-type per niveau tot aan body.
  function cssPath(el) {
    if (!el || el.nodeType !== 1 || el === document.body) return 'body';
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      if (node.id) { parts.unshift('#' + cssEscapeId(node.id)); break; }
      let nth = 1, sib = node;
      while ((sib = sib.previousElementSibling)) { if (sib.nodeName === node.nodeName) nth++; }
      parts.unshift(node.nodeName.toLowerCase() + ':nth-of-type(' + nth + ')');
      node = node.parentElement;
    }
    return parts.length ? parts.join(' > ') : 'body';
  }

  function resolveAnchor(path) {
    if (!path || path === 'body') return document.body;
    try { return document.querySelector(path) || document.body; } catch (e) { return document.body; }
  }

  // Bepaal het anker (element + relatieve offset) voor een klik op (pageX, pageY).
  function anchorFromPoint(target, pageX, pageY) {
    const anchor = cssPath(target);
    const el = resolveAnchor(anchor);
    const rect = el.getBoundingClientRect();
    return {
      anchor,
      relX: rect.width ? (pageX - (window.scrollX + rect.left)) / rect.width : 0,
      relY: rect.height ? (pageY - (window.scrollY + rect.top)) / rect.height : 0
    };
  }

  // Reken een comment terug naar absolute pagina-coordinaten via zijn anker.
  // Oude comments zonder anker (of een verdwenen element) vallen terug op opgeslagen x/y.
  function commentPagePos(c) {
    if (c.anchor) {
      const el = resolveAnchor(c.anchor);
      const rect = el.getBoundingClientRect();
      if (rect.width || rect.height || c.anchor === 'body') {
        return {
          x: window.scrollX + rect.left + (c.relX || 0) * rect.width,
          y: window.scrollY + rect.top + (c.relY || 0) * rect.height
        };
      }
    }
    return { x: c.x || 0, y: c.y || 0 };
  }

  // Create toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'cm-toolbar';
  toolbar.innerHTML = `
    <button class="cm-btn-collapse" title="Toon/verberg toolbar">${ICONS.chevronRight}</button>
    <button class="cm-tbtn cm-tbtn-comment" title="Comment plaatsen (C)">${ICONS.plus}</button>
    <div class="cm-toolbar-divider"></div>
    <button class="cm-tbtn cm-tbtn-eye" title="Pins tonen/verbergen (H)">${ICONS.eye}</button>
    <button class="cm-tbtn cm-tbtn-panel" title="Overzicht">
      ${ICONS.list}
      <span class="cm-tbtn-badge">0</span>
    </button>
    <button class="cm-tbtn cm-tbtn-export" title="Exporteer Markdown">${ICONS.download}</button>
  `;
  document.body.appendChild(toolbar);

  // Wire toolbar buttons
  toolbar.querySelector('.cm-btn-collapse').onclick = collapseToolbar;
  toolbar.querySelector('.cm-tbtn-comment').onclick = toggle;
  toolbar.querySelector('.cm-tbtn-eye').onclick = togglePins;
  toolbar.querySelector('.cm-tbtn-panel').onclick = togglePanel;
  toolbar.querySelector('.cm-tbtn-export').onclick = exportMD;

  // Create panel
  const panel = document.createElement('div');
  panel.className = 'cm-panel';
  panel.id = 'cmPanel';
  document.body.appendChild(panel);

  // Update badge count
  function updateBadge() {
    const badge = toolbar.querySelector('.cm-tbtn-badge');
    const open = comments.filter(c => !c.resolved).length;
    badge.textContent = open;
    badge.style.display = open > 0 ? '' : 'none';
  }

  // Render pins
  function renderPins() {
    document.querySelectorAll('.cm-pin').forEach(p => p.remove());
    if (!pinsVisible) return;

    const currentStep = getCurrentStep();
    comments.forEach(c => {
      if (c.resolved) return;
      // SPA-modus: als er .screen elementen zijn, toon pin ALLEEN op het juiste scherm
      if (currentStep && c.step !== currentStep) return;
      const pin = document.createElement('div');
      const pClass = c.priority === 'must' ? 'cm-pin-must' : c.priority === 'nice' ? 'cm-pin-nice' : 'cm-pin-should';
      pin.className = 'cm-pin ' + pClass + (c.resolved ? ' resolved' : '');
      const pos = commentPagePos(c);
      pin.style.left = (pos.x - 12) + 'px';
      pin.style.top = (pos.y - 12) + 'px';
      const preview = (c.text || '').substring(0, 30) + ((c.text || '').length > 30 ? '...' : '');
      pin.innerHTML = `<span style="font-size:10px;line-height:1">${c.id}</span><div class="cm-pin-tooltip">${escapeHtml(preview)}</div>`;
      pin.onclick = (e) => { e.stopPropagation(); showExistingPopup(c); };
      document.body.appendChild(pin);
    });
    updateBadge();
  }

  // Re-render pins when steps/screens change
  const observer = new MutationObserver(() => renderPins());
  document.querySelectorAll('.step-section, .screen, .view').forEach(el => {
    observer.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
  });
  // Pianofabriek-prototype: schermen togglen via het hidden-attribuut
  document.querySelectorAll('[data-role-view], [data-view], [data-admin-view]').forEach(el => {
    observer.observe(el, { attributes: true, attributeFilter: ['hidden'] });
  });

  // Herbereken pinposities wanneer de layout verandert (resize, orientatie).
  // Pins zijn verankerd aan elementen, dus na een reflow moeten ze opnieuw gepositioneerd worden.
  let resizeRaf = null;
  window.addEventListener('resize', () => {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(renderPins);
  });

  // Save to server + localStorage fallback
  function save() {
    allCommentsData[PAGE_KEY] = comments;
    localStorage.setItem(CONFIG.storagePrefix + PAGE_KEY, JSON.stringify(comments));
    if (CONFIG.apiEndpoint) {
      fetch(CONFIG.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(allCommentsData)
      }).catch(() => {});
    }
    renderPins();
  }

  // Toggle comment mode
  function toggle() {
    commentMode = !commentMode;
    document.body.classList.toggle('cm-active', commentMode);
    const btn = toolbar.querySelector('.cm-tbtn-comment');
    if (commentMode) {
      btn.classList.add('active');
      btn.innerHTML = ICONS.close;
      toolbar.classList.add('cm-mode-active');
    } else {
      btn.classList.remove('active');
      btn.innerHTML = ICONS.plus;
      toolbar.classList.remove('cm-mode-active');
    }
  }

  // Handle click in comment mode
  document.addEventListener('click', (e) => {
    if (!commentMode) return;
    if (e.target.closest('.cm-toolbar') || e.target.closest('.cm-popup') || e.target.closest('.cm-panel') || e.target.closest('.cm-pin')) return;
    e.preventDefault();
    e.stopPropagation();
    const x = e.pageX;
    const y = e.pageY;
    const anchorData = anchorFromPoint(e.target, x, y);
    showNewPopup(x, y, anchorData);
    toggle();
  }, true);

  // Build chip selector HTML
  function buildChips(items, selectedKey, groupName) {
    return Object.entries(items).map(([key, def]) => {
      const sel = key === selectedKey ? 'selected' : '';
      const borderColor = sel ? def.color : 'var(--cm-border)';
      const textColor = sel ? def.color : 'var(--cm-muted)';
      const bgColor = sel ? def.color + '10' : 'transparent';
      return `<button class="cm-chip ${sel}" data-group="${groupName}" data-val="${key}"
        style="border-color:${borderColor};color:${textColor};background:${bgColor}">${def.label}</button>`;
    }).join('');
  }

  // Chip click handler (delegated)
  function handleChipClick(e) {
    const chip = e.target.closest('.cm-chip');
    if (!chip) return;
    const group = chip.dataset.group;
    const popup = chip.closest('.cm-popup');
    if (!popup) return;
    popup.querySelectorAll(`.cm-chip[data-group="${group}"]`).forEach(c => {
      c.classList.remove('selected');
      const def = (group === 'category' ? CATEGORIES : PRIORITIES)[c.dataset.val];
      if (def) {
        c.style.borderColor = 'var(--cm-border)';
        c.style.color = 'var(--cm-muted)';
        c.style.background = 'transparent';
      }
    });
    chip.classList.add('selected');
    const def = (group === 'category' ? CATEGORIES : PRIORITIES)[chip.dataset.val];
    if (def) {
      chip.style.borderColor = def.color;
      chip.style.color = def.color;
      chip.style.background = def.color + '10';
    }
  }

  // Show popup for new comment
  function showNewPopup(x, y, anchorData) {
    closeAllPopups();
    const popup = document.createElement('div');
    popup.className = 'cm-popup';
    popup.style.left = (x + 16) + 'px';
    popup.style.top = (y - 16) + 'px';

    setTimeout(() => {
      const rect = popup.getBoundingClientRect();
      if (rect.right > window.innerWidth - 20) popup.style.left = (x - 336) + 'px';
      if (rect.bottom > window.innerHeight - 20) popup.style.top = (y - rect.height) + 'px';
    }, 0);

    popup.innerHTML = `
      <div class="cm-popup-header">
        <span class="cm-popup-title">Nieuwe opmerking #${nextId}</span>
        <button class="cm-popup-close">${ICONS.close}</button>
      </div>
      <span class="cm-chip-label">Categorie</span>
      <div class="cm-chip-group">
        ${buildChips(CATEGORIES, 'ux', 'category')}
      </div>
      <span class="cm-chip-label">Prioriteit</span>
      <div class="cm-chip-group">
        ${buildChips(PRIORITIES, 'should', 'priority')}
      </div>
      <textarea placeholder="Wat moet hier anders?"></textarea>
      <div class="cm-popup-actions">
        <button class="cm-save">Opslaan</button>
      </div>
    `;
    popup.addEventListener('click', handleChipClick);
    popup.querySelector('.cm-popup-close').onclick = () => popup.remove();
    popup.querySelector('.cm-save').onclick = () => saveNew(popup, x, y, anchorData);

    document.body.appendChild(popup);
    popup.querySelector('textarea').focus();
  }

  // Show popup for existing comment
  function showExistingPopup(comment) {
    closeAllPopups();
    const popup = document.createElement('div');
    popup.className = 'cm-popup';
    const cpos = commentPagePos(comment);
    popup.style.left = (cpos.x + 16) + 'px';
    popup.style.top = (cpos.y - 16) + 'px';

    setTimeout(() => {
      const rect = popup.getBoundingClientRect();
      if (rect.right > window.innerWidth - 20) popup.style.left = (cpos.x - 336) + 'px';
      if (rect.bottom > window.innerHeight - 20) popup.style.top = (cpos.y - rect.height) + 'px';
    }, 0);

    const cat = CATEGORIES[comment.category] || CATEGORIES.ux;
    const pri = PRIORITIES[comment.priority] || PRIORITIES.should;

    const stepLabel = comment.step ? getStepName(comment.step) : '';
    const pageName = PAGE_NAMES[comment.page] || comment.page;

    popup.innerHTML = `
      <div class="cm-popup-header">
        <span class="cm-popup-title">#${comment.id}</span>
        <button class="cm-popup-close">${ICONS.close}</button>
      </div>
      <div class="cm-existing-tags">
        <span class="cm-tag-pill" style="background:${cat.color}15;color:${cat.color}">${cat.label}</span>
        <span class="cm-tag-pill" style="background:${pri.color}15;color:${pri.color}">${pri.label}</span>
      </div>
      <div class="cm-existing-text">${escapeHtml(comment.text)}</div>
      <div class="cm-existing-meta">${pageName}${stepLabel ? ' / ' + stepLabel : ''} &middot; ${comment.date}</div>
      <div class="cm-popup-actions">
        <button class="cm-delete">Verwijder</button>
        <button class="cm-resolve">${comment.resolved ? 'Heropen' : 'Opgelost'}</button>
      </div>
    `;
    popup.querySelector('.cm-popup-close').onclick = () => popup.remove();
    popup.querySelector('.cm-delete').onclick = () => deleteComment(comment.id);
    popup.querySelector('.cm-resolve').onclick = () => resolveComment(comment.id);

    document.body.appendChild(popup);
  }

  function closeAllPopups() {
    document.querySelectorAll('.cm-popup').forEach(p => p.remove());
  }

  function saveNew(popup, x, y, anchorData) {
    const text = popup.querySelector('textarea').value.trim();
    if (!text) return;
    const priority = popup.querySelector('.cm-chip[data-group="priority"].selected')?.dataset.val || 'should';
    const category = popup.querySelector('.cm-chip[data-group="category"].selected')?.dataset.val || 'ux';

    comments.push({
      id: nextId++,
      text,
      priority,
      category,
      x, y,
      anchor: anchorData ? anchorData.anchor : 'body',
      relX: anchorData ? anchorData.relX : 0,
      relY: anchorData ? anchorData.relY : 0,
      step: getCurrentStep(),
      page: location.pathname.split('/').pop() || 'index.html',
      date: new Date().toLocaleDateString('nl-BE'),
      resolved: false
    });
    save();
    popup.remove();
  }

  function deleteComment(id) {
    comments = comments.filter(c => c.id !== id);
    save();
    closeAllPopups();
    if (panel.classList.contains('open')) renderPanel();
  }

  function resolveComment(id) {
    const c = comments.find(c => c.id === id);
    if (c) c.resolved = !c.resolved;
    save();
    closeAllPopups();
    if (panel.classList.contains('open')) renderPanel();
  }

  // Panel
  function togglePanel() {
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) renderPanel();
  }

  function getFilteredComments(allPageComments) {
    let filtered = allPageComments;
    // Category filter
    if (panelFilter !== 'all') {
      filtered = filtered.filter(c => c.category === panelFilter);
    }
    // Priority filter
    if (panelPriorityFilter !== 'all') {
      if (panelPriorityFilter === 'open') {
        filtered = filtered.filter(c => !c.resolved);
      } else {
        filtered = filtered.filter(c => c.priority === panelPriorityFilter && !c.resolved);
      }
    }
    // Search
    if (panelSearch) {
      const q = panelSearch.toLowerCase();
      filtered = filtered.filter(c => (c.text || '').toLowerCase().includes(q));
    }
    return filtered;
  }

  function renderPanel() {
    // Gather all comments from all pages
    let allPageComments = [];
    try {
      Object.entries(allCommentsData).forEach(([pageKey, pageComments]) => {
        pageComments.forEach(c => {
          if (!c.category) c.category = 'ux';
          allPageComments.push(c);
        });
      });
    } catch(e) {}
    // Also include current page comments if not in allCommentsData yet
    if (!allCommentsData[PAGE_KEY]) {
      comments.forEach(c => { if (!c.category) c.category = 'ux'; allPageComments.push(c); });
    }

    // Counts for filter chips
    const catCounts = {};
    Object.keys(CATEGORIES).forEach(k => { catCounts[k] = allPageComments.filter(c => c.category === k && !c.resolved).length; });
    const allOpen = allPageComments.filter(c => !c.resolved).length;

    const filtered = getFilteredComments(allPageComments);

    // Group by page
    const pageGroups = {};
    filtered.forEach(c => {
      const pg = c.page || 'index.html';
      if (!pageGroups[pg]) pageGroups[pg] = [];
      pageGroups[pg].push(c);
    });

    // Build items HTML grouped by page and step
    let itemsHtml = '';
    const allPages = [...new Set([...CONFIG.pageOrder, ...Object.keys(pageGroups)])];

    allPages.forEach(pg => {
      const pgComments = pageGroups[pg];
      if (!pgComments || !pgComments.length) return;
      const pageName = PAGE_NAMES[pg] || pg;

      itemsHtml += `<div class="cm-panel-page-group">`;
      itemsHtml += `<div class="cm-panel-page-header">${escapeHtml(pageName)} (${pg})</div>`;

      // Sub-group by step
      const stepGroups = {};
      pgComments.forEach(c => {
        const sk = c.step || '__none__';
        if (!stepGroups[sk]) stepGroups[sk] = [];
        stepGroups[sk].push(c);
      });

      Object.entries(stepGroups).forEach(([stepKey, stepComments]) => {
        if (stepKey !== '__none__') {
          const stepName = getStepName(stepKey) || stepKey;
          itemsHtml += `<div class="cm-panel-step-header">${escapeHtml(stepName)}</div>`;
        }
        stepComments.forEach(c => {
          const cat = CATEGORIES[c.category] || CATEGORIES.ux;
          const pri = PRIORITIES[c.priority] || PRIORITIES.should;
          const selClass = panelSelectMode ? ' cm-selectable' : '';
          const selectedClass = panelSelected.has(c.id) ? ' cm-selected' : '';
          const checkHtml = panelSelectMode ? `<div class="cm-panel-item-check"></div>` : '';
          itemsHtml += `
            <div class="cm-panel-item ${c.resolved ? 'resolved' : ''}${selClass}${selectedClass}" data-comment-id="${c.id}" data-page="${c.page}">
              ${checkHtml}
              <div class="cm-panel-item-header">
                <span class="cm-panel-item-id">#${c.id}</span>
                <span class="cm-tag-pill" style="background:${cat.color}15;color:${cat.color};font-size:10px;padding:1px 8px">${cat.label}</span>
                <span class="cm-tag-pill" style="background:${pri.color}15;color:${pri.color};font-size:10px;padding:1px 8px">${pri.label}</span>
              </div>
              <div class="cm-panel-item-text">${escapeHtml(c.text)}</div>
              <div class="cm-panel-item-meta">${c.date}${c.resolved ? ' &middot; opgelost' : ''}</div>
            </div>`;
        });
      });
      itemsHtml += `</div>`;
    });

    if (!itemsHtml) itemsHtml = '<div class="cm-panel-empty">Geen opmerkingen gevonden.</div>';

    panel.innerHTML = `
      <div class="cm-panel-header">
        <span class="cm-panel-title">Opmerkingen</span>
        <button class="cm-panel-close">${ICONS.close}</button>
      </div>
      <div class="cm-panel-search">
        <div class="cm-panel-search-wrap">
          ${ICONS.search}
          <input type="text" placeholder="Zoeken..." value="${escapeHtml(panelSearch)}" />
        </div>
      </div>
      <div class="cm-panel-filters">
        <div class="cm-panel-filter-row">
          <button class="cm-filter-chip ${panelFilter === 'all' ? 'active' : ''}" data-filter="all">Alle<span class="cm-filter-count">${allOpen}</span></button>
          ${Object.entries(CATEGORIES).map(([k, v]) =>
            `<button class="cm-filter-chip ${panelFilter === k ? 'active' : ''}" data-filter="${k}">${v.label}<span class="cm-filter-count">${catCounts[k]}</span></button>`
          ).join('')}
        </div>
        <div class="cm-panel-filter-row">
          <button class="cm-filter-chip ${panelPriorityFilter === 'all' ? 'active' : ''}" data-pfilter="all">Alle prioriteiten</button>
          <button class="cm-filter-chip ${panelPriorityFilter === 'open' ? 'active' : ''}" data-pfilter="open">Open</button>
          <button class="cm-filter-chip ${panelPriorityFilter === 'must' ? 'active' : ''}" data-pfilter="must">Must</button>
          <button class="cm-filter-chip ${panelPriorityFilter === 'should' ? 'active' : ''}" data-pfilter="should">Should</button>
          <button class="cm-filter-chip ${panelPriorityFilter === 'nice' ? 'active' : ''}" data-pfilter="nice">Nice</button>
        </div>
      </div>
      <div class="cm-panel-body">
        ${itemsHtml}
      </div>
      <div class="cm-panel-footer">
        ${panelSelectMode ? `
          <div class="cm-select-count">${panelSelected.size} geselecteerd${panelSelected.size > 0 ? '' : ' · tap items om te selecteren'}</div>
          <div class="cm-footer-row">
            <button class="cm-btn-secondary" data-bulk="all">Alles</button>
            <button class="cm-btn-secondary" data-bulk="none">Wissen</button>
            <button class="cm-btn-danger" data-bulk="delete"${panelSelected.size === 0 ? ' disabled' : ''}>Verwijder ${panelSelected.size}</button>
          </div>
          <button class="cm-btn-secondary" data-bulk="exit">Annuleer</button>
        ` : `
          <button class="cm-panel-export-btn">${ICONS.download} Exporteer als Markdown</button>
          <div class="cm-footer-row">
            <button class="cm-btn-secondary" data-bulk="enter">☐ Selecteren</button>
            <button class="cm-btn-secondary" data-bulk="delete-filtered">Verwijder zichtbare</button>
          </div>
        `}
      </div>
    `;

    // Wire panel events
    panel.querySelector('.cm-panel-close').onclick = togglePanel;
    panel.querySelector('.cm-panel-search input').oninput = (e) => {
      panelSearch = e.target.value;
      renderPanel();
      // Re-focus search after re-render
      const input = panel.querySelector('.cm-panel-search input');
      if (input) { input.focus(); input.selectionStart = input.selectionEnd = input.value.length; }
    };

    panel.querySelectorAll('.cm-filter-chip[data-filter]').forEach(btn => {
      btn.onclick = () => { panelFilter = btn.dataset.filter; renderPanel(); };
    });
    panel.querySelectorAll('.cm-filter-chip[data-pfilter]').forEach(btn => {
      btn.onclick = () => { panelPriorityFilter = btn.dataset.pfilter; renderPanel(); };
    });

    panel.querySelectorAll('.cm-panel-item').forEach(item => {
      item.onclick = () => {
        const id = parseInt(item.dataset.commentId);
        if (panelSelectMode) {
          if (panelSelected.has(id)) panelSelected.delete(id); else panelSelected.add(id);
          renderPanel();
          return;
        }
        const pg = item.dataset.page;
        const currentPage = location.pathname.split('/').pop() || 'index.html';
        if (pg && pg !== currentPage) {
          window.location.href = pg + '#cm-' + id;
          return;
        }
        scrollToComment(id);
      };
    });

    const exportBtn = panel.querySelector('.cm-panel-export-btn');
    if (exportBtn) exportBtn.onclick = exportMD;

    // Bulk action buttons
    panel.querySelectorAll('[data-bulk]').forEach(btn => {
      btn.onclick = () => {
        const action = btn.dataset.bulk;
        if (action === 'enter') {
          panelSelectMode = true;
          panelSelected.clear();
          renderPanel();
          return;
        }
        if (action === 'exit') {
          panelSelectMode = false;
          panelSelected.clear();
          renderPanel();
          return;
        }
        if (action === 'all') {
          // Select all currently visible (filtered) comments
          const allPageComments = Object.values(allCommentsData).flat();
          const visible = getFilteredComments(allPageComments);
          visible.forEach(c => panelSelected.add(c.id));
          renderPanel();
          return;
        }
        if (action === 'none') {
          panelSelected.clear();
          renderPanel();
          return;
        }
        if (action === 'delete') {
          if (panelSelected.size === 0) return;
          if (!confirm(`Verwijder ${panelSelected.size} opmerking(en)? Dit kan niet ongedaan gemaakt worden.`)) return;
          // Remove from all pages
          Object.keys(allCommentsData).forEach(pg => {
            allCommentsData[pg] = (allCommentsData[pg] || []).filter(c => !panelSelected.has(c.id));
          });
          comments = allCommentsData[PAGE_KEY] || [];
          panelSelected.clear();
          panelSelectMode = false;
          save();
          renderPanel();
          return;
        }
        if (action === 'delete-filtered') {
          const allPageComments = Object.values(allCommentsData).flat();
          const visible = getFilteredComments(allPageComments);
          if (visible.length === 0) { alert('Geen zichtbare opmerkingen om te verwijderen.'); return; }
          if (!confirm(`Verwijder ${visible.length} zichtbare opmerking(en)? Dit respecteert de huidige filters. Dit kan niet ongedaan gemaakt worden.`)) return;
          const idsToDelete = new Set(visible.map(c => c.id));
          Object.keys(allCommentsData).forEach(pg => {
            allCommentsData[pg] = (allCommentsData[pg] || []).filter(c => !idsToDelete.has(c.id));
          });
          comments = allCommentsData[PAGE_KEY] || [];
          save();
          renderPanel();
          return;
        }
      };
    });
  }

  function scrollToComment(id) {
    const c = comments.find(c => c.id === id);
    if (!c) return;
    // If the comment is in a step, try to show that step first
    if (c.step) {
      const stepEl = document.getElementById(c.step);
      if (stepEl) {
        // Try to activate the step
        document.querySelectorAll('.step-section').forEach(s => {
          s.classList.remove('active');
          s.style.display = 'none';
        });
        stepEl.classList.add('active');
        stepEl.style.display = 'block';
        renderPins();
      }
    }
    window.scrollTo({ top: commentPagePos(c).y - 200, behavior: 'smooth' });
    // Flash the pin
    setTimeout(() => {
      const pins = document.querySelectorAll('.cm-pin');
      pins.forEach(pin => {
        if (pin.querySelector('span')?.textContent == id) {
          pin.style.transform = 'scale(1.5)';
          pin.style.transition = 'transform 0.3s ease';
          setTimeout(() => { pin.style.transform = ''; }, 500);
        }
      });
    }, 300);
    showExistingPopup(c);
  }

  // Export as Markdown (grouped by page > category > priority)
  async function exportMD() {
    let allByPage = {};
    try {
      if (!CONFIG.apiEndpoint) throw new Error('localStorage-only');
      const res = await fetch(CONFIG.apiEndpoint);
      const data = await res.json();
      Object.entries(data).forEach(([pageKey, pageComments]) => {
        const pageName = pageKey.split('/').pop() || 'index.html';
        if (!allByPage[pageName]) allByPage[pageName] = [];
        pageComments.forEach(c => {
          if (!c.category) c.category = 'ux';
          allByPage[pageName].push(c);
        });
      });
    } catch(e) {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith(CONFIG.storagePrefix)) {
          const pcs = JSON.parse(localStorage.getItem(key));
          pcs.forEach(c => {
            if (!c.category) c.category = 'ux';
            const pg = c.page || 'index.html';
            if (!allByPage[pg]) allByPage[pg] = [];
            allByPage[pg].push(c);
          });
        }
      }
    }

    const allComments = Object.values(allByPage).flat();
    if (allComments.length === 0) {
      alert('Geen opmerkingen om te exporteren.');
      return;
    }

    const priorityOrder = ['must', 'should', 'nice'];
    const allPages = [...new Set([...CONFIG.pageOrder, ...Object.keys(allByPage)])];

    const projectName = CONFIG.projectName;
    let md = `# ${projectName} - Dev Roadmap\n`;
    md += `Gegenereerd op ${new Date().toLocaleDateString('nl-BE')}\n\n`;

    allPages.forEach(pg => {
      const pageComments = allByPage[pg];
      if (!pageComments || !pageComments.length) return;
      const pageName = PAGE_NAMES[pg] || pg;
      const openComments = pageComments.filter(c => !c.resolved);
      if (openComments.length === 0) return;

      md += `## ${pageName} (${pg})\n\n`;

      // Group by category
      Object.entries(CATEGORIES).forEach(([catKey, catDef]) => {
        const catComments = openComments.filter(c => (c.category || 'ux') === catKey);
        if (!catComments.length) return;

        md += `### ${catDef.label}\n\n`;

        // Sort by priority order
        catComments.sort((a, b) => priorityOrder.indexOf(a.priority || 'should') - priorityOrder.indexOf(b.priority || 'should'));

        catComments.forEach(c => {
          const priLabel = (PRIORITIES[c.priority] || PRIORITIES.should).label;
          const stepNote = c.step ? ` (${getStepName(c.step) || c.step})` : '';
          md += `- [ ] **#${c.id}** [${priLabel}] ${c.text}${stepNote}\n`;
        });
        md += '\n';
      });
    });

    // Resolved section
    const resolved = allComments.filter(c => c.resolved);
    if (resolved.length) {
      md += `## Opgelost (${resolved.length})\n\n`;
      resolved.forEach(c => {
        md += `- [x] **#${c.id}** [${(PAGE_NAMES[c.page] || c.page)}] ${c.text}\n`;
      });
      md += '\n';
    }

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/,'');
    a.download = `${slug}-roadmap.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Toggle pin visibility
  function togglePins() {
    pinsVisible = !pinsVisible;
    const btn = toolbar.querySelector('.cm-tbtn-eye');
    btn.innerHTML = pinsVisible ? ICONS.eye : ICONS.eyeOff;
    btn.title = pinsVisible ? 'Pins verbergen (H)' : 'Pins tonen (H)';
    renderPins();
    closeAllPopups();
  }

  // Collapse toolbar
  function collapseToolbar() {
    toolbar.classList.toggle('collapsed');
    const btn = toolbar.querySelector('.cm-btn-collapse');
    btn.innerHTML = toolbar.classList.contains('collapsed') ? ICONS.chevronLeft : ICONS.chevronRight;
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Don't trigger when focused on input/textarea/contenteditable
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;

    if (e.key === 'c' || e.key === 'C') {
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        toggle();
      }
    }
    if (e.key === 'h' || e.key === 'H') {
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        togglePins();
      }
    }
    if (e.key === 'Escape') {
      if (commentMode) {
        toggle();
      } else if (document.querySelector('.cm-popup')) {
        closeAllPopups();
      } else if (panel.classList.contains('open')) {
        togglePanel();
      }
    }
  });

  // Check for hash-based navigation (from panel cross-page click)
  function checkHash() {
    const h = location.hash;
    if (h && h.startsWith('#cm-')) {
      const id = parseInt(h.substring(4));
      if (id) {
        setTimeout(() => scrollToComment(id), 500);
        history.replaceState(null, '', location.pathname + location.search);
      }
    }
  }

  // Utility
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // Public API (kept for backward compatibility)
  window._cm = {
    toggle,
    togglePins,
    togglePanel,
    collapseToolbar,
    saveNew: (btn, x, y) => { /* legacy, no longer used via onclick */ },
    selectPriority: () => { /* legacy */ },
    deleteComment,
    resolveComment,
    scrollTo: scrollToComment,
    filter: (f) => { panelFilter = f; renderPanel(); },
    exportMD
  };

  // Init
  loadComments().then(() => {
    checkHash();
  });
})();
