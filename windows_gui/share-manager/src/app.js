// app.js — Mac-Window 공유 관리자 frontend.

if (!window.__TAURI__) {
  document.body.innerHTML = '<div style="padding:40px;color:#D11A2A;font-family:sans-serif">'
    + '<h2>__TAURI__ global missing</h2>'
    + 'Set <code>app.withGlobalTauri: true</code> in tauri.conf.json and rebuild.'
    + '</div>';
  throw new Error('__TAURI__ global not available');
}
const { invoke } = window.__TAURI__.core;
const webview = window.__TAURI__.webview && window.__TAURI__.webview.getCurrentWebview
  ? window.__TAURI__.webview.getCurrentWebview()
  : null;

const CATEGORIES = [
  { key: 'documents',    label: '문서',     emoji: '📄', folder: '30_Documents'    },
  { key: 'data',         label: '데이터',   emoji: '📊', folder: '20_Data'         },
  { key: 'repos',        label: '코드',     emoji: '💻', folder: '10_Repos'        },
  { key: 'research',     label: '리서치',   emoji: '🔬', folder: '40_Research'     },
  { key: 'env',          label: '환경설정', emoji: '⚙',  folder: '50_Env'          },
  { key: 'builds',       label: '빌드',     emoji: '🛠', folder: '60_Builds'       },
  { key: 'assets',       label: '애셋',     emoji: '🎨', folder: '70_Assets'       },
  { key: 'misc',         label: '기타',     emoji: '📦', folder: '90_Misc'         },
  { key: 'unclassified', label: '미분류',   emoji: '❔', folder: '99_Unclassified' },
];

// Sidebar groups: each shows category counts for a particular (direction, state).
const NAV_GROUPS = [
  { id: 'inbox',    iconName: 'inbox',    title: '받기 (Mac → Windows)',    direction: 'mac_to_windows', state: 'ready' },
  { id: 'outbox',   iconName: 'send',     title: '보낸 것 (Windows → Mac)', direction: 'windows_to_mac', state: 'ready' },
  { id: 'received', iconName: 'archive',  title: '받은 기록',                  direction: 'windows_to_mac', state: 'received' },
];

// ─── Lucide-style inline SVG icons (stroke-based, currentColor) ──
// Source: lucide.dev (MIT). Inlined to avoid network deps / CSP issues.
const ICONS = {
  'arrow-left-right': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/></svg>',
  'rocket': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>',
  'inbox': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
  'send': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/></svg>',
  'archive': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>',
  'notebook-pen': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/></svg>',
  'clipboard': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>',
  'settings': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
  'refresh-cw': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>',
  'asterisk': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6v12"/><path d="M17.196 9 6.804 15"/><path d="m6.804 9 10.392 6"/></svg>',
};

function svgIcon(name) {
  return ICONS[name] || '';
}

const VIEW_TREE      = 'tree';
const VIEW_ITEMS     = 'items';
const VIEW_NOTES     = 'notes';
const VIEW_CLIPBOARD = 'clipboard';
const VIEW_SETTINGS  = 'settings';

const state = {
  view: VIEW_TREE,
  selection: { group: 'inbox', categoryKey: null },
  cache: new Map(),
  pendingDrop: null,
  treePath: null,
  settings: null,
  notes:     { list: [], selectedId: null, current: null, saveTimer: null },
  clipboard: { current: null, history: [], pollTimer: null },
};

// Defaults applied if backend returns nothing (shouldn't happen but be safe)
const DEFAULT_SETTINGS = {
  schema_version: 1,
  tree: { max_depth: 4, shortcuts: [] },
  network: { remote_host: '192.168.50.2' },
  appearance: { icon_theme: 'default', icon_themes: [], icon_theme_path: null },
};

// Cached policy from shared policy.json (loaded on settings open)
let cachedPolicy = null;

// Loaded VSCode icon theme definition for the active theme (null when not active)
let activeThemeDef = null;     // raw icon-theme.json content
let activeThemeBaseDir = null; // directory of the json (for resolving relative iconPath)

// ─── DOM refs ───────────────────────────────────────────────────
const $navPinned = document.getElementById('nav-pinned');
const $navTools  = document.getElementById('nav-tools');
const $panelItems = document.getElementById('panel-items');
const $panelTree  = document.getElementById('panel-tree');
const $tree       = document.getElementById('tree');
const $treePath   = document.getElementById('tree-path');
const $treeUp     = document.getElementById('tree-up');
const $treeHome   = document.getElementById('tree-home');
const $treeDesktop= document.getElementById('tree-desktop');
const $treeShortcuts = document.getElementById('tree-shortcuts');
const $panelSettings = document.getElementById('panel-settings');
const $dropZone   = document.getElementById('drop-zone');
const $dropZonePick = document.getElementById('drop-zone-pick');
const $settingsBtn = document.getElementById('settings-btn');
// Settings inputs
const $depthValue = document.getElementById('depth-value');
const $depthDec   = document.getElementById('depth-dec');
const $depthInc   = document.getElementById('depth-inc');
const $shortcutsList = document.getElementById('shortcuts-list');
const $addShortcut = document.getElementById('add-shortcut');
const $remoteHost = document.getElementById('remote-host');
const $checkConn  = document.getElementById('check-conn');
const $speedTest  = document.getElementById('speed-test');
const $connResult = document.getElementById('conn-result');
const $speedResult= document.getElementById('speed-result');
const $themeOptions = document.getElementById('theme-options');
const $installTheme = document.getElementById('install-theme');
// Notes refs
const $panelNotes   = document.getElementById('panel-notes');
const $notesList    = document.getElementById('notes-list');
const $newNoteBtn   = document.getElementById('new-note-btn');
const $notesEmpty   = document.getElementById('notes-empty');
const $notesEditor  = document.getElementById('notes-editor');
const $noteTitle    = document.getElementById('note-title');
const $noteBody     = document.getElementById('note-body');
const $noteMeta     = document.getElementById('note-meta');
const $noteDelete   = document.getElementById('note-delete');
const $noteSaveStatus = document.getElementById('note-save-status');
// Clipboard refs
const $panelClipboard = document.getElementById('panel-clipboard');
const $clipCurrentMeta = document.getElementById('clip-current-meta');
const $clipCurrentText = document.getElementById('clip-current-text');
const $clipPush     = document.getElementById('clip-push');
const $clipPull     = document.getElementById('clip-pull');
const $clipRefresh  = document.getElementById('clip-refresh');
const $clipHistory  = document.getElementById('clip-history');
const $nav     = document.getElementById('nav');
const $items   = document.getElementById('items');
const $empty   = document.getElementById('empty');
const $title   = document.getElementById('title');
const $subtitle= document.getElementById('subtitle');
const $status  = document.getElementById('status');
const $revealBtn = document.getElementById('reveal-btn');
const $dropOverlay = document.getElementById('drop-overlay');
const $catPicker = document.getElementById('cat-picker');
const $catPickerTarget = document.getElementById('cat-picker-target');
const $catPickerSelect = document.getElementById('cat-picker-select');
const $catPickerSend = document.getElementById('cat-picker-send');
const $details = document.getElementById('details');
const $detailsTitle = document.getElementById('details-title');
const $detailsBody = document.getElementById('details-body');
const $detailsOpen = document.getElementById('details-open');
const $detailsReveal = document.getElementById('details-reveal');
const $toasts = document.getElementById('toasts');

