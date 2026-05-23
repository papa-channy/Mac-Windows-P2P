// Shared scaffolding for all mockup pages: icons, top header, fake data.
// No real backend. Pure HTML/CSS/JS for design iteration only.

const ICONS = {
  leaf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19.2 2.96a1 1 0 0 1 1.8.66 7 7 0 0 1-9.2 8.6"/><path d="M2 22 17 7"/></svg>',
  github: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.55 0-.27-.01-1-.02-1.96-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.27-1.68-1.27-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.24 3.34.95.1-.74.4-1.24.72-1.53-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.95 10.95 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.73.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.4-5.25 5.69.41.36.78 1.06.78 2.14 0 1.55-.01 2.8-.01 3.18 0 .31.21.66.8.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"/></svg>',
  apple: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.06 13.06c-.03-2.66 2.17-3.93 2.27-3.99-1.23-1.8-3.16-2.05-3.84-2.08-1.64-.17-3.19.97-4.02.97-.83 0-2.11-.94-3.46-.92-1.78.03-3.41 1.03-4.33 2.62-1.84 3.2-.47 7.94 1.33 10.54.88 1.27 1.93 2.7 3.31 2.65 1.33-.05 1.83-.86 3.44-.86 1.6 0 2.05.86 3.46.83 1.43-.02 2.34-1.29 3.22-2.57 1.01-1.47 1.43-2.91 1.46-2.98-.03-.01-2.8-1.07-2.84-4.23zM13.93 5.4c.72-.88 1.21-2.09 1.07-3.31-1.04.05-2.32.7-3.07 1.56-.67.76-1.26 2-1.1 3.17 1.17.09 2.37-.59 3.1-1.42z"/></svg>',
  windows: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 5.48 10.5 4.4v7.7H3V5.48zm0 13.04v-6.34h7.5v7.42L3 18.52zm8.5-7.42V4.2L21 2.8v9.3h-9.5zm0 1.08H21V21.2l-9.5-1.4v-7.62z"/></svg>',
  branch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
  filter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
  arrow_up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>',
  arrow_down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>',
  diverge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>',
  fileEdit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  chevron_right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
  layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/></svg>',
  network: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/></svg>',
  zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
};
const icon = (n, cls = '') => `<span class="ic ${cls}" style="display:inline-flex;width:1em;height:1em;line-height:0">${ICONS[n] || ''}</span>`;

const ESC = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// ────────────────────────────────────────────────────────────
// Fake data — three machines + a portfolio of repos
// ────────────────────────────────────────────────────────────
const HOSTS = {
  remote: { key: 'remote', label: 'GitHub', os: 'web',     online: true,  detail: 'api.github.com · 28ms' },
  mac:    { key: 'mac',    label: "chan's MacBook Pro M3", os: 'macos',   online: true,  detail: 'last sync 12s ago · 192.168.50.1' },
  win:    { key: 'win',    label: 'DESKTOP-Q0S7LSQ',       os: 'windows', online: true,  detail: 'last sync 6s ago · 192.168.50.2' },
};

// Each repo: 3-source state. Counts are inclusive; "head" = short sha;
// "lca" is the common-ancestor short sha when known.
const REPOS = [
  {
    owner_repo: 'papa-channy/Mac-Windows-P2P', branch: 'main', lang: 'rust',
    remote: { head: '826e9bb', prs: 1 },
    mac:    { head: 'mac0001', ahead: 1, behind: 2, dirty: 2, unpushed: 1, stash: 1 },
    win:    { head: '826e9bb', ahead: 0, behind: 0, dirty: 0, unpushed: 0, stash: 0 },
    lca:    'f1b62e3',
    conflictRisk: 'low',
  },
  {
    owner_repo: 'Flogi-dev/flogi', branch: 'main', lang: 'typescript',
    remote: { head: 'a17c448', prs: 1 },
    mac:    { head: '1111111', ahead: 0, behind: 3, dirty: 0, unpushed: 0, stash: 0, branch: 'feature/onboarding', noRemoteBranch: true },
    win:    { head: '844fe1c', ahead: 0, behind: 12, dirty: 18, unpushed: 0, stash: 0 },
    lca:    '844fe1c',
    conflictRisk: 'medium',
    dirtyOverlap: ['src/app.tsx', 'package.json'],
  },
  {
    owner_repo: 'Flogi-dev/ai_web_front', branch: 'main', lang: 'typescript',
    remote: { head: 'f5c6b00', prs: 1 },
    mac:    null,
    win:    { head: 'ca2e49a', ahead: 0, behind: 4, dirty: 2, unpushed: 0, stash: 0 },
    conflictRisk: 'low',
  },
  {
    owner_repo: 'Flogi-dev/Flogi_Docs', branch: 'main', lang: 'markdown',
    remote: { head: '5423863', prs: 0 },
    mac:    { head: '5423863', ahead: 0, behind: 0, dirty: 3, unpushed: 0, stash: 0 },
    win:    { head: '5423863', ahead: 0, behind: 0, dirty: 8, unpushed: 0, stash: 0 },
    lca:    '5423863',
    conflictRisk: 'high',
    dirtyOverlap: ['README.md', 'roadmap.md', 'architecture.md'],
  },
  {
    owner_repo: 'Flogi-dev/obsidian-flogi', branch: 'main', lang: 'lua',
    remote: { head: '36d4729', prs: 1 },
    mac:    null,
    win:    { head: 'a7de419', ahead: 0, behind: 6, dirty: 1, unpushed: 0, stash: 0 },
    conflictRisk: 'low',
  },
  {
    owner_repo: 'papa-channy/gaon_sub', branch: 'main', lang: 'python',
    remote: { head: '903e140', prs: 0 },
    mac:    null,
    win:    { head: '903e140', ahead: 0, behind: 0, dirty: 3, unpushed: 0, stash: 0 },
    conflictRisk: 'low',
  },
  {
    owner_repo: 'papa-channy/portfolio-2026', branch: 'main', lang: 'typescript',
    remote: { head: 'c44dd01', prs: 2 },
    mac:    { head: 'd71be9a', ahead: 3, behind: 0, dirty: 1, unpushed: 3, stash: 0 },
    win:    { head: 'c44dd01', ahead: 0, behind: 0, dirty: 0, unpushed: 0, stash: 0 },
    lca:    'c44dd01',
    conflictRisk: 'low',
  },
  {
    owner_repo: 'papa-channy/seed-cli', branch: 'main', lang: 'rust',
    remote: { head: 'b22aa55', prs: 0 },
    mac:    { head: 'e88aa01', ahead: 1, behind: 0, dirty: 5, unpushed: 1, stash: 0 },
    win:    { head: 'f99bb02', ahead: 2, behind: 0, dirty: 4, unpushed: 2, stash: 0 },
    lca:    'b22aa55',
    conflictRisk: 'high',
    dirtyOverlap: ['src/lib.rs', 'Cargo.toml', 'README.md'],
  },
];