// ─── Helpers ────────────────────────────────────────────────────
function fmtBytes(n) {
  if (n >= 1e9) return (n/1e9).toFixed(1) + ' GB';
  if (n >= 1e6) return (n/1e6).toFixed(1) + ' MB';
  if (n >= 1e3) return (n/1e3).toFixed(1) + ' KB';
  return n + ' B';
}
function fmtRelative(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60)        return '방금';
  if (diff < 3600)      return Math.floor(diff/60) + '분 전';
  if (diff < 86400)     return Math.floor(diff/3600) + '시간 전';
  if (diff < 86400*7)   return Math.floor(diff/86400) + '일 전';
  return d.toLocaleDateString('ko-KR');
}
function fmtFull(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ko-KR');
}
function escape(s) {
  return (s ?? '').toString()
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
}
function toast(msg, kind='') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  $toasts.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}
function setStatus(msg) { $status.textContent = msg; }

// ─── Data ───────────────────────────────────────────────────────
async function fetchGroup(group) {
  const cacheKey = `${group.direction}|${group.state}`;
  try {
    const items = await invoke('list_transfers', { direction: group.direction, state: group.state });
    state.cache.set(cacheKey, items);
    return items;
  } catch (e) {
    toast(`로드 실패 (${group.label}): ${e}`, 'error');
    return [];
  }
}

async function refreshAll() {
  setStatus('새로고침 중…');
  for (const g of NAV_GROUPS) { await fetchGroup(g); }
  renderPinned();
  renderNav();
  renderView();
  setStatus('마지막 갱신: ' + new Date().toLocaleTimeString('ko-KR'));
}

// ─── Tree browser ───────────────────────────────────────────────
async function navigateTree(path) {
  setStatus(`탐색 중: ${path}`);
  try {
    const depth = (state.settings && state.settings.tree && state.settings.tree.max_depth) || 4;
    const root = await invoke('list_directory', { path, maxDepth: depth });
    state.treePath = root.path;
    $treePath.textContent = root.path;
    $tree.innerHTML = '';
    if (root.children.length === 0) {
      const ph = document.createElement('div');
      ph.className = 'tree-truncated';
      ph.textContent = '(빈 폴더)';
      $tree.appendChild(ph);
    } else {
      renderTreeChildren(root.children, 0, $tree);
      if (root.child_overflow > 0) {
        const ov = document.createElement('div');
        ov.className = 'tree-overflow';
        ov.textContent = `… 그 외 ${root.child_overflow}개 항목 (너무 많아 일부만 표시)`;
        $tree.appendChild(ov);
      }
    }
    setStatus('마지막 갱신: ' + new Date().toLocaleTimeString('ko-KR'));
  } catch (e) {
    setStatus('탐색 실패: ' + e);
    toast('탐색 실패: ' + e, 'error');
  }
}

function renderTreeChildren(children, depth, parent) {
  for (const node of children) {
    parent.appendChild(treeRowEl(node, depth));
    if (node.is_dir && node.children && node.children.length > 0) {
      renderTreeChildren(node.children, depth + 1, parent);
    } else if (node.is_dir && node.truncated) {
      const ph = document.createElement('div');
      ph.className = 'tree-truncated';
      ph.style.paddingLeft = ((depth + 1) * 20 + 14) + 'px';
      ph.textContent = '… 더 깊은 내용 — 폴더를 더블클릭하면 들어가요';
      parent.appendChild(ph);
    }
    if (node.is_dir && node.child_overflow > 0) {
      const ov = document.createElement('div');
      ov.className = 'tree-overflow';
      ov.style.paddingLeft = ((depth + 1) * 20 + 14) + 'px';
      ov.textContent = `… 그 외 ${node.child_overflow}개 더`;
      parent.appendChild(ov);
    }
  }
}

function treeRowEl(node, depth) {
  const row = document.createElement('div');
  row.className = 'tree-row' + (node.is_dir ? ' is-folder' : '');
  row.style.paddingLeft = (depth * 20 + 14) + 'px';
  const iconHtml = renderIconHtml(node.name, node.is_dir);
  const sizeHtml = node.is_dir
    ? ''
    : `<span class="tree-size">${escape(fmtBytes(node.size_bytes))}</span>`;
  row.innerHTML = `
    <span class="tree-icon">${iconHtml}</span>
    <span class="tree-name" title="${escape(node.path)}">${escape(node.name)}</span>
    ${sizeHtml}
    <button class="tree-send" title="MacBook으로 보내기">→ 전송</button>
  `;

  if (node.is_dir) {
    row.addEventListener('dblclick', (e) => {
      e.preventDefault();
      navigateTree(node.path);
    });
  } else {
    row.addEventListener('dblclick', () => {
      invoke('open_path', { path: node.path }).catch(err => toast('열기 실패: ' + err, 'error'));
    });
  }
  row.querySelector('.tree-send').addEventListener('click', (e) => {
    e.stopPropagation();
    openCategoryPicker([node.path]);
  });
  return row;
}

// Parse our naming convention: <YYYY-MM-DD>__<category>__<basename>__v<NN><.ext>
// Returns null if the name doesn't match (so we fall back to showing it raw).
function parseTransferName(filename) {
  const m = filename.match(/^(\d{4}-\d{2}-\d{2})__([a-z_]+)__(.+?)__v(\d+)(\.[^.]+)?$/);
  if (!m) return null;
  return {
    date: m[1],
    categoryKey: m[2],
    basename: m[3],
    version: m[4],
    ext: m[5] || '',
  };
}

// Display-friendly name: just basename + extension. Falls back to raw filename.
function prettyName(filename) {
  const p = parseTransferName(filename);
  if (!p) return filename;
  return p.basename + p.ext;
}

function iconForExt(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['jpg','jpeg','png','gif','webp','heic','bmp','svg'].includes(ext)) return '🖼';
  if (['mp4','mov','mkv','avi','webm'].includes(ext)) return '🎬';
  if (['mp3','wav','flac','aac','ogg'].includes(ext)) return '🎵';
  if (['zip','7z','rar','tar','gz'].includes(ext)) return '🗜';
  if (['pdf'].includes(ext)) return '📕';
  if (['doc','docx','hwp','hwpx'].includes(ext)) return '📘';
  if (['xls','xlsx','csv'].includes(ext)) return '📊';
  if (['ppt','pptx','key'].includes(ext)) return '📽';
  if (['md','txt','rtf'].includes(ext)) return '📝';
  if (['html','htm'].includes(ext)) return '🌐';
  if (['js','ts','tsx','jsx','rs','py','go','java','c','cpp','cs','rb','php','swift','kt','sh','ps1'].includes(ext)) return '⌨';
  return '📄';
}

function asciiForExt(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['pdf','doc','docx','txt','md','rtf','hwp','hwpx'].includes(ext)) return 'D';
  if (['xls','xlsx','csv'].includes(ext)) return 'S';
  if (['ppt','pptx','key'].includes(ext)) return 'P';
  if (['jpg','jpeg','png','gif','webp','heic','bmp','svg'].includes(ext)) return 'I';
  if (['mp4','mov','mkv','avi','webm'].includes(ext)) return 'V';
  if (['mp3','wav','flac','aac','ogg'].includes(ext)) return 'A';
  if (['zip','7z','rar','tar','gz'].includes(ext)) return 'Z';
  return 'F';
}

// ─── VSCode icon theme resolver ─────────────────────────────────
function joinPath(base, rel) {
  // Combine base + rel, normalize ./ and ../
  const combined = (base + '/' + rel).replace(/\\/g, '/');
  const parts = combined.split('/');
  const result = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') { if (result.length) result.pop(); continue; }
    result.push(p);
  }
  let joined = result.join('/');
  // Restore drive letter form for Windows (C:/foo → C:\foo) — caller renders via convertFileSrc anyway
  joined = joined.replace(/^([A-Za-z]:)\//, '$1\\').replace(/\//g, '\\');
  return joined;
}

function resolveThemeIconPath(filename, isDir) {
  if (!activeThemeDef) return null;
  const def = activeThemeDef;
  const lower = (filename || '').toLowerCase();

  let iconId = null;
  if (isDir) {
    if (def.folderNames && def.folderNames[lower]) iconId = def.folderNames[lower];
    else if (def.folder) iconId = def.folder;
  } else {
    if (def.fileNames && def.fileNames[lower]) {
      iconId = def.fileNames[lower];
    } else if (def.fileExtensions) {
      // Try progressively shorter extensions from leftmost dot
      let dot = lower.indexOf('.');
      while (dot !== -1 && dot < lower.length - 1) {
        const ext = lower.substring(dot + 1);
        if (def.fileExtensions[ext]) { iconId = def.fileExtensions[ext]; break; }
        dot = lower.indexOf('.', dot + 1);
      }
    }
    if (!iconId && def.file) iconId = def.file;
  }
  if (!iconId) return null;

  const defs = def.iconDefinitions || {};
  const entry = defs[iconId];
  if (!entry || !entry.iconPath) return null;

  return joinPath(activeThemeBaseDir || '', entry.iconPath);
}

function renderIconHtml(filename, isDir) {
  // Theme-aware: try VSCode theme first, then emoji/ascii fallback.
  if (activeThemeDef) {
    const p = resolveThemeIconPath(filename, isDir);
    if (p) {
      const url = window.__TAURI__.core.convertFileSrc(p);
      return `<img class="icon-img" src="${escape(url)}" alt="">`;
    }
  }
  const themeId = (state.settings && state.settings.appearance && state.settings.appearance.icon_theme) || 'default';
  if (isDir) {
    if (themeId === 'ascii') return '<span>D</span>';
    return '<span>📁</span>';
  }
  if (themeId === 'ascii') return '<span>' + escape(asciiForExt(filename)) + '</span>';
  return '<span>' + escape(iconForExt(filename)) + '</span>';
}

// Map our category key → list of folder names a VSCode icon theme likely defines.
// We try each candidate against folderNames; first hit wins; else fallback to default folder.
const CATEGORY_FOLDER_CANDIDATES = {
  documents:    ['documents', 'docs', 'documentation'],
  data:         ['data', 'database', 'db'],
  repos:        ['src', 'source', 'sources', 'repo', 'repository'],
  research:     ['research', 'papers', 'notes', 'docs'],
  env:          ['config', 'configs', 'environment', 'environments', 'env'],
  builds:       ['dist', 'build', 'builds', 'output', 'out'],
  assets:       ['assets', 'asset', 'resources', 'resource'],
  misc:         ['misc', 'other', 'others', 'sandbox'],
  unclassified: ['inbox', 'temp', 'tmp', 'staging', 'misc'],
};

function renderCategoryIconHtml(category) {
  if (activeThemeDef) {
    const candidates = CATEGORY_FOLDER_CANDIDATES[category.key] || [];
    for (const name of candidates) {
      const p = resolveThemeIconPath(name, true);
      if (p) {
        const url = window.__TAURI__.core.convertFileSrc(p);
        return `<img class="icon-img" src="${escape(url)}" alt="">`;
      }
    }
    // Fallback to theme's default folder icon
    const def = resolveThemeIconPath('', true);
    if (def) {
      const url = window.__TAURI__.core.convertFileSrc(def);
      return `<img class="icon-img" src="${escape(url)}" alt="">`;
    }
  }
  return `<span>${escape(category.emoji)}</span>`;
}

async function navigateTreeHome() {
  try {
    const home = await invoke('home_directory');
    await navigateTree(home);
  } catch (e) {
    toast('홈 폴더 못 찾음: ' + e, 'error');
  }
}
async function navigateTreeDesktop() {
  try {
    const d = await invoke('desktop_directory');
    await navigateTree(d);
  } catch (e) {
    toast('데스크탑 못 찾음: ' + e, 'error');
  }
}
async function navigateTreeUp() {
  if (!state.treePath) return;
  try {
    const parent = await invoke('parent_directory', { path: state.treePath });
    await navigateTree(parent);
  } catch (e) {
    toast('상위 없음: ' + e, 'error');
  }
}

function renderTreeShortcuts() {
  $treeShortcuts.innerHTML = '';
  const sc = (state.settings && state.settings.tree && state.settings.tree.shortcuts) || [];
  for (const s of sc) {
    const btn = document.createElement('button');
    btn.className = 'tree-shortcut-chip';
    btn.innerHTML = `<span>📁</span><span>${escape(s.name)}</span>`;
    btn.title = s.path;
    btn.addEventListener('click', () => navigateTree(s.path));
    $treeShortcuts.appendChild(btn);
  }
}

// ─── Settings ───────────────────────────────────────────────────
async function loadSettingsFromBackend() {
  try {
    state.settings = await invoke('load_settings');
  } catch (e) {
    console.error('load_settings failed:', e);
    state.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }
  // Validate fields exist
  state.settings = Object.assign({}, DEFAULT_SETTINGS, state.settings);
  state.settings.tree = Object.assign({}, DEFAULT_SETTINGS.tree, state.settings.tree || {});
  state.settings.network = Object.assign({}, DEFAULT_SETTINGS.network, state.settings.network || {});
  state.settings.appearance = Object.assign({}, DEFAULT_SETTINGS.appearance, state.settings.appearance || {});
  renderTreeShortcuts();
}

async function persistSettings() {
  try {
    await invoke('save_settings', { settings: state.settings });
  } catch (e) {
    console.error('save_settings failed:', e);
    toast('설정 저장 실패: ' + e, 'error');
  }
}

function renderSettings() {
  // Depth
  $depthValue.textContent = state.settings.tree.max_depth;
  // Shortcuts
  $shortcutsList.innerHTML = '';
  const sc = state.settings.tree.shortcuts || [];
  if (sc.length === 0) {
    const ph = document.createElement('div');
    ph.className = 'settings-hint';
    ph.textContent = '아직 추가한 단축 폴더가 없어요.';
    $shortcutsList.appendChild(ph);
  } else {
    sc.forEach((s, idx) => {
      const item = document.createElement('div');
      item.className = 'shortcut-item';
      item.innerHTML = `
        <span class="shortcut-item-name">📁 ${escape(s.name)}</span>
        <span class="shortcut-item-path" title="${escape(s.path)}">${escape(s.path)}</span>
        <button class="shortcut-remove">제거</button>
      `;
      item.querySelector('.shortcut-remove').addEventListener('click', async () => {
        state.settings.tree.shortcuts.splice(idx, 1);
        await persistSettings();
        renderSettings();
        renderTreeShortcuts();
      });
      $shortcutsList.appendChild(item);
    });
  }
  // Network
  $remoteHost.value = state.settings.network.remote_host || '';
  // Theme — render radio list (built-ins + installed)
  renderThemeOptions();
  // Policy & profiles
  renderPolicyAndProfiles();
}