const LANG_ICON = { rust:'🦀', typescript:'TS', javascript:'JS', python:'🐍', go:'GO', markdown:'📄', lua:'🌙' };

function severity(r) {
  // ranking for sort
  const m = r.mac, w = r.win;
  const dirtyOverlap = (r.dirtyOverlap || []).length;
  const diverge = (m && w && m.head !== w.head) ? 1 : 0;
  const a = (m?.ahead||0) + (w?.ahead||0) + (m?.unpushed||0) + (w?.unpushed||0);
  const b = (m?.behind||0) + (w?.behind||0);
  return diverge*5 + dirtyOverlap*3 + Math.min(a, 8) + Math.min(b, 8) + (r.conflictRisk === 'high' ? 6 : r.conflictRisk === 'medium' ? 3 : 0);
}

function statusOf(r) {
  if ((r.dirtyOverlap || []).length) return { cls: 'danger', label: '🚨 충돌 임박', kind: 'conflict' };
  if (r.mac && r.win && r.mac.head !== r.win.head) return { cls: 'warn', label: '⚠ 발산', kind: 'diverged' };
  const anyDirty = (r.mac?.dirty || r.win?.dirty || r.mac?.unpushed || r.win?.unpushed);
  if (anyDirty) return { cls: 'warn', label: '⚠ 미커밋', kind: 'dirty' };
  if (!r.mac || !r.win) return { cls: 'muted', label: '단일 호스트', kind: 'partial' };
  return { cls: 'sync', label: '✓ 동기화됨', kind: 'synced' };
}

// ────────────────────────────────────────────────────────────
// Global header — used on every page
// ────────────────────────────────────────────────────────────
function renderHeader(activeKey = '') {
  return `
  <header class="gh">
    <div class="gh-row">
      <div class="gh-brand">
        <span class="leaf" style="color:#2da44e">${ICONS.leaf}</span>
        <span>Mac-Window <span style="color:var(--text-3); font-weight:600">·</span> Git Sync</span>
      </div>
      <nav class="gh-nav" style="display:flex; gap:4px; margin-left:20px;">
        ${navLink('index.html', '대시보드', activeKey === 'home')}
        ${navLink('syncmap.html', 'Sync Map', activeKey === 'sync')}
        ${navLink('dag.html', 'Multi-DAG', activeKey === 'dag')}
        ${navLink('conflict.html', '충돌 레이더', activeKey === 'conflict')}
        ${navLink('resolver.html', '3-way Resolver', activeKey === 'resolver')}
      </nav>
      <div class="gh-spacer"></div>
      <div class="gh-3node" title="3-Node Global Status — 양쪽 모두 온라인일 때만 비교 안정">
        <span class="gh-node remote"><span class="led"></span>${icon('github')} GitHub</span>
        <span class="gh-sep">⟷</span>
        <span class="gh-node mac"><span class="led"></span>${icon('apple')} Mac</span>
        <span class="gh-sep">⟷</span>
        <span class="gh-node win"><span class="led"></span>${icon('windows')} Win</span>
      </div>
      <span class="gh-stat">동기화 6s 전 · 10GbE 9.2 Gbps</span>
      <div class="gh-actions">
        <button class="gh-btn">${icon('refresh')} 새로고침</button>
        <button class="gh-btn">${icon('settings')} 설정</button>
      </div>
    </div>
  </header>`;
}
function navLink(href, label, active) {
  return `<a href="${href}" class="gh-btn" style="${active ? 'background:var(--text); color:#fff; border-color:var(--text);' : 'border-color:transparent;background:transparent;'}">${ESC(label)}</a>`;
}

// shorthand: drop header + open page wrapper
function bootPage(activeKey, title, sub) {
  document.body.insertAdjacentHTML('afterbegin', renderHeader(activeKey));
  const wrap = document.createElement('div');
  wrap.className = 'page';
  wrap.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">${ESC(title)}</h1>
        ${sub ? `<div class="page-sub">${ESC(sub)}</div>` : ''}
      </div>
    </div>
    <div id="page-body"></div>
  `;
  document.body.appendChild(wrap);
  return document.getElementById('page-body');
}