async function renderPolicyAndProfiles() {
  // Network mode radios
  try {
    cachedPolicy = await invoke('load_policy');
  } catch (e) {
    console.warn('load_policy:', e);
    cachedPolicy = cachedPolicy || { network_mode: 'closed' };
  }
  const mode = (cachedPolicy && cachedPolicy.network_mode) || 'closed';
  document.querySelectorAll('input[name="netmode"]').forEach(r => {
    r.checked = (r.value === mode);
  });

  // Language presets info
  try {
    const presets = await invoke('list_language_presets');
    const $info = document.getElementById('presets-info');
    if (presets.length === 0) {
      $info.innerHTML = '<div class="result-row"><span class="result-key">상태</span><span class="result-val">프리셋 없음</span></div>';
    } else {
      const rows = presets.map(p =>
        `<div class="result-row"><span class="result-key">${escape(p.language)}</span><span class="result-val">${p.rule_count}개 규칙</span></div>`
      ).join('');
      $info.innerHTML = `<div class="result-row"><span class="result-key">로드됨</span><span class="result-val">${presets.length}개 프리셋</span></div>${rows}`;
    }
  } catch (e) {
    document.getElementById('presets-info').innerHTML = `<div class="result-row"><span>에러: ${escape(String(e))}</span></div>`;
  }

  // Profiles list
  await refreshProfilesList();
}

async function refreshProfilesList() {
  const $list = document.getElementById('profiles-list');
  try {
    const profiles = await invoke('list_profiles');
    if (profiles.length === 0) {
      $list.innerHTML = '<div class="result-row"><span class="result-key">게시된 프로필</span><span class="result-val">없음</span></div>';
      return;
    }
    const rows = profiles.map(p => {
      const host = p.host || p.host_id || '(unknown)';
      const os = p.os || '?';
      const published = p.published_at || '?';
      return `<div class="result-row"><span class="result-key">${escape(host)} <span style="opacity:0.6">(${escape(os)})</span></span><span class="result-val">${escape(published)}</span></div>`;
    }).join('');
    $list.innerHTML = rows;
  } catch (e) {
    $list.innerHTML = `<div class="result-row"><span>에러: ${escape(String(e))}</span></div>`;
  }
}

async function changeNetworkMode(val) {
  if (!cachedPolicy) cachedPolicy = {};
  cachedPolicy.network_mode = val;
  try {
    await invoke('save_policy', { policy: cachedPolicy });
    toast(`네트워크 모드: ${val}`, 'success');
  } catch (e) {
    toast('policy 저장 실패: ' + e, 'error');
  }
}

async function publishMyProfile() {
  const btn = document.getElementById('publish-profile-btn');
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = '게시 중…';
  try {
    const path = await invoke('publish_profile');
    toast('프로필 게시 완료', 'success');
    await refreshProfilesList();
  } catch (e) {
    toast('게시 실패: ' + e, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

function renderThemeOptions() {
  $themeOptions.innerHTML = '';
  const themeKey = state.settings.appearance.icon_theme || 'default';
  const builtIn = [
    { id: 'default', name: '기본 (이모지)', meta: '' },
    { id: 'ascii',   name: 'ASCII (단순 문자)', meta: '' },
  ];
  const installed = state.settings.appearance.icon_themes || [];

  const all = builtIn.concat(installed.map(t => ({
    id: t.id, name: t.name, meta: `${t.icon_count}개 아이콘`, removable: true,
  })));

  for (const opt of all) {
    const label = document.createElement('label');
    label.className = 'theme-opt';
    label.innerHTML = `
      <input type="radio" name="theme" value="${escape(opt.id)}" ${opt.id === themeKey ? 'checked' : ''}>
      <span class="theme-opt-name">${escape(opt.name)}</span>
      ${opt.meta ? `<span class="theme-opt-meta">${escape(opt.meta)}</span>` : ''}
      ${opt.removable ? `<button class="theme-opt-remove" data-remove="${escape(opt.id)}">제거</button>` : ''}
    `;
    const radio = label.querySelector('input[type="radio"]');
    radio.addEventListener('change', () => changeTheme(opt.id));
    const rm = label.querySelector('.theme-opt-remove');
    if (rm) {
      rm.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.confirm(`'${opt.name}' 테마를 제거할까요?`)) {
          removeIconTheme(opt.id);
        }
      });
    }
    $themeOptions.appendChild(label);
  }
}

async function changeDepth(delta) {
  const cur = state.settings.tree.max_depth;
  const next = Math.max(1, Math.min(10, cur + delta));
  if (next === cur) return;
  state.settings.tree.max_depth = next;
  await persistSettings();
  renderSettings();
  // Re-render tree at current path with new depth, if tree view is active
  if (state.treePath) navigateTree(state.treePath);
}

async function addShortcut() {
  let folder;
  try {
    const dialog = window.__TAURI__ && window.__TAURI__.dialog;
    if (!dialog || typeof dialog.open !== 'function') throw 'dialog plugin missing';
    folder = await dialog.open({ multiple: false, directory: true, title: '단축 폴더 선택' });
  } catch (e) {
    toast('폴더 선택 실패: ' + e, 'error');
    return;
  }
  if (!folder) return;
  const fallbackName = folder.split(/[\\/]/).filter(Boolean).pop() || folder;
  const name = window.prompt('단축 이름:', fallbackName);
  if (!name) return;
  state.settings.tree.shortcuts.push({ name: name.trim(), path: folder });
  await persistSettings();
  renderSettings();
  renderTreeShortcuts();
}

async function installIconTheme() {
  try {
    const dialog = window.__TAURI__ && window.__TAURI__.dialog;
    if (!dialog) { toast('dialog 플러그인 없음', 'error'); return; }
    const folder = await dialog.open({ multiple: false, directory: true, title: 'VSCode 아이콘 테마 폴더 선택' });
    if (!folder) return;
    setStatus(`테마 검증 중: ${folder}`);
    const theme = await invoke('install_icon_theme', { folder });
    // Avoid duplicates: replace by id
    const list = state.settings.appearance.icon_themes || [];
    const existing = list.findIndex(t => t.id === theme.id);
    if (existing >= 0) list.splice(existing, 1, theme);
    else list.push(theme);
    state.settings.appearance.icon_themes = list;
    state.settings.appearance.icon_theme = theme.id;
    await persistSettings();
    await applyActiveTheme();
    renderSettings();
    refreshIconsInView();
    toast(`'${theme.name}' 테마 추가됨 (${theme.icon_count}개 아이콘)`, 'success');
    setStatus('마지막 갱신: ' + new Date().toLocaleTimeString('ko-KR'));
  } catch (e) {
    setStatus('테마 설치 실패: ' + e);
    toast('테마 추가 실패: ' + e, 'error');
  }
}

async function removeIconTheme(themeId) {
  const list = state.settings.appearance.icon_themes || [];
  const idx = list.findIndex(t => t.id === themeId);
  if (idx < 0) return;
  list.splice(idx, 1);
  if (state.settings.appearance.icon_theme === themeId) {
    state.settings.appearance.icon_theme = 'default';
    activeThemeDef = null;
    activeThemeBaseDir = null;
  }
  state.settings.appearance.icon_themes = list;
  await persistSettings();
  renderSettings();
  refreshIconsInView();
}

async function changeTheme(value) {
  state.settings.appearance.icon_theme = value;
  await persistSettings();
  await applyActiveTheme();
  refreshIconsInView();
}

async function applyActiveTheme() {
  const id = state.settings.appearance.icon_theme;
  if (id === 'default' || id === 'ascii') {
    activeThemeDef = null;
    activeThemeBaseDir = null;
    return;
  }
  const themes = state.settings.appearance.icon_themes || [];
  const t = themes.find(x => x.id === id);
  if (!t) {
    activeThemeDef = null;
    activeThemeBaseDir = null;
    return;
  }
  try {
    const payload = await invoke('load_icon_theme_def', { themeJsonPath: t.theme_json_path });
    activeThemeDef = payload.definition;
    activeThemeBaseDir = payload.base_dir;
  } catch (e) {
    console.error('load_icon_theme_def failed:', e);
    activeThemeDef = null;
    activeThemeBaseDir = null;
    toast('테마 로드 실패: ' + e, 'error');
  }
}

// ─── Notes (shared notepad, Evernote-style) ─────────────────────
async function loadNotesList() {
  try {
    state.notes.list = await invoke('list_notes');
    renderNotesList();
    if (!state.notes.current && state.notes.list.length > 0) {
      // Auto-select the most recently updated note on first entry
      await selectNote(state.notes.list[0].id);
    } else if (!state.notes.current) {
      renderNoteEditor();
    }
  } catch (e) {
    toast('메모 로드 실패: ' + e, 'error');
  }
}

function renderNotesList() {
  $notesList.innerHTML = '';
  if (state.notes.list.length === 0) {
    const ph = document.createElement('div');
    ph.style.cssText = 'padding:18px;text-align:center;font-size:11.5px;color:var(--text-sec)';
    ph.textContent = '메모가 없어요. 우측 상단 ＋ 새 메모로 시작.';
    $notesList.appendChild(ph);
    return;
  }
  for (const n of state.notes.list) {
    const el = document.createElement('div');
    el.className = 'note-list-item';
    if (n.id === state.notes.selectedId) el.classList.add('active');
    const title = n.title && n.title.trim() ? n.title : '(제목 없음)';
    const snippet = n.snippet || '';
    const host = n.updated_by && n.updated_by.host ? n.updated_by.host : '?';
    el.innerHTML = `
      <div class="note-list-item-title">${escape(title)}</div>
      <div class="note-list-item-snippet">${escape(snippet)}</div>
      <div class="note-list-item-meta">${escape(fmtRelative(n.updated_at))} · ${escape(host)}</div>
    `;
    el.addEventListener('click', () => selectNote(n.id));
    $notesList.appendChild(el);
  }
}

async function selectNote(id) {
  state.notes.selectedId = id;
  try {
    state.notes.current = await invoke('get_note', { id });
  } catch (e) {
    toast('메모 로드 실패: ' + e, 'error');
    state.notes.current = null;
  }
  renderNotesList();
  renderNoteEditor();
}

function renderNoteEditor() {
  const has = !!state.notes.current;
  $notesEmpty.classList.toggle('hidden', has);
  $notesEditor.classList.toggle('hidden', !has);
  if (!has) return;
  const n = state.notes.current;
  $noteTitle.value = n.title || '';
  $noteBody.value = n.body || '';
  const host = n.updated_by && n.updated_by.host ? n.updated_by.host : '?';
  const os = n.updated_by && n.updated_by.os ? n.updated_by.os : '?';
  $noteMeta.textContent = `${fmtFull(n.updated_at || n.created_at)} · ${host} (${os})`;
  $noteSaveStatus.textContent = '';
}

function onNoteEdited() {
  if (!state.notes.current) return;
  state.notes.current.title = $noteTitle.value;
  state.notes.current.body = $noteBody.value;
  $noteSaveStatus.textContent = '편집 중…';
  clearTimeout(state.notes.saveTimer);
  state.notes.saveTimer = setTimeout(saveCurrentNote, 600);
}

async function saveCurrentNote() {
  if (!state.notes.current) return;
  try {
    const updated = await invoke('save_note', {
      id: state.notes.current.id || null,
      title: state.notes.current.title || '',
      body: state.notes.current.body || '',
    });
    state.notes.current = updated;
    state.notes.selectedId = updated.id;
    $noteSaveStatus.textContent = '저장됨 · ' + fmtRelative(updated.updated_at);
    await loadNotesList();
  } catch (e) {
    $noteSaveStatus.textContent = '저장 실패: ' + e;
  }
}

function newNote() {
  state.notes.selectedId = null;
  state.notes.current = {
    id: '',
    title: '',
    body: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    updated_by: { host: 'DESKTOP-Q0S7LSQ', os: 'windows' },
  };
  renderNotesList();
  renderNoteEditor();
  $noteTitle.focus();
}

async function deleteCurrentNote() {
  if (!state.notes.current) return;
  if (!state.notes.current.id) {
    // Unsaved new note — just discard
    state.notes.current = null;
    renderNotesList();
    renderNoteEditor();
    return;
  }
  if (!window.confirm('이 메모를 삭제할까요?')) return;
  try {
    await invoke('delete_note', { id: state.notes.current.id });
    state.notes.current = null;
    state.notes.selectedId = null;
    await loadNotesList();
    renderNoteEditor();
    toast('메모 삭제됨', 'success');
  } catch (e) { toast('삭제 실패: ' + e, 'error'); }
}

// ─── Shared clipboard ───────────────────────────────────────────
async function refreshClipboard() {
  try {
    state.clipboard.current = await invoke('read_shared_clipboard');
    state.clipboard.history = await invoke('list_clipboard_history', { limit: 20 });
    renderClipboardPanel();
  } catch (e) {
    console.warn('clipboard refresh:', e);
  }
}

function renderClipboardPanel() {
  const c = state.clipboard.current;
  if (!c || c.empty) {
    $clipCurrentText.value = '';
    $clipCurrentMeta.textContent = '(공유 클립보드 비어있음)';
  } else {
    $clipCurrentText.value = c.content || '';
    const from = c.from && c.from.host ? `${c.from.host} (${c.from.os || '?'})` : '?';
    $clipCurrentMeta.textContent = `From: ${from}  ·  ${fmtFull(c.created_at)}`;
  }
  $clipHistory.innerHTML = '';
  if (state.clipboard.history.length === 0) {
    const ph = document.createElement('div');
    ph.style.cssText = 'padding:14px;text-align:center;font-size:11.5px;color:var(--text-sec)';
    ph.textContent = '아직 기록이 없어요.';
    $clipHistory.appendChild(ph);
    return;
  }
  for (const h of state.clipboard.history) {
    const el = document.createElement('div');
    el.className = 'clip-history-item';
    const flat = (h.content || '').replace(/\s+/g, ' ');
    const from = h.from && h.from.host ? h.from.host : '?';
    el.innerHTML = `
      <div class="clip-history-item-text" title="${escape(h.content || '')}">${escape(flat)}</div>
      <div class="clip-history-item-meta">${escape(from)} · ${escape(fmtRelative(h.created_at))}</div>
      <button class="clip-history-item-restore" title="이 항목으로 공유 클립보드 복원">↶ 복원</button>
    `;
    el.querySelector('.clip-history-item-restore').addEventListener('click', async () => {
      try {
        await invoke('write_shared_clipboard', { content: h.content || '' });
        await refreshClipboard();
        toast('히스토리 항목으로 복원됨', 'success');
      } catch (e) { toast('복원 실패: ' + e, 'error'); }
    });
    $clipHistory.appendChild(el);
  }
}

async function pushOsClipboardToShare() {
  try {
    const clip = window.__TAURI__.clipboardManager;
    if (!clip) { toast('clipboard plugin 없음', 'error'); return; }
    const text = await clip.readText();
    if (!text || !text.trim()) { toast('OS 클립보드 비어있음', 'error'); return; }
    await invoke('write_shared_clipboard', { content: text });
    await refreshClipboard();
    toast('공유로 보냈어요', 'success');
  } catch (e) { toast('실패: ' + e, 'error'); }
}

async function pullShareToOsClipboard() {
  try {
    const c = state.clipboard.current;
    if (!c || c.empty || !c.content) { toast('공유 클립보드가 비어있어요', 'error'); return; }
    const clip = window.__TAURI__.clipboardManager;
    if (!clip) { toast('clipboard plugin 없음', 'error'); return; }
    await clip.writeText(c.content);
    toast('OS 클립보드에 복사됨', 'success');
  } catch (e) { toast('실패: ' + e, 'error'); }
}

function startClipboardPolling() {
  if (state.clipboard.pollTimer) return;
  state.clipboard.pollTimer = setInterval(refreshClipboard, 3000);
}
function stopClipboardPolling() {
  if (state.clipboard.pollTimer) {
    clearInterval(state.clipboard.pollTimer);
    state.clipboard.pollTimer = null;
  }
}

function refreshIconsInView() {
  renderPinned();
  renderNav();
  renderTools();
  renderItems();
  if (state.treePath) {
    navigateTree(state.treePath).catch(err => console.warn('tree refresh:', err));
  }
}

async function changeHost() {
  state.settings.network.remote_host = $remoteHost.value.trim() || '192.168.50.2';
  await persistSettings();
}

async function runConnectionCheck() {
  $connResult.classList.remove('hidden', 'success', 'error');
  $connResult.innerHTML = '<div class="result-row"><span>확인 중…</span></div>';
  try {
    const host = state.settings.network.remote_host;
    const r = await invoke('check_connection', { host, port: 445 });
    const okClass = r.tcp_reachable ? 'success' : 'error';
    $connResult.classList.add(okClass);
    const pingTxt = r.ping_reachable
      ? (r.ping_latency_ms != null ? `${r.ping_latency_ms}ms` : '도달')
      : '실패';
    const tcpTxt = r.tcp_reachable ? `${r.tcp_latency_ms}ms` : '실패';
    $connResult.innerHTML = `
      <div class="result-row"><span class="result-key">대상</span><span class="result-val">${escape(r.host)}:${r.port}</span></div>
      <div class="result-row"><span class="result-key">TCP 445</span><span class="result-val">${escape(tcpTxt)}</span></div>
      <div class="result-row"><span class="result-key">ICMP ping</span><span class="result-val">${escape(pingTxt)}</span></div>
    `;
  } catch (e) {
    $connResult.classList.add('error');
    $connResult.innerHTML = `<div class="result-row"><span>에러: ${escape(String(e))}</span></div>`;
  }
}

async function runSpeedTest() {
  $speedTest.disabled = true;
  $speedTest.textContent = '측정 중…';
  $speedResult.classList.remove('hidden', 'success', 'error');
  $speedResult.innerHTML = '<div class="result-row"><span>100MB 쓰기/읽기 측정 중…</span></div>';
  try {
    const r = await invoke('speed_test_local', { bytes: 100 * 1024 * 1024 });
    $speedResult.classList.add('success');
    $speedResult.innerHTML = `
      <div class="result-row"><span class="result-key">데이터 크기</span><span class="result-val">${fmtBytes(r.bytes)}</span></div>
      <div class="result-row"><span class="result-key">쓰기 속도</span><span class="result-val">${r.write_mb_per_sec.toFixed(1)} MB/s · ${r.write_ms} ms</span></div>
      <div class="result-row"><span class="result-key">읽기 속도</span><span class="result-val">${r.read_mb_per_sec.toFixed(1)} MB/s · ${r.read_ms} ms</span></div>
      <div class="result-row"><span class="result-key" style="font-size:10px">참고</span><span class="result-val" style="font-size:10px;text-align:right">셰어 디스크(P31 NTFS) 로컬 I/O. 실제 SMB 10GbE 대역폭은 Mac 측에서 측정.</span></div>
    `;
  } catch (e) {
    $speedResult.classList.add('error');
    $speedResult.innerHTML = `<div class="result-row"><span>실패: ${escape(String(e))}</span></div>`;
  } finally {
    $speedTest.disabled = false;
    $speedTest.textContent = '⏱ 속도 측정 (100MB)';
  }
}

// ─── Rendering ──────────────────────────────────────────────────
function renderPinned() {
  $navPinned.innerHTML = '';
  // Top pinned: only 빠른 전송 (primary entry point)
  const el = navItemEl('빠른 전송', svgIcon('rocket'), '', () => {
    state.view = VIEW_TREE;
    renderPinned(); renderNav(); renderTools(); renderView();
  });
  if (state.view === VIEW_TREE) el.classList.add('active');
  $navPinned.appendChild(el);
}

function renderTools() {
  $navTools.innerHTML = '';
  const tools = [
    { id: VIEW_NOTES,     iconName: 'notebook-pen', label: '메모' },
    { id: VIEW_CLIPBOARD, iconName: 'clipboard',    label: '클립보드' },
  ];
  for (const t of tools) {
    const el = navItemEl(t.label, svgIcon(t.iconName), '', () => {
      state.view = t.id;
      renderPinned(); renderNav(); renderTools(); renderView();
    });
    if (state.view === t.id) el.classList.add('active');
    $navTools.appendChild(el);
  }
}

function renderNav() {
  $nav.innerHTML = '';
  for (const group of NAV_GROUPS) {
    const items = state.cache.get(`${group.direction}|${group.state}`) || [];
    const counts = {};
    for (const it of items) {
      counts[it.category_key] = (counts[it.category_key] || 0) + 1;
    }
    const allCount = items.length;

    const groupEl = document.createElement('div');
    groupEl.className = 'nav-group';
    groupEl.innerHTML = `<div class="nav-group-header">${svgIcon(group.iconName)}<span>${escape(group.title)}</span></div>`;

    // "전체" pseudo-item
    const allItem = navItemEl('전체', svgIcon('asterisk'), allCount, () => {
      state.view = VIEW_ITEMS;
      state.selection = { group: group.id, categoryKey: null };
      renderPinned(); renderNav(); renderTools(); renderView();
    });
    if (state.view === VIEW_ITEMS && state.selection.group === group.id && state.selection.categoryKey == null) {
      allItem.classList.add('active');
    }
    groupEl.appendChild(allItem);

    for (const cat of CATEGORIES) {
      const n = counts[cat.key] || 0;
      if (n === 0) continue;
      const el = navItemEl(cat.label, renderCategoryIconHtml(cat), n, () => {
        state.view = VIEW_ITEMS;
        state.selection = { group: group.id, categoryKey: cat.key };
        renderPinned(); renderNav(); renderTools(); renderView();
      });
      if (state.view === VIEW_ITEMS && state.selection.group === group.id && state.selection.categoryKey === cat.key) {
        el.classList.add('active');
      }
      groupEl.appendChild(el);
    }
    $nav.appendChild(groupEl);
  }
}

function renderView() {
  $panelItems.classList.add('hidden');
  $panelTree.classList.add('hidden');
  $panelSettings.classList.add('hidden');
  $panelNotes.classList.add('hidden');
  $panelClipboard.classList.add('hidden');
  $settingsBtn.classList.remove('active');

  // Stop clipboard polling when leaving its view
  if (state.view !== VIEW_CLIPBOARD) stopClipboardPolling();

  if (state.view === VIEW_TREE) {
    $panelTree.classList.remove('hidden');
    if (!state.treePath) { navigateTreeHome(); }
  } else if (state.view === VIEW_NOTES) {
    $panelNotes.classList.remove('hidden');
    loadNotesList();
  } else if (state.view === VIEW_CLIPBOARD) {
    $panelClipboard.classList.remove('hidden');
    refreshClipboard();
    startClipboardPolling();
  } else if (state.view === VIEW_SETTINGS) {
    $panelSettings.classList.remove('hidden');
    $settingsBtn.classList.add('active');
    renderSettings();
  } else {
    $panelItems.classList.remove('hidden');
    renderItems();
  }
}

function navItemEl(label, icon, count, onClick) {
  const el = document.createElement('div');
  el.className = 'nav-item';
  el.style.position = 'relative';
  // `icon` can be either an emoji/text string or a pre-rendered HTML fragment (<img …>).
  const iconHtml = (typeof icon === 'string' && icon.includes('<')) ? icon : `<span>${escape(icon || '')}</span>`;
  el.innerHTML = `
    <span class="nav-item-emoji">${iconHtml}</span>
    <span class="nav-item-label">${escape(label)}</span>
    <span class="nav-item-count">${count}</span>
  `;
  el.addEventListener('click', onClick);
  return el;
}

function currentGroup() {
  return NAV_GROUPS.find(g => g.id === state.selection.group);
}

function renderItems() {
  const group = currentGroup();
  if (!group) return;
  const items = state.cache.get(`${group.direction}|${group.state}`) || [];
  const filtered = state.selection.categoryKey
    ? items.filter(it => it.category_key === state.selection.categoryKey)
    : items;

  // Header
  if (state.selection.categoryKey) {
    const cat = CATEGORIES.find(c => c.key === state.selection.categoryKey);
    $title.textContent = `${cat.emoji}  ${cat.label}`;
  } else {
    $title.textContent = group.label;
  }
  $subtitle.textContent = `${filtered.length}개 항목 · ${group.direction === 'mac_to_windows' ? 'MacBook에서 받음' : 'MacBook으로 보냄'}`;

  // List
  $items.innerHTML = '';
  if (filtered.length === 0) {
    $empty.classList.remove('hidden');
    $items.classList.add('hidden');
    $revealBtn.classList.add('hidden');
    return;
  }
  $empty.classList.add('hidden');
  $items.classList.remove('hidden');
  $revealBtn.classList.remove('hidden');

  for (const it of filtered) {
    const li = document.createElement('li');
    li.className = 'item';
    const parsed = parseTransferName(it.name);
    const displayName = parsed ? (parsed.basename + parsed.ext) : it.name;
    // For themed icons, use the parsed basename+ext so VSCode resolver can match the real extension
    const iconName = parsed ? (parsed.basename + parsed.ext) : it.name;
    const iconHtml = renderIconHtml(iconName, it.is_dir);
    const metaParts = [
      `${it.category_emoji} ${it.category_label}`,
      fmtBytes(it.size_bytes),
    ];
    if (parsed) {
      metaParts.push(`v${parsed.version}`);
      metaParts.push(parsed.date);
    }
    metaParts.push(fmtRelative(it.modified_iso));

    li.innerHTML = `
      <div class="item-icon">${iconHtml}</div>
      <div class="item-body">
        <div class="item-name" title="${escape(it.name)}">${escape(displayName)}</div>
        <div class="item-meta">${metaParts.map(escape).join(' · ')}</div>
      </div>
      <div class="item-tail">${escape(fmtFull(it.modified_iso))}</div>
    `;
    li.addEventListener('click', () => openDetails(it));
    li.addEventListener('dblclick', () => invoke('open_path', { path: it.path }).catch(e => toast(e, 'error')));
    $items.appendChild(li);
  }
}

// ─── Details modal ──────────────────────────────────────────────
function openDetails(it) {
  const parsed = parseTransferName(it.name);
  const displayName = parsed ? (parsed.basename + parsed.ext) : it.name;
  $detailsTitle.textContent = displayName;
  const versionRow = parsed
    ? `<div class="detail-row"><div class="detail-label">버전</div><div class="detail-value">v${escape(parsed.version)} · 전송일 ${escape(parsed.date)}</div></div>`
    : '';
  $detailsBody.innerHTML = `
    <div class="detail-row"><div class="detail-label">카테고리</div><div class="detail-value">${escape(it.category_emoji)} ${escape(it.category_label)}</div></div>
    <div class="detail-row"><div class="detail-label">방향</div><div class="detail-value">${it.direction === 'mac_to_windows' ? 'MacBook → Windows' : 'Windows → MacBook'}</div></div>
    <div class="detail-row"><div class="detail-label">상태</div><div class="detail-value">${escape(it.state)}</div></div>
    <div class="detail-row"><div class="detail-label">크기</div><div class="detail-value">${fmtBytes(it.size_bytes)}</div></div>
    ${versionRow}
    <div class="detail-row"><div class="detail-label">수정 시각</div><div class="detail-value">${escape(fmtFull(it.modified_iso))}</div></div>
    <div class="detail-row"><div class="detail-label">저장 파일명</div><div class="detail-value detail-mono">${escape(it.name)}</div></div>
    <div class="detail-row"><div class="detail-label">전체 경로</div><div class="detail-value detail-mono">${escape(it.path)}</div></div>
  `;
  $detailsOpen.onclick = () => invoke('open_path', { path: it.path }).catch(e => toast(e, 'error'));
  $detailsReveal.onclick = () => invoke('reveal_in_explorer', { path: it.path }).catch(e => toast(e, 'error'));
  $details.classList.remove('hidden');
}

// ─── Drag-drop ──────────────────────────────────────────────────
async function setupDragDrop() {
  if (!webview || typeof webview.onDragDropEvent !== 'function') {
    console.warn('webview.onDragDropEvent unavailable — drag-drop disabled');
    return;
  }
  await webview.onDragDropEvent((event) => {
    const p = event.payload;
    if (!p) return;
    if (p.type === 'enter') {
      $dropOverlay.classList.remove('hidden');
      if ($dropZone) $dropZone.classList.add('dragging');
    } else if (p.type === 'leave') {
      $dropOverlay.classList.add('hidden');
      if ($dropZone) $dropZone.classList.remove('dragging');
    } else if (p.type === 'drop') {
      $dropOverlay.classList.add('hidden');
      if ($dropZone) $dropZone.classList.remove('dragging');
      handleDroppedPaths(p.paths || []);
    }
  });
}

function handleDroppedPaths(paths) {
  if (paths.length === 0) return;
  if (paths.length === 1) {
    openCategoryPicker(paths);
  } else {
    sendBatch(paths, 'unclassified');
  }
}

async function sendBatch(paths, category) {
  const cat = CATEGORIES.find(c => c.key === category);
  const label = cat ? `${cat.emoji} ${cat.label}` : category;
  setStatus(`${paths.length}개 항목을 ${label}으로 전송 중…`);
  let ok = 0;
  const errors = [];
  for (const p of paths) {
    try {
      await invoke('send_path', { sourcePath: p, category });
      ok++;
    } catch (e) {
      errors.push(`${p}: ${e}`);
    }
  }
  if (errors.length === 0) {
    toast(`${label}으로 ${ok}개 항목 전송 완료`, 'success');
  } else {
    toast(`${ok}개 성공 · ${errors.length}개 실패 (${errors[0]})`, 'error');
    console.error('batch send errors:', errors);
  }
  setStatus('마지막 갱신: ' + new Date().toLocaleTimeString('ko-KR'));
  await refreshAll();
}

async function pickFilesAndSend() {
  const dialog = window.__TAURI__ && window.__TAURI__.dialog;
  if (!dialog || typeof dialog.open !== 'function') {
    toast('파일 선택 다이얼로그 사용 불가', 'error');
    return;
  }
  try {
    const selected = await dialog.open({ multiple: true, directory: false, title: '보낼 파일 선택' });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    handleDroppedPaths(paths);
  } catch (e) {
    toast('파일 선택 실패: ' + e, 'error');
  }
}

async function openCategoryPicker(paths) {
  state.pendingDrop = paths;
  const first = paths[0];
  const restNote = paths.length > 1 ? ` 외 ${paths.length - 1}개` : '';
  $catPickerTarget.innerHTML = `
    <div class="ti">${paths.length > 1 ? '🗂' : '📄'}</div>
    <div>
      <div class="tn">${escape(first.split(/[\\/]/).pop())}${escape(restNote)}</div>
      <div class="tm">${escape(first)}</div>
    </div>
  `;
  $catPickerSelect.innerHTML = '';
  for (const c of CATEGORIES) {
    const opt = document.createElement('option');
    opt.value = c.key;
    opt.textContent = `${c.emoji}   ${c.label}`;
    $catPickerSelect.appendChild(opt);
  }
  $catPickerSelect.value = 'documents';
  $catPicker.classList.remove('hidden');
}

async function submitDrop() {
  if (!state.pendingDrop || state.pendingDrop.length === 0) return;
  const category = $catPickerSelect.value;
  $catPickerSend.disabled = true;
  $catPickerSend.textContent = '보내는 중…';
  let okCount = 0;
  let errors = [];
  for (const p of state.pendingDrop) {
    try {
      await invoke('send_path', { sourcePath: p, category });
      okCount++;
    } catch (e) {
      errors.push(`${p}: ${e}`);
    }
  }
  $catPickerSend.disabled = false;
  $catPickerSend.textContent = 'MacBook으로 전송';
  $catPicker.classList.add('hidden');
  state.pendingDrop = null;

  if (okCount > 0) {
    toast(`MacBook으로 ${okCount}개 항목 전송 완료`, 'success');
  }
  if (errors.length > 0) {
    toast(`전송 실패 ${errors.length}건: ${errors[0]}`, 'error');
    console.error(errors);
  }
  await refreshAll();
}

// ─── Wiring ─────────────────────────────────────────────────────
function setupModals() {
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-close');
      document.getElementById(id).classList.add('hidden');
    });
  });
  // backdrop click
  document.querySelectorAll('.modal-backdrop').forEach(bd => {
    bd.addEventListener('click', () => bd.closest('.modal').classList.add('hidden'));
  });
  // ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal:not(.hidden)').forEach(m => m.classList.add('hidden'));
    }
  });
  $catPickerSend.addEventListener('click', submitDrop);
}

function setupHeaderActions() {
  $revealBtn.addEventListener('click', async () => {
    const group = currentGroup();
    if (!group) return;
    const cat = state.selection.categoryKey
      ? CATEGORIES.find(c => c.key === state.selection.categoryKey)
      : null;
    try {
      const root = await invoke('share_root');
      const dirName = group.direction === 'mac_to_windows' ? '10_Mac_to_Windows' : '20_Windows_to_Mac';
      const stateName = group.state === 'received' ? '90_Received' : '20_Ready';
      const path = cat
        ? `${root}\\10_Exchange\\${dirName}\\${stateName}\\${cat.folder}`
        : `${root}\\10_Exchange\\${dirName}\\${stateName}`;
      await invoke('open_path', { path });
    } catch (e) { toast(e, 'error'); }
  });
}

document.getElementById('refresh-btn').addEventListener('click', refreshAll);
$treeUp.addEventListener('click', navigateTreeUp);
$treeHome.addEventListener('click', navigateTreeHome);
$treeDesktop.addEventListener('click', navigateTreeDesktop);
$dropZone.addEventListener('click', pickFilesAndSend);
$dropZonePick.addEventListener('click', (e) => { e.stopPropagation(); pickFilesAndSend(); });
$settingsBtn.addEventListener('click', () => {
  state.view = (state.view === VIEW_SETTINGS) ? VIEW_TREE : VIEW_SETTINGS;
  renderPinned(); renderNav(); renderView();
});
$depthDec.addEventListener('click', () => changeDepth(-1));
$depthInc.addEventListener('click', () => changeDepth(+1));
$addShortcut.addEventListener('click', addShortcut);
$remoteHost.addEventListener('change', changeHost);
$checkConn.addEventListener('click', runConnectionCheck);
$speedTest.addEventListener('click', runSpeedTest);
$installTheme.addEventListener('click', installIconTheme);
document.querySelectorAll('input[name="netmode"]').forEach(r => {
  r.addEventListener('change', e => changeNetworkMode(e.target.value));
});
document.getElementById('publish-profile-btn').addEventListener('click', publishMyProfile);
document.getElementById('refresh-profiles-btn').addEventListener('click', refreshProfilesList);

// Notes wiring
$newNoteBtn.addEventListener('click', newNote);
$noteTitle.addEventListener('input', onNoteEdited);
$noteBody.addEventListener('input', onNoteEdited);
$noteDelete.addEventListener('click', deleteCurrentNote);

// Clipboard wiring
$clipPush.addEventListener('click', pushOsClipboardToShare);
$clipPull.addEventListener('click', pullShareToOsClipboard);
$clipRefresh.addEventListener('click', refreshClipboard);

setupModals();
setupHeaderActions();

// Paint static brand + sidebar action icons once.
document.getElementById('brand-icon').innerHTML = svgIcon('arrow-left-right');
document.getElementById('refresh-icon').innerHTML = svgIcon('refresh-cw');
document.getElementById('settings-icon').innerHTML = svgIcon('settings');

(async () => {
  await loadSettingsFromBackend().catch(e => console.error('load settings:', e));
  await applyActiveTheme().catch(e => console.error('apply theme:', e));
  renderTools();
  await refreshAll().catch(e => { console.error('initial refresh failed:', e); setStatus('초기화 실패: ' + e); });
  await setupDragDrop().catch(e => console.error('drag-drop setup failed:', e));
})();
