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
  { key: 'documents',    label: 'Documents',   emoji: '📄', folder: '30_Documents'    },
  { key: 'data',         label: 'Data',        emoji: '📊', folder: '20_Data'         },
  { key: 'repos',        label: 'Code',        emoji: '💻', folder: '10_Repos'        },
  { key: 'research',     label: 'Research',    emoji: '🔬', folder: '40_Research'     },
  { key: 'env',          label: 'Env',         emoji: '⚙',  folder: '50_Env'          },
  { key: 'builds',       label: 'Builds',      emoji: '🛠', folder: '60_Builds'       },
  { key: 'assets',       label: 'Assets',      emoji: '🎨', folder: '70_Assets'       },
  { key: 'misc',         label: 'Misc',        emoji: '📦', folder: '90_Misc'         },
  { key: 'unclassified', label: 'Unclassified', emoji: '❔', folder: '99_Unclassified' },
];

// Sidebar groups: each shows category counts for a particular (direction, state).
const NAV_GROUPS = [
  { id: 'inbox',    iconName: 'inbox',    title: 'In - from Mac',  direction: 'mac_to_windows', state: 'ready' },
  { id: 'outbox',   iconName: 'send',     title: 'Out - to Mac',   direction: 'windows_to_mac', state: 'ready' },
];

// 로그 hub: collapsible (default closed). 송신/수신/오류 = jsonl, 압축이미지 = grid, 작업로그 = jsonl.
const LOG_CATEGORIES = [
  { id: 'send',       iconName: 'upload',         label: 'Sent',              subtitle: 'Windows → Mac 송신 기록' },
  { id: 'recv',       iconName: 'download',       label: 'Received',          subtitle: 'Mac → Windows 수신 + 무결성 검증 기록' },
  { id: 'error',      iconName: 'alert-triangle', label: 'Errors',            subtitle: '송신/검증 실패 기록' },
  { id: 'compressed', iconName: 'image',          label: 'Compressed images', subtitle: '30일 경과 후 압축 보관된 클립보드 이미지' },
  { id: 'worklog',    iconName: 'file-clock',     label: 'Worklog',           subtitle: '프로그램 개선/오류 수정 기록' },
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
  'scroll-text': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/></svg>',
  'chevron-right': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
  'upload': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>',
  'download': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>',
  'alert-triangle': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  'image': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>',
  'file-clock': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 22h2a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v3"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><circle cx="8" cy="16" r="6"/><path d="M9.5 17.5 8 16.25V14"/></svg>',
  'git-branch': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>',
  'monitor':       '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>',
  'hard-drive':    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" x2="2" y1="12" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" x2="6.01" y1="16" y2="16"/><line x1="10" x2="10.01" y1="16" y2="16"/></svg>',
  'github':        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.55 0-.27-.01-1-.02-1.96-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.27-1.68-1.27-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.24 3.34.95.1-.74.4-1.24.72-1.53-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.95 10.95 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.73.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.4-5.25 5.69.41.36.78 1.06.78 2.14 0 1.55-.01 2.8-.01 3.18 0 .31.21.66.8.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"/></svg>',
  'shield-alert':  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>',
  'check-circle-2':'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  'file-diff':     '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v3"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 10h6"/><path d="M12 13v-3"/><path d="M9 17h6"/></svg>',
  'terminal':      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>',
  'list-tree':     '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12h-8"/><path d="M21 6H8"/><path d="M21 18h-8"/><path d="M3 6v4c0 1.1.9 2 2 2h3"/><path d="M3 10v6c0 1.1.9 2 2 2h3"/></svg>',
  'activity':      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
  'file-code':     '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 12.5 8 15l2 2.5"/><path d="m14 12.5 2 2.5-2 2.5"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2z"/></svg>',
  'file-warning':  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M5 17v-2"/><path d="M5 21v.01"/></svg>',
  'git-commit':    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><line x1="3" x2="9" y1="12" y2="12"/><line x1="15" x2="21" y1="12" y2="12"/></svg>',
  'git-merge':     '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg>',
  'arrow-up-right':'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>',
  'arrow-up':      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>',
  'arrow-down':    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>',
  'arrow-left':    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>',
  'clock':         '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  'circle-dot':    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>',
  'zap':           '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  'package':       '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',
  'gitfork':       '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/><path d="M12 12v3"/></svg>',
  // Brand logos (filled — not stroked)
  'apple':         '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M16.06 13.06c-.03-2.66 2.17-3.93 2.27-3.99-1.23-1.8-3.16-2.05-3.84-2.08-1.64-.17-3.19.97-4.02.97-.83 0-2.11-.94-3.46-.92-1.78.03-3.41 1.03-4.33 2.62-1.84 3.2-.47 7.94 1.33 10.54.88 1.27 1.93 2.7 3.31 2.65 1.33-.05 1.83-.86 3.44-.86 1.6 0 2.05.86 3.46.83 1.43-.02 2.34-1.29 3.22-2.57 1.01-1.47 1.43-2.91 1.46-2.98-.03-.01-2.8-1.07-2.84-4.23zM13.93 5.4c.72-.88 1.21-2.09 1.07-3.31-1.04.05-2.32.7-3.07 1.56-.67.76-1.26 2-1.1 3.17 1.17.09 2.37-.59 3.1-1.42z"/></svg>',
  'windows':       '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M3 5.48 10.5 4.4v7.7H3V5.48zm0 13.04v-6.34h7.5v7.42L3 18.52zm8.5-7.42V4.2L21 2.8v9.3h-9.5zm0 1.08H21V21.2l-9.5-1.4v-7.62z"/></svg>',
};

function svgIcon(name) {
  return ICONS[name] || '';
}

const VIEW_TREE      = 'tree';
const VIEW_ITEMS     = 'items';
const VIEW_NOTES     = 'notes';
const VIEW_CLIPBOARD = 'clipboard';
const VIEW_SETTINGS  = 'settings';
const VIEW_LOG       = 'log';
const VIEW_GIT       = 'git';

const state = {
  view: VIEW_TREE,
  selection: { group: 'inbox', categoryKey: null },
  cache: new Map(),
  pendingDrop: null,
  treePath: null,
  settings: null,
  notes:     { list: [], selectedId: null, current: null, saveTimer: null },
  clipboard: { entries: [], pollTimer: null, autoTimer: null },
  log:       { category: null, hubOpen: false, entries: [] },
  git:       { snapshots: [], remote: {}, scanning: false, fetchingRemote: false },
  gitDetail: { ownerRepo: null, graph: null, branch: null, mode: 'sync' },
};

// Defaults applied if backend returns nothing (shouldn't happen but be safe)
const DEFAULT_SETTINGS = {
  schema_version: 1,
  tree: { max_depth: 4, shortcuts: [] },
  network: { remote_host: '192.168.50.2' },
  appearance: { icon_theme: 'default', icon_themes: [], icon_theme_path: null },
  integrity: { auto_verify_on_receive: true, show_manual_button: true },
  git: { extra_roots: [], exclude_dirs: [], scan_enabled: true, owners: [], only_mine: true },
  notifications: { enabled: false, native: true, webhook_url: '', on_send_ok: true, on_send_fail: true, on_verify_ok: false, on_verify_fail: true, on_clipboard: false },
};

// Cached policy from shared policy.json (loaded on settings open)
let cachedPolicy = null;

// Loaded VSCode icon theme definition for the active theme (null when not active)
let activeThemeDef = null;     // raw icon-theme.json content
let activeThemeBaseDir = null; // directory of the json (for resolving relative iconPath)

// ─── DOM refs ───────────────────────────────────────────────────
const $actionGrid = document.getElementById('action-grid');
const $navLoghub = document.getElementById('nav-loghub');
const $panelLog    = document.getElementById('panel-log');
const $logTitle    = document.getElementById('log-title');
const $logSubtitle = document.getElementById('log-subtitle');
const $logList     = document.getElementById('log-list');
const $logRefresh  = document.getElementById('log-refresh');
const $panelGit    = document.getElementById('panel-git');
const $gitSubtitle = document.getElementById('git-subtitle');
const $gitList     = document.getElementById('git-list');
const $gitScan     = document.getElementById('git-scan');
const $gitFetchRemote = document.getElementById('git-fetch-remote');
const $gitRefresh  = document.getElementById('git-refresh');
const $gitDetail        = document.getElementById('git-detail');
const $gitDetailTitle   = document.getElementById('git-detail-title');
const $gitDetailBranch  = document.getElementById('git-detail-branch');
const $gitDetailMode    = document.getElementById('git-detail-mode');
const $gitDetailSummary = document.getElementById('git-detail-summary');
const $notifyEnabled    = document.getElementById('notify-enabled');
const $notifyNative     = document.getElementById('notify-native');
const $notifyWebhook    = document.getElementById('notify-webhook');
const $notifyOnSendOk   = document.getElementById('notify-on-send-ok');
const $notifyOnSendFail = document.getElementById('notify-on-send-fail');
const $notifyOnVerifyOk = document.getElementById('notify-on-verify-ok');
const $notifyOnVerifyFail = document.getElementById('notify-on-verify-fail');
const $notifyTest       = document.getElementById('notify-test');
const $gitDetailBody    = document.getElementById('git-detail-body');
const $gitInspector     = document.getElementById('git-inspector');
const $gitInspectorTitle= document.getElementById('git-inspector-title');
const $gitInspectorTabs = document.getElementById('git-inspector-tabs');
const $gitInspectorBody = document.getElementById('git-inspector-body');
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
const $themeCatalog = document.getElementById('theme-catalog');
const $themeGitUrl  = document.getElementById('theme-git-url');
const $themeGitAdd  = document.getElementById('theme-git-add');
const $integrityAuto   = document.getElementById('integrity-auto');
const $integrityManual = document.getElementById('integrity-manual');
const $gitToken        = document.getElementById('git-token');
const $gitTokenSave    = document.getElementById('git-token-save');
const $gitTokenStatus  = document.getElementById('git-token-status');
const $gitTokenClear   = document.getElementById('git-token-clear');
const $gitSshStatus    = document.getElementById('git-ssh-status');
const $gitSshPubkey    = document.getElementById('git-ssh-pubkey');
const $gitSshGen       = document.getElementById('git-ssh-gen');
const $gitSshCopy      = document.getElementById('git-ssh-copy');
const $gitOnlyMine     = document.getElementById('git-only-mine');
const $gitOwners       = document.getElementById('git-owners');
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
const $clipSplit      = document.getElementById('clip-os-split');
const $clipRefresh    = document.getElementById('clip-refresh');
const $clipClear      = document.getElementById('clip-clear');
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
const $detailsVerify = document.getElementById('details-verify');
const $verifyResult = document.getElementById('verify-result');
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
    toast(`로드 실패 (${group.title}): ${e}`, 'error');
    return [];
  }
}

async function refreshAll() {
  setStatus('새로고침 중…');
  for (const g of NAV_GROUPS) { await fetchGroup(g); }
  renderActionGrid();
  renderNav();
  renderView();
  setStatus('마지막 갱신: ' + new Date().toLocaleTimeString('ko-KR'));
}

// Auto-verify received transfers (mac→windows) lacking a cached result.
// Runs only when the setting is on; refreshes the list so badges update.
let _autoVerifyRunning = false;
async function maybeAutoVerify() {
  const cfg = state.settings && state.settings.integrity;
  if (!cfg || !cfg.auto_verify_on_receive) return;
  if (_autoVerifyRunning) return;
  _autoVerifyRunning = true;
  try {
    const n = await invoke('auto_verify_pending');
    if (n > 0) {
      for (const g of NAV_GROUPS) { await fetchGroup(g); }
      renderNav();
      if (state.view === VIEW_ITEMS) renderItems();
    }
  } catch (e) {
    console.warn('auto-verify:', e);
  } finally {
    _autoVerifyRunning = false;
  }
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
  state.settings.integrity = Object.assign({}, DEFAULT_SETTINGS.integrity, state.settings.integrity || {});
  state.settings.git = Object.assign({}, DEFAULT_SETTINGS.git, state.settings.git || {});
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
  // Integrity toggles
  const integ = state.settings.integrity || DEFAULT_SETTINGS.integrity;
  $integrityAuto.checked = integ.auto_verify_on_receive !== false;
  $integrityManual.checked = integ.show_manual_button !== false;
  // Git section
  renderGitSettings();
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
  // Theme — render radio list (built-ins + installed) + catalog
  renderThemeOptions();
  renderThemeCatalog();
  // Policy & profiles
  renderPolicyAndProfiles();
  // Notifications
  renderNotificationSettings();
}

function renderNotificationSettings() {
  const n = state.settings.notifications || DEFAULT_SETTINGS.notifications;
  $notifyEnabled.checked    = !!n.enabled;
  $notifyNative.checked     = n.native !== false;
  $notifyWebhook.value      = n.webhook_url || '';
  $notifyOnSendOk.checked   = n.on_send_ok !== false;
  $notifyOnSendFail.checked = n.on_send_fail !== false;
  $notifyOnVerifyOk.checked = !!n.on_verify_ok;
  $notifyOnVerifyFail.checked = n.on_verify_fail !== false;
}

async function saveNotificationSettings() {
  state.settings.notifications = {
    enabled: $notifyEnabled.checked,
    native: $notifyNative.checked,
    webhook_url: ($notifyWebhook.value || '').trim(),
    on_send_ok: $notifyOnSendOk.checked,
    on_send_fail: $notifyOnSendFail.checked,
    on_verify_ok: $notifyOnVerifyOk.checked,
    on_verify_fail: $notifyOnVerifyFail.checked,
    on_clipboard: false,
  };
  await persistSettings();
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

// VSCode icon theme catalog (마켓플레이스 VSIX — 양쪽 동일 카탈로그)
const ICON_THEME_CATALOG = [
  { label: 'Material Icon Theme', slug: 'material-icon-theme', blurb: 'VSCode 표준 · 1200+', vsix: 'https://marketplace.visualstudio.com/_apis/public/gallery/publishers/PKief/vsextensions/material-icon-theme/latest/vspackage' },
  { label: 'Catppuccin Icons', slug: 'catppuccin-vsc-icons', blurb: 'Mocha/Latte/Frappé/Macchiato', vsix: 'https://marketplace.visualstudio.com/_apis/public/gallery/publishers/Catppuccin/vsextensions/catppuccin-vsc-icons/latest/vspackage' },
  { label: 'Symbols', slug: 'symbols', blurb: '단색 미니멀', vsix: 'https://marketplace.visualstudio.com/_apis/public/gallery/publishers/miguelsolorio/vsextensions/symbols/latest/vspackage' },
  { label: 'vscode-icons', slug: 'vscode-icons', blurb: '오리지널 아이콘 팩', vsix: 'https://marketplace.visualstudio.com/_apis/public/gallery/publishers/vscode-icons-team/vsextensions/vscode-icons/latest/vspackage' },
];

// Shared post-install: register theme, activate, persist, redraw.
async function registerInstalledTheme(theme) {
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
}

async function installIconTheme() {
  try {
    const dialog = window.__TAURI__ && window.__TAURI__.dialog;
    if (!dialog) { toast('dialog 플러그인 없음', 'error'); return; }
    const folder = await dialog.open({ multiple: false, directory: true, title: 'VSCode 아이콘 테마 폴더 선택' });
    if (!folder) return;
    setStatus(`테마 검증 중: ${folder}`);
    const theme = await invoke('install_icon_theme', { folder });
    await registerInstalledTheme(theme);
  } catch (e) {
    setStatus('테마 설치 실패: ' + e);
    toast('테마 추가 실패: ' + e, 'error');
  }
}

async function installThemeFromVsix(entry) {
  setStatus(`${entry.label} 다운로드 중…`);
  try {
    const theme = await invoke('install_icon_theme_from_vsix', { url: entry.vsix, slug: entry.slug });
    await registerInstalledTheme(theme);
  } catch (e) {
    setStatus('설치 실패: ' + e);
    toast(`${entry.label} 설치 실패: ${e}`, 'error');
  }
}

async function installThemeFromGit() {
  const url = ($themeGitUrl.value || '').trim();
  if (!url) { toast('git URL을 입력하세요', 'error'); return; }
  setStatus(`git clone: ${url}`);
  $themeGitAdd.disabled = true;
  try {
    const theme = await invoke('install_icon_theme_from_git', { repoUrl: url });
    $themeGitUrl.value = '';
    await registerInstalledTheme(theme);
  } catch (e) {
    setStatus('git 설치 실패: ' + e);
    toast('git 테마 추가 실패: ' + e, 'error');
  } finally {
    $themeGitAdd.disabled = false;
  }
}

function renderThemeCatalog() {
  if (!$themeCatalog) return;
  $themeCatalog.innerHTML = '';
  const installed = (state.settings.appearance.icon_themes || []).map(t => t.id);
  for (const c of ICON_THEME_CATALOG) {
    const btn = document.createElement('button');
    btn.className = 'catalog-btn';
    const have = installed.includes(c.slug);
    btn.innerHTML = `
      <span class="catalog-btn-label">${escape(c.label)}${have ? ' ✓' : ''}</span>
      <span class="catalog-btn-blurb">${escape(c.blurb)}</span>
    `;
    btn.addEventListener('click', () => installThemeFromVsix(c));
    $themeCatalog.appendChild(btn);
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

// 새 노트 id 를 프론트에서 미리 mint 한다. 새 노트에 id 가 없으면 백엔드
// save_note 가 매 저장마다 새 UUID 를 만들어, 디바운스 자동저장이 첫 저장의
// await 완료 전 재발동하면 메모 1개가 여러 파일로 분열된다 (Mac E-12-a).
function newNoteId() {
  const raw = (window.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`).replace(/-/g, '');
  return 'note-' + raw;
}

async function saveCurrentNote() {
  if (!state.notes.current) return;
  try {
    const updated = await invoke('save_note', {
      id: state.notes.current.id || newNoteId(),   // null 방지: 만약을 위한 fallback
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
  if (state.notes.saveTimer) clearTimeout(state.notes.saveTimer);
  state.notes.selectedId = null;
  state.notes.current = {
    id: newNoteId(),            // ← 입력 전에 안정적인 id 를 미리 고정
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

// ─── Clipboard (unified timeline) ───────────────────────────────
async function refreshClipboard() {
  try {
    const entries = await invoke('list_clipboard_entries', { limit: 200 });
    // Skip the DOM rebuild when nothing changed — otherwise the 2s poll
    // re-creates every <img> and the thumbnails flicker on each tick.
    const sig = entries.map(e => `${e.ts || ''}:${e.kind || ''}:${e.image_ref || ''}`).join('|');
    if (sig === state.clipboard.lastSig) return;
    state.clipboard.lastSig = sig;
    state.clipboard.entries = entries;
    renderClipboardPanel();
  } catch (e) {
    console.warn('clipboard refresh:', e);
  }
}

function osBadge(os) {
  if (os === 'windows') return { cls: 'clip-entry-os-win', label: 'Win' };
  if (os === 'macos')   return { cls: 'clip-entry-os-mac', label: 'Mac' };
  return { cls: '', label: (os || '?').toUpperCase() };
}

function looksLikeUrl(s) {
  return /^https?:\/\//i.test((s || '').trim());
}

// Windows 빌드의 navigator 는 host OS 를 반영 → 'windows'. (Mac 미러 빌드라면
// 'macos' 가 나와 좌우 컬럼이 자동 반전된다.)
function detectLocalOs() {
  return /Win/i.test(navigator.userAgent) ? 'windows' : 'macos';
}
function osLabel(os, isLocal) {
  const name = os === 'macos' ? 'Mac' : 'Windows';
  return isLocal ? `내 클립보드 · ${name}` : `${name} 클립보드`;
}

// OS별 좌우 2컬럼 카드 레이아웃 (Mac E-8-a 미러). 좌 = 상대 OS, 우 = 내 OS.
// 각 컬럼은 독립적으로 newest-first → OS 분리 + 시간순 정렬 동시 만족.
function renderClipboardPanel() {
  const localOs  = detectLocalOs();                            // 'windows'
  const remoteOs = localOs === 'macos' ? 'windows' : 'macos';  // 'macos'

  const all = state.clipboard.entries || [];
  const remoteEntries = all.filter(e => e.os === remoteOs);
  const localEntries  = all.filter(e => e.os !== remoteOs);

  $clipSplit.innerHTML = '';
  // 좌측 = remote, 우측 = local
  $clipSplit.appendChild(renderClipColumn(remoteOs, false, remoteEntries));
  $clipSplit.appendChild(renderClipColumn(localOs,  true,  localEntries));
}

function renderClipColumn(os, isLocal, entries) {
  const col = document.createElement('div');
  col.className = 'clip-col ' + (isLocal ? 'local' : 'remote');

  const badge = osBadge(os);
  const head = document.createElement('header');
  head.className = 'clip-col-head';
  head.innerHTML = `
    <span class="clip-entry-os ${badge.cls}">${escape(badge.label)}</span>
    <span class="clip-col-title">${escape(osLabel(os, isLocal))}</span>
    <span class="clip-col-count">${entries.length}건</span>`;
  col.appendChild(head);

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'clip-col-empty';
    empty.textContent = isLocal
      ? '내 클립보드 기록이 없어요. 복사하면 여기 쌓여요.'
      : '상대 호스트 기록이 없어요.';
    col.appendChild(empty);
    return col;
  }

  const body = document.createElement('div');
  body.className = 'clip-col-body';
  for (const e of entries) {
    body.appendChild(e.kind === 'image' ? renderClipImageCard(e) : renderClipTextCard(e));
  }
  col.appendChild(body);
  return col;
}

function clipCardHead(e) {
  return `
    <div class="clip-card-head">
      <span class="clip-card-host" title="${escape(e.host || '')}">${escape(e.host || '?')}</span>
      <span class="clip-card-time">${escape(fmtRelative(e.ts))}</span>
    </div>`;
}

function renderClipTextCard(e) {
  const content = e.content || '';
  const preview = content.length > 600 ? content.slice(0, 600) + '…' : content;
  const urlClass = looksLikeUrl(content) ? ' url' : '';
  const card = document.createElement('button');
  card.className = 'clip-card';
  card.title = '클릭 → 내 클립보드로 복사';
  card.innerHTML = clipCardHead(e) +
    `<div class="clip-card-text${urlClass}">${escape(preview)}</div>`;
  card.addEventListener('click', async () => {
    try {
      await invoke('copy_to_os_clipboard', { text: content });
      toast('내 OS 클립보드로 복사됨', 'success');
    } catch (err) { toast('복사 실패: ' + err, 'error'); }
  });
  return card;
}

function renderClipImageCard(e) {
  const dims = (e.width && e.height) ? `${e.width}×${e.height}` : '';
  const sz = (e.size_bytes || e.bytes) ? fmtBytes(e.size_bytes || e.bytes) : '';
  const card = document.createElement('button');
  card.className = 'clip-card clip-card-image';
  card.title = '클릭 → 내 클립보드로 복사';
  card.innerHTML = clipCardHead(e) +
    `<div class="clip-card-thumb-wrap" data-ref="${escape(e.image_ref || '')}"></div>
     <span class="clip-card-imgmeta">${escape(dims)}${dims ? ' · ' : ''}${escape(sz)}</span>`;
  const wrap = card.querySelector('.clip-card-thumb-wrap');
  // Lazy-load thumbnail via asset protocol
  (async () => {
    try {
      const path = await invoke('clipboard_image_path', { imageRef: e.image_ref });
      const url = window.__TAURI__.core.convertFileSrc(path);
      const img = new Image();
      img.className = 'clip-card-thumb';
      img.src = url;
      img.onerror = () => { wrap.innerHTML = '<div class="clip-card-missing">이미지 로드 실패 / 만료됨</div>'; };
      wrap.appendChild(img);
    } catch (_) {
      wrap.innerHTML = '<div class="clip-card-missing">이미지 로드 실패 / 만료됨</div>';
    }
  })();
  card.addEventListener('click', async () => {
    try {
      await invoke('copy_image_to_os_clipboard', { imageRef: e.image_ref });
      toast('이미지를 내 OS 클립보드로 복사됨', 'success');
    } catch (err) { toast('복사 실패: ' + err, 'error'); }
  });
  return card;
}

function startClipboardPolling() {
  if (state.clipboard.pollTimer) return;
  refreshClipboard();
  state.clipboard.pollTimer = setInterval(refreshClipboard, 2000);
}
function stopClipboardPolling() {
  if (state.clipboard.pollTimer) {
    clearInterval(state.clipboard.pollTimer);
    state.clipboard.pollTimer = null;
  }
}

async function clearOwnClipboardHistory() {
  if (!window.confirm('내(이 호스트의) 클립보드 기록을 모두 지울까요? (Mac 측 기록은 그대로 유지)')) return;
  try {
    await invoke('clear_own_clipboard_history');
    await refreshClipboard();
    toast('내 클립보드 기록 지움', 'success');
  } catch (e) { toast('실패: ' + e, 'error'); }
}

function refreshIconsInView() {
  renderActionGrid();
  renderNav();
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
// 상단 2열 액션 카드 그리드 (Mac 미러). 6개 액션을 카드형으로 통합:
// Fast Forward / Notes / Clipboard / Git Status (뷰 전환, active 표시) +
// Refresh / Settings (Refresh 는 액션이라 active 없음).
function renderActionGrid() {
  $actionGrid.innerHTML = '';
  const actions = [
    { view: VIEW_TREE,      iconName: 'rocket',       label: 'Fast Forward', onClick: () => switchView(VIEW_TREE) },
    { view: VIEW_NOTES,     iconName: 'notebook-pen', label: 'Notes',        onClick: () => switchView(VIEW_NOTES) },
    { view: VIEW_CLIPBOARD, iconName: 'clipboard',    label: 'Clipboard',    onClick: () => switchView(VIEW_CLIPBOARD) },
    { view: VIEW_GIT,       iconName: 'git-branch',   label: 'Git Status',   onClick: () => switchView(VIEW_GIT) },
    { view: null,           iconName: 'refresh-cw',   label: 'Refresh',      onClick: () => { refreshAll().catch(e => toast(String(e), 'error')); } },
    { view: VIEW_SETTINGS,  iconName: 'settings',     label: 'Settings',     onClick: () => switchView(state.view === VIEW_SETTINGS ? VIEW_TREE : VIEW_SETTINGS) },
  ];
  for (const a of actions) {
    const card = document.createElement('button');
    card.className = 'action-card';
    if (a.view && state.view === a.view) card.classList.add('active');
    card.title = a.label;
    card.innerHTML = svgIcon(a.iconName) + `<span class="action-card-label">${escape(a.label)}</span>`;
    card.addEventListener('click', a.onClick);
    $actionGrid.appendChild(card);
  }
}

// 사이드바에서 뷰를 전환하는 공통 헬퍼. state.view 를 바꾸고 사이드바 +
// 본문을 다시 그린다. (액션 카드 active 표시는 renderView 안에서 동기화.)
function switchView(view) {
  state.view = view;
  renderNav();
  renderView();
}

function renderLogHub() {
  $navLoghub.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'loghub-header' + (state.log.hubOpen ? ' open' : '');
  header.innerHTML = `${svgIcon('scroll-text')}<span class="loghub-title">Log</span><span class="loghub-chevron">${svgIcon('chevron-right')}</span>`;
  header.addEventListener('click', () => {
    state.log.hubOpen = !state.log.hubOpen;
    renderLogHub();
  });
  $navLoghub.appendChild(header);

  if (!state.log.hubOpen) return;
  const sub = document.createElement('div');
  sub.className = 'loghub-items';
  for (const c of LOG_CATEGORIES) {
    const el = navItemEl(c.label, svgIcon(c.iconName), '', () => {
      state.view = VIEW_LOG;
      state.log.category = c.id;
      renderNav(); renderView();
    });
    if (state.view === VIEW_LOG && state.log.category === c.id) el.classList.add('active');
    sub.appendChild(el);
  }
  $navLoghub.appendChild(sub);
}

async function renderLogView() {
  const cat = LOG_CATEGORIES.find(c => c.id === state.log.category) || LOG_CATEGORIES[0];
  state.log.category = cat.id;
  $logTitle.textContent = `📜 ${cat.label}`;
  $logSubtitle.textContent = cat.subtitle;
  $logList.innerHTML = '<div class="log-empty">읽는 중…</div>';
  try {
    if (cat.id === 'compressed') {
      renderCompressedImages(await invoke('list_compressed_images'));
    } else {
      renderLogEntries(cat.id, await invoke('list_log_entries', { category: cat.id, limit: 500 }));
    }
  } catch (e) {
    $logList.innerHTML = `<div class="log-empty">로그 읽기 실패: ${escape(String(e))}</div>`;
  }
}

function logEntrySummary(e) {
  const ev = e.event || '';
  const tid = e.transfer_id ? ` <span class="log-mono">${escape(e.transfer_id)}</span>` : '';
  switch (ev) {
    case 'send_ok':      return `📤 송신 OK · ${escape(e.category || '')}${tid}`;
    case 'send_fail':    return `❌ 송신 실패 · ${escape(e.stderr || '')}`;
    case 'verify_ok':    return `✅ 검증 OK · ${e.checked || 0}개 일치${tid}`;
    case 'verify_fail':  return `⚠ 검증 불일치 ${e.mismatches || 0} · 누락 ${e.missing || 0}${tid}`;
    case 'verify_error': return `❌ 검증 오류 · ${escape(e.error || '')}${tid}`;
    default:             return escape(JSON.stringify(e));
  }
}

function renderLogEntries(catId, entries) {
  if (!entries.length) {
    $logList.innerHTML = `<div class="empty" style="padding:40px 24px"><div class="empty-icon">📭</div><div class="empty-title">기록이 없어요</div></div>`;
    return;
  }
  $logList.innerHTML = '';
  for (const e of entries) {
    const row = document.createElement('div');
    const ev = e.event || '';
    const cls = (ev.includes('fail') || ev.includes('error')) ? ' log-row-error' : (ev.includes('ok') ? ' log-row-ok' : '');
    row.className = 'log-row' + cls;
    const main = catId === 'worklog'
      ? `<b>${escape(e.summary || '')}</b>${e.detail ? `<div class="log-detail">${escape(e.detail)}</div>` : ''}`
      : logEntrySummary(e);
    row.innerHTML = `<div class="log-row-time">${escape(fmtFull(e.ts))}</div><div class="log-row-main">${main}</div>`;
    $logList.appendChild(row);
  }
}

function renderCompressedImages(imgs) {
  if (!imgs.length) {
    $logList.innerHTML = `<div class="empty" style="padding:40px 24px"><div class="empty-icon">🖼</div><div class="empty-title">압축 보관된 이미지가 없어요</div><div class="empty-hint">30일 지난 클립보드 이미지가 여기에 JPEG로 보관돼요.</div></div>`;
    return;
  }
  $logList.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'log-img-grid';
  for (const im of imgs) {
    const cell = document.createElement('div');
    cell.className = 'log-img-cell';
    cell.innerHTML = `<div class="log-img-meta">${escape(fmtBytes(im.size_bytes))} · ${escape(fmtRelative(im.ts))}</div>`;
    (async () => {
      try {
        const p = await invoke('compressed_image_path', { imageRef: im.ref });
        const url = window.__TAURI__.core.convertFileSrc(p);
        const img = new Image();
        img.src = url;
        img.className = 'log-img';
        img.title = '클릭해서 열기';
        img.addEventListener('click', () => invoke('open_path', { path: p }).catch(() => {}));
        cell.prepend(img);
      } catch (_) {}
    })();
    grid.appendChild(cell);
  }
  $logList.appendChild(grid);
}

// ─── Git dashboard ──────────────────────────────────────────────
async function refreshGit() {
  try {
    state.git.snapshots = await invoke('list_git_status');
  } catch (e) {
    console.warn('git status:', e);
    state.git.snapshots = [];
  }
  try {
    const cache = await invoke('read_remote_cache');
    state.git.remote = {};
    for (const r of (cache.repos || [])) state.git.remote[r.owner_repo] = r;
  } catch (_) {}
  renderGitPanel();
}

// Collect the owned owner_repos currently visible, then hit the GitHub API.
async function fetchRemoteNow() {
  if (state.git.fetchingRemote) return;
  const g = state.settings.git || {};
  const ownerSet = new Set((g.owners || []).map(o => o.toLowerCase()));
  const repos = new Set();
  for (const s of state.git.snapshots) {
    for (const r of s.repos) {
      if (!r.owner_repo) continue;
      const owner = r.owner_repo.split('/')[0].toLowerCase();
      if (!g.only_mine || ownerSet.size === 0 || ownerSet.has(owner)) repos.add(r.owner_repo);
    }
  }
  const list = [...repos];
  if (list.length === 0) { toast('조회할 레포가 없어요 (스캔/토큰 먼저)', 'error'); return; }
  state.git.fetchingRemote = true;
  $gitFetchRemote.disabled = true;
  $gitFetchRemote.textContent = '☁ 동기화 중…';
  setStatus(`GitHub 원격 상태 조회 중… (${list.length}개 레포)`);
  try {
    const states = await invoke('github_fetch_remote', { ownerRepos: list });
    state.git.remote = {};
    for (const r of states) state.git.remote[r.owner_repo] = r;
    toast(`${states.length}개 레포 원격 동기화 완료`, 'success');
    renderGitPanel();
  } catch (e) {
    toast('원격 동기화 실패: ' + e, 'error');
  } finally {
    state.git.fetchingRemote = false;
    $gitFetchRemote.disabled = false;
    $gitFetchRemote.textContent = '☁ 원격 동기화';
    setStatus('마지막 갱신: ' + new Date().toLocaleTimeString('ko-KR'));
  }
}

async function scanGitNow() {
  if (state.git.scanning) return;
  state.git.scanning = true;
  $gitScan.disabled = true;
  $gitScan.textContent = '⏳ 스캔 중…';
  setStatus('Git 레포 전체 디스크 스캔 중… (커밋 로그 포함, 수 분 걸릴 수 있어요)');
  try {
    const count = await invoke('scan_and_publish_git');
    toast(`${count}개 레포 스캔·게시 완료 (커밋 로그 포함)`, 'success');
    await refreshGit();
  } catch (e) {
    toast('스캔 실패: ' + e, 'error');
  } finally {
    state.git.scanning = false;
    $gitScan.disabled = false;
    $gitScan.textContent = '🔍 지금 스캔';
    setStatus('마지막 갱신: ' + new Date().toLocaleTimeString('ko-KR'));
  }
}

function gitOsBadge(os) {
  if (os === 'windows') return '<span class="git-os git-os-win">Win</span>';
  if (os === 'macos') return '<span class="git-os git-os-mac">Mac</span>';
  return `<span class="git-os">${escape((os || '?').toUpperCase())}</span>`;
}

function renderGitPanel() {
  const snaps = state.git.snapshots || [];
  if (snaps.length === 0) {
    $gitSubtitle.textContent = '레포별 Mac-로컬 / Win-로컬 동기화 상태';
    $gitList.innerHTML = `<div class="empty" style="padding:40px 24px"><div class="empty-icon">🌿</div><div class="empty-title">아직 스캔 기록이 없어요</div><div class="empty-hint">"지금 스캔"으로 이 머신의 레포를 찾고, Mac에서도 스캔하면 양쪽이 비교돼요.</div></div>`;
    return;
  }
  return renderGitL1Dashboard();
}

// ─── Layer 1 — Dashboard (research-driven 3-layer mockup) ──────
function gitDirtyFileName(line) {
  // Porcelain line like " M src/foo" or "?? path" or "AM x"
  const s = (line || '').trim();
  const i = s.indexOf(' ');
  return i < 0 ? s : s.slice(i + 1).trim();
}
function gitRepoSummary(entry, hosts) {
  const vals = Object.values(entry.hosts);
  const rem = entry.ownerRepo ? state.git.remote[entry.ownerRepo] : null;
  const dirtyFiles = {};
  for (const v of vals) {
    for (const df of (v.dirty_files || [])) {
      const name = gitDirtyFileName(df);
      if (!name) continue;
      (dirtyFiles[name] = dirtyFiles[name] || []).push(v.os || '?');
    }
  }
  const overlaps = Object.entries(dirtyFiles).filter(([, h]) => new Set(h).size > 1).map(([f]) => f);
  const mac = vals.find(v => v.os === 'macos') || null;
  const win = vals.find(v => v.os === 'windows') || null;
  const anyDirty = vals.some(v => (v.dirty || 0) || (v.unpushed || 0) || (v.behind || 0));
  const headsDiffer = new Set(vals.map(v => v.head)).size > 1;
  let kind = 'synced', label = '동기화됨';
  if (overlaps.length)       { kind = 'conflict'; label = '충돌 임박'; }
  else if (vals.length < 2)  { kind = 'partial';  label = '단일 호스트'; }
  else if (headsDiffer)      { kind = 'diverged'; label = '발산'; }
  else if (anyDirty)         { kind = 'dirty';    label = '미커밋'; }
  return { entry, kind, label, mac, win, rem, overlaps, vals };
}

const GIT_STATUS_ICON = {
  synced:   'check-circle-2',
  diverged: 'alert-triangle',
  dirty:    'alert-triangle',
  conflict: 'shield-alert',
  partial:  'circle-dot',
};

function renderGitL1Dashboard() {
  const snaps = state.git.snapshots || [];
  const hosts = snaps.map(s => ({ host: s.host, os: s.os, scanned_at: s.scanned_at }));
  const repoMap = new Map();
  for (const s of snaps) {
    for (const r of s.repos) {
      const key = r.owner_repo || ('local:' + (r.path.split(/[\\/]/).pop() || r.path));
      if (!repoMap.has(key)) {
        repoMap.set(key, {
          label: r.owner_repo || (r.path.split(/[\\/]/).pop() || r.path),
          owner: r.owner_repo ? r.owner_repo.split('/')[0] : null,
          ownerRepo: r.owner_repo || null,
          hosts: {},
        });
      }
      repoMap.get(key).hosts[s.host] = Object.assign({ os: s.os, scanned_at: s.scanned_at }, r);
    }
  }
  const g = state.settings.git || {};
  let entries = [...repoMap.values()];
  const total = entries.length;
  if (g.only_mine && g.owners && g.owners.length) {
    const set = new Set(g.owners.map(o => o.toLowerCase()));
    entries = entries.filter(e => e.owner && set.has(e.owner.toLowerCase()));
  }

  const summaries = entries.map(e => gitRepoSummary(e, hosts));
  const SEV = { conflict: 100, diverged: 50, dirty: 20, partial: 5, synced: 0 };
  summaries.sort((a, b) => (SEV[b.kind] - SEV[a.kind]) || a.entry.label.localeCompare(b.entry.label));

  const conflictCount = summaries.filter(s => s.kind === 'conflict').length;
  const syncedCount   = summaries.filter(s => s.kind === 'synced').length;
  const divergedCount = summaries.filter(s => s.kind === 'diverged' || s.kind === 'dirty').length;
  const filterNote = (g.only_mine && g.owners && g.owners.length)
    ? ` · 내 레포 ${entries.length}/${total}`
    : ` · ${entries.length}개`;
  $gitSubtitle.textContent = `${entries.length}개 레포 모니터링 중 · 동기화 ${syncedCount} · 발산 ${divergedCount} · 충돌 ${conflictCount}${filterNote}`;

  const hero = `
    <section class="git-hero">
      <div class="git-hero-card">
        <div class="ghc-body">
          <div class="ghc-label">전체 레포지토리</div>
          <div class="ghc-num">${entries.length}</div>
          <div class="ghc-sub">3-Node로 동기 모니터링 중</div>
        </div>
        <div class="ghc-ic neutral">${svgIcon('git-branch')}</div>
      </div>
      <div class="git-hero-card synced">
        <div class="ghc-body">
          <div class="ghc-label">안전 · 동기화 완료</div>
          <div class="ghc-num">${syncedCount}</div>
          <div class="ghc-sub">${entries.length ? Math.round(syncedCount/entries.length*100) : 0}% in sync</div>
        </div>
        <div class="ghc-ic sync">${svgIcon('check-circle-2')}</div>
      </div>
      <div class="git-hero-card ${conflictCount > 0 ? 'danger' : 'safe'}">
        <div class="ghc-body">
          <div class="ghc-label">충돌 위험 · 동시 수정</div>
          <div class="ghc-num">${conflictCount}</div>
          <div class="ghc-sub">${conflictCount ? '머지 전 정리 필요' : '경보 없음'}</div>
        </div>
        <div class="ghc-ic ${conflictCount > 0 ? 'danger' : 'neutral'}">${svgIcon('shield-alert')}</div>
      </div>
    </section>`;

  let cards = '<section class="git-l1-grid">';
  for (const s of summaries) {
    cards += renderGitL1Card(s);
  }
  cards += '</section>';
  $gitList.innerHTML = hero + cards;
  $gitList.querySelectorAll('.git-card[data-or]').forEach(el => {
    const or = el.getAttribute('data-or');
    if (or) el.addEventListener('click', () => openGitDetail(or));
  });
}

function renderGitL1Card(s) {
  // ADR-0005: unified layout — no stripe div, no conflict-only div.
  // All verdicts render via the SAME structure; chip color is the only diff.
  const e = s.entry;
  const macDirty = s.mac ? (s.mac.dirty || 0) : null;
  const winDirty = s.win ? (s.win.dirty || 0) : null;
  const remSha = s.rem && s.rem.default_sha ? s.rem.default_sha.slice(0, 7) : '—';
  // ADR-0006: real scan time (most recent across hosts) instead of hard-coded "방금 전 스캔"
  const scanTimes = Object.values(e.hosts || {}).map(h => h && h.scanned_at).filter(Boolean).sort();
  const lastScan = scanTimes.length ? fmtRelative(scanTimes[scanTimes.length - 1]) : '데이터 없음';
  return `
    <div class="git-card git-card-${s.kind}" data-or="${escape(e.ownerRepo || '')}">
      <div class="git-card-head">
        <div class="git-card-title-wrap">
          <h3 class="git-card-name">${escape(e.label)}</h3>
          <div class="git-card-meta">${svgIcon('clock')}<span>${escape(lastScan)} 스캔</span></div>
        </div>
        <span class="git-card-badge git-card-badge-${s.kind}">
          ${svgIcon(GIT_STATUS_ICON[s.kind])}<span>${escape(s.label)}</span>
        </span>
      </div>
      <div class="git-card-bridge">
        ${gitNodeBlock('mac', s.mac, macDirty)}
        <div class="gn-link"></div>
        ${gitNodeBlock('remote', { head: remSha }, null)}
        <div class="gn-link"></div>
        ${gitNodeBlock('win', s.win, winDirty)}
        <span class="git-card-chev">${svgIcon('chevron-right')}</span>
      </div>
    </div>`;
}

function gitNodeBlock(key, data, dirty) {
  const ICON_NAME = { mac: 'apple', remote: 'github', win: 'windows' };
  const LBL = { mac: 'MAC', remote: 'ORIGIN', win: 'WIN' };
  const dim = !data;
  let third = '';
  if (key === 'remote') third = `<span class="gn-mono">${escape((data && data.head) || '—')}</span>`;
  else if (dim)         third = `<span class="gn-mute">없음</span>`;
  else if (dirty > 0)   third = `<span class="gn-dirty">${dirty} dirty</span>`;
  else                  third = `<span class="gn-clean">${svgIcon('check-circle-2')}<span>Clean</span></span>`;
  return `
    <div class="gn gn-${key} ${dim ? 'off' : ''}">
      <div class="gn-icon">${svgIcon(ICON_NAME[key])}<span class="gn-led"></span></div>
      <div class="gn-label">${LBL[key]}</div>
      <div class="gn-third">${third}</div>
    </div>`;
}

function _legacy_renderGitPanel(snaps) {
  const hosts = snaps.map(s => ({ host: s.host, os: s.os, scanned_at: s.scanned_at }));
  const repoMap = new Map();
  for (const s of snaps) {
    for (const r of s.repos) {
      const key = r.owner_repo || ('local:' + (r.path.split(/[\\/]/).pop() || r.path));
      if (!repoMap.has(key)) {
        repoMap.set(key, {
          label: r.owner_repo || (r.path.split(/[\\/]/).pop() || r.path),
          owner: r.owner_repo ? r.owner_repo.split('/')[0] : null,
          ownerRepo: r.owner_repo || null,
          hosts: {},
        });
      }
      repoMap.get(key).hosts[s.host] = Object.assign({ os: s.os }, r);
    }
  }

  // "내 레포만" filter: keep only repos owned by your account/orgs.
  const g = state.settings.git || {};
  let entries = [...repoMap.values()];
  const total = entries.length;
  if (g.only_mine && g.owners && g.owners.length) {
    const set = new Set(g.owners.map(o => o.toLowerCase()));
    entries = entries.filter(e => e.owner && set.has(e.owner.toLowerCase()));
  }
  const filterNote = (g.only_mine && g.owners && g.owners.length)
    ? ` · 내 레포 ${entries.length}/${total}`
    : (total > entries.length ? '' : ` · ${total}개`);
  $gitSubtitle.textContent = hosts.map(h => `${h.host} (${h.os}) · ${fmtRelative(h.scanned_at)}`).join('   /   ') + filterNote;

  const severity = (entry) => {
    const vals = Object.values(entry.hosts);
    let sev = 0;
    if (new Set(vals.map(v => v.head)).size > 1) sev += 4;
    for (const v of vals) { if (v.dirty > 0) sev += 2; if (v.unpushed > 0) sev += 2; if (v.behind > 0) sev += 1; }
    if (vals.length < hosts.length) sev += 1;
    return sev;
  };
  const rows = entries.sort((a, b) => severity(b) - severity(a) || a.label.localeCompare(b.label));

  if (rows.length === 0) {
    $gitList.innerHTML = `<div class="empty" style="padding:40px 24px"><div class="empty-icon">🌿</div><div class="empty-title">표시할 레포가 없어요</div><div class="empty-hint">"내 레포만"이 켜져 있으면 토큰을 검증해 소유 owner를 등록하거나, 설정에서 끄세요.</div></div>`;
    return;
  }

  $gitList.innerHTML = '';
  for (const entry of rows) {
    const vals = Object.values(entry.hosts);
    const heads = new Set(vals.map(v => v.head));
    const rem = entry.ownerRepo ? state.git.remote[entry.ownerRepo] : null;
    const remBranch = (name) => rem && (rem.branches || []).find(b => b.name === name);

    // vs-remote per host + overall sync (including remote when known).
    let allMatchRemote = !!rem && !!rem.default_sha;
    let anyDiverge = false;
    for (const v of vals) {
      const rb = remBranch(v.branch);
      const remoteSha = rb ? rb.sha : null;
      if (remoteSha && v.head && remoteSha === v.head) { /* match */ }
      else { allMatchRemote = false; }
      if (v.unpushed > 0) anyDiverge = true;
    }
    const localInSync = heads.size === 1 && vals.length === hosts.length && vals.every(v => v.dirty === 0 && v.unpushed === 0 && v.behind === 0);
    const inSync = rem ? (localInSync && allMatchRemote) : localInSync;
    const statusBadge = inSync
      ? '<span class="git-sync ok">✓ 동기화됨</span>'
      : (anyDiverge ? '<span class="git-sync warn">⚠ 발산 위험</span>' : '<span class="git-sync warn">⚠ 불일치</span>');

    // Remote row
    let remoteRow = '';
    if (rem) {
      if (rem.error) {
        remoteRow = `<div class="git-host-row remote"><span class="git-os git-os-remote">원격</span><span class="git-host-name">GitHub</span><span class="git-miss">조회 오류: ${escape(rem.error)}</span></div>`;
      } else {
        const prBadge = (rem.open_prs && rem.open_prs.length) ? `<span class="git-flag pr">PR ${rem.open_prs.length}</span>` : '';
        remoteRow = `
          <div class="git-host-row remote">
            <span class="git-os git-os-remote">원격</span>
            <span class="git-host-name">GitHub</span>
            <span class="git-branch">${escape(rem.default_branch || '?')}</span>
            <span class="git-head" title="${escape(rem.default_sha)}">${escape((rem.default_sha || '').slice(0, 7))}</span>
            <span class="git-flags">${prBadge}</span>
          </div>`;
      }
    }

    let hostRows = '';
    for (const h of hosts) {
      const r = entry.hosts[h.host];
      if (!r) {
        hostRows += `<div class="git-host-row missing">${gitOsBadge(h.os)}<span class="git-host-name">${escape(h.host)}</span><span class="git-miss">이 호스트엔 없음</span></div>`;
        continue;
      }
      const flags = [];
      if (r.dirty > 0) flags.push(`<span class="git-flag dirty">dirty ${r.dirty}</span>`);
      if (r.unpushed > 0) flags.push(`<span class="git-flag unpushed">↑${r.unpushed} 미푸시</span>`);
      if (r.behind > 0) flags.push(`<span class="git-flag behind">↓${r.behind} 뒤처짐</span>`);
      if (r.stash > 0) flags.push(`<span class="git-flag stash">stash ${r.stash}</span>`);
      if (!r.upstream) flags.push(`<span class="git-flag noup">upstream 없음</span>`);
      // vs remote tip of the same branch
      const rb = remBranch(r.branch);
      if (rb) {
        if (rb.sha === r.head) flags.push('<span class="git-flag clean">= 원격</span>');
        else if (r.unpushed > 0) flags.push('<span class="git-flag unpushed">원격과 발산</span>');
        else flags.push('<span class="git-flag behind">원격과 다름</span>');
      } else if (rem && !rem.error) {
        flags.push('<span class="git-flag noup">원격에 브랜치 없음</span>');
      }
      if (flags.length === 0) flags.push('<span class="git-flag clean">clean</span>');
      hostRows += `
        <div class="git-host-row">
          ${gitOsBadge(r.os)}
          <span class="git-host-name">${escape(h.host)}</span>
          <span class="git-branch">${escape(r.branch)}</span>
          <span class="git-head" title="${escape(r.head)}">${escape((r.head || '').slice(0, 7))}</span>
          <span class="git-flags">${flags.join('')}</span>
        </div>`;
    }

    // PR detail lines
    let prRows = '';
    if (rem && rem.open_prs && rem.open_prs.length) {
      prRows = '<div class="git-prs">' + rem.open_prs.slice(0, 6).map(p =>
        `<div class="git-pr">#${p.number} <span class="git-pr-title">${escape(p.title)}</span> <span class="git-pr-branch">${escape(p.head)} → ${escape(p.base)}</span></div>`
      ).join('') + '</div>';
    }

    const card = document.createElement('div');
    card.className = 'git-repo' + (inSync ? '' : ' warn') + (entry.ownerRepo ? ' clickable' : '');
    const hint = entry.ownerRepo ? '<span class="git-repo-open">상세 보기 →</span>' : '';
    card.innerHTML = `<div class="git-repo-head"><span class="git-repo-name">${escape(entry.label)}</span>${hint}${statusBadge}</div>${remoteRow}${hostRows}${prRows}`;
    if (entry.ownerRepo) {
      card.addEventListener('click', () => openGitDetail(entry.ownerRepo));
    }
    $gitList.appendChild(card);
  }
}

// ─── Git repo detail (Sync Map / DAG) ──────────────────────────
async function openGitDetail(ownerRepo) {
  state.gitDetail = { ownerRepo, graph: null, branch: null, mode: 'lanes' };
  $gitDetailTitle.textContent = ownerRepo;
  $gitDetailBranch.innerHTML = '';
  $gitDetailSummary.innerHTML = '';
  if ($gitDetailMode) $gitDetailMode.innerHTML = `${svgIcon('terminal')}<span>Inspector</span>`;
  $gitDetailBody.innerHTML = '<div class="git-detail-loading">레포 상태 로드 중…</div>';
  $gitDetail.classList.remove('hidden');
  // Compute summary directly from snapshots (no API call needed for Layer 2).
  renderGitL2Lanes(ownerRepo);
}

// ─── Layer 2 — 3-column swimlanes ──────────────────────────────
function renderGitL2Lanes(ownerRepo) {
  const snaps = state.git.snapshots || [];
  const repoEntries = [];
  for (const s of snaps) {
    const r = (s.repos || []).find(r => r.owner_repo === ownerRepo);
    if (r) repoEntries.push({ host: s.host, os: s.os, scanned_at: s.scanned_at, repo: r });
  }
  if (!repoEntries.length) {
    $gitDetailBody.innerHTML = '<div class="git-detail-loading">이 레포의 스냅샷이 없어요.</div>';
    return;
  }
  const entry = { ownerRepo, label: ownerRepo, owner: ownerRepo.split('/')[0], ownerRepo, hosts: {} };
  for (const e of repoEntries) entry.hosts[e.host] = Object.assign({ os: e.os }, e.repo);
  const summary = gitRepoSummary(entry, snaps);
  const macHost = repoEntries.find(e => e.os === 'macos');
  const winHost = repoEntries.find(e => e.os === 'windows');
  const rem = state.git.remote[ownerRepo];
  const branches = new Set();
  for (const e of repoEntries) if (e.repo.branch) branches.add(e.repo.branch);
  if (rem && rem.branches) for (const b of rem.branches) if (b.name) branches.add(b.name);
  const branchList = [...branches];
  state.gitDetail.branch = state.gitDetail.branch || (rem?.default_branch && branchList.includes(rem.default_branch) ? rem.default_branch : branchList[0] || 'main');
  $gitDetailBranch.innerHTML = branchList.map(b => `<option value="${escape(b)}"${b===state.gitDetail.branch?' selected':''}>${escape(b)}</option>`).join('') || `<option>${escape(state.gitDetail.branch)}</option>`;
  $gitDetailBranch.title = state.gitDetail.branch || '';   // ADR-0002: tooltip for truncated long branch names

  // ahead/behind on connectors (Mac ↔ Origin, Origin ↔ Win)
  const macAhead  = macHost ? (macHost.repo.ahead || macHost.repo.unpushed || 0) : 0;
  const macBehind = macHost ? (macHost.repo.behind || 0) : 0;
  const winAhead  = winHost ? (winHost.repo.ahead || winHost.repo.unpushed || 0) : 0;
  const winBehind = winHost ? (winHost.repo.behind || 0) : 0;
  const macDirty  = macHost ? (macHost.repo.dirty || 0) : 0;
  const winDirty  = winHost ? (winHost.repo.dirty || 0) : 0;

  // ADR-0006: verdict-row — large chip + diagnostic sentence (verdict-action mapping).
  // Pass summary.kind so L1 ("충돌 임박") and L2 always agree on the verdict.
  const v = gitL2Verdict({ macHost, winHost, macAhead, macBehind, winAhead, winBehind, macDirty, winDirty, overlaps: summary.overlaps, summaryKind: summary.kind });
  $gitDetailSummary.innerHTML = `
    <span class="git-l2-verdict-chip ${v.kind}">${svgIcon(GIT_STATUS_ICON[v.kind])}<span>${escape(v.title)}</span></span>
    <div class="git-l2-verdict-text"><b>${escape(v.head)}</b>${v.desc ? `<span class="git-l2-verdict-sep">·</span>${escape(v.desc)}` : ''}</div>
  `;

  // ADR-0006: lane shell with absolute-positioned connector chips between lanes
  const macConn = gitL2Connector('mac', macAhead, macBehind);
  const winConn = gitL2Connector('win', winAhead, winBehind);

  // Footer meta
  const scanRel = macHost ? fmtRelative(macHost.scanned_at) : (winHost ? fmtRelative(winHost.scanned_at) : '—');
  const commitN = state.gitDetail.graph?.per_branch?.[state.gitDetail.branch]?.commits?.length || 0;
  const ancSha  = state.gitDetail.graph?.per_branch?.[state.gitDetail.branch]?.common_ancestor || '';
  const ancShort = ancSha ? ancSha.slice(0, 7) : '범위 밖';

  $gitDetailBody.innerHTML = `
    <div class="git-l2-shell">
      <div class="git-l2-connector c1 ${macConn.kind}">
        <div class="git-l2-connector-line"></div>
        <span class="git-l2-connector-chip ${macConn.kind}">${svgIcon(macConn.icon)}<span>${escape(macConn.text)}</span></span>
      </div>
      <div class="git-l2-connector c2 ${winConn.kind}">
        <div class="git-l2-connector-line"></div>
        <span class="git-l2-connector-chip ${winConn.kind}">${svgIcon(winConn.icon)}<span>${escape(winConn.text)}</span></span>
      </div>
      ${gitLaneCol(macHost, 'mac', 'apple', 'macOS 로컬', summary.overlaps, macAhead, macBehind)}
      ${gitLaneOrigin(rem, ownerRepo)}
      ${gitLaneCol(winHost, 'win', 'windows', 'Windows 로컬', summary.overlaps, winAhead, winBehind)}
    </div>
    <footer class="git-l2-footer">
      <div class="git-l2-footer-meta">
        <span class="git-l2-meta-item">${svgIcon('clock')}<span>${escape(scanRel)} 스캔</span></span>
        <span class="git-l2-meta-item">${svgIcon('git-commit')}<span>${commitN} 커밋 분석</span></span>
        <span class="git-l2-meta-item">${svgIcon('git-branch')}<span>공통 조상 <code class="mono">${escape(ancShort)}</code></span></span>
      </div>
      <div class="git-l2-footer-actions">
        <button class="git-l2-btn" id="git-l2-all-commits" type="button">전체 커밋 보기</button>
        <button class="git-l2-btn" id="git-l2-dag-toggle" type="button">DAG 보기</button>
        <button class="git-l2-btn primary" id="git-l2-sync" type="button">Sync 실행</button>
      </div>
      <div class="git-l2-ops" id="git-l2-ops">
        <button class="git-l2-btn" data-op="fetch" type="button">Fetch</button>
        <button class="git-l2-btn" data-op="pull" type="button">Pull</button>
        <button class="git-l2-btn" data-op="push" type="button">Push</button>
        <button class="git-l2-btn" data-op="stash" type="button">Stash</button>
        <button class="git-l2-btn" data-op="stash_pop" type="button">Stash Pop</button>
        <span class="git-l2-opresult" id="git-l2-opresult"></span>
      </div>
    </footer>
  `;

  // ADR-0006: footer action button handlers
  const allBtn  = $gitDetailBody.querySelector('#git-l2-all-commits');
  const dagBtn  = $gitDetailBody.querySelector('#git-l2-dag-toggle');
  const syncBtn = $gitDetailBody.querySelector('#git-l2-sync');
  if (allBtn) allBtn.addEventListener('click', () => {
    state.gitDetail.mode = 'syncmap';
    renderGitDetailBody();
  });
  if (dagBtn) dagBtn.addEventListener('click', () => {
    state.gitDetail.mode = state.gitDetail.mode === 'dag' ? 'lanes' : 'dag';
    if (state.gitDetail.mode === 'lanes') {
      renderGitL2Lanes(ownerRepo);
    } else {
      renderGitDetailBody();
    }
  });
  if (syncBtn) syncBtn.addEventListener('click', () => {
    toast('Sync 자동 실행은 Stage 4 (직결 트리거)에서 추가됩니다 — 우선 아래 Fetch/Pull/Push 사용', 'info');
  });

  // G1: interactive git ops on the local (Windows) repo for this owner/repo.
  const winRepoPath = (winHost && winHost.repo && winHost.repo.path)
    ? winHost.repo.path
    : gitRepoPathForHost(ownerRepo, 'windows');
  const opResult = $gitDetailBody.querySelector('#git-l2-opresult');
  const opCmd = {
    fetch: 'git_op_fetch', pull: 'git_op_pull', push: 'git_op_push',
    stash: 'git_op_stash', stash_pop: 'git_op_stash_pop',
  };
  $gitDetailBody.querySelectorAll('.git-l2-ops [data-op]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!winRepoPath) { toast('Windows 로컬 레포 경로를 찾을 수 없어요', 'error'); return; }
      const op = btn.dataset.op;
      btn.disabled = true;
      try {
        const r = await invoke(opCmd[op], { repoPath: winRepoPath });
        const raw = r.ok ? (r.stdout || '완료') : (r.stderr || '실패');
        const summary = raw.split('\n')[0].slice(0, 120);
        if (opResult) opResult.textContent = `[방금] ${op}: ${summary}`;
        toast(`${op} ${r.ok ? '성공' : '실패'}: ${summary}`, r.ok ? 'success' : 'error');
      } catch (e) {
        if (opResult) opResult.textContent = `[방금] ${op}: ${e}`;
        toast(`${op} 오류: ${e}`, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  });
}

// ADR-0006: verdict-action mapping (same rules as computeGitNarrative).
// summaryKind comes from gitRepoSummary (L1 logic) so L1/L2 always agree.
function gitL2Verdict(ctx) {
  const { macHost, winHost, macAhead, macBehind, winAhead, winBehind, macDirty, winDirty, overlaps, summaryKind } = ctx;
  if (summaryKind === 'conflict' || (overlaps && overlaps.length)) {
    const fileCount = overlaps ? overlaps.length : 0;
    const headTxt = fileCount > 0
      ? `양쪽에서 같은 파일 ${fileCount}개 동시 수정 중`
      : '양쪽 머신에서 동일 파일 수정 가능성';
    return { kind: 'conflict', title: '충돌 임박', head: headTxt, desc: '머지 전 정리 필요 — Resolver 또는 충돌 레이더 사용' };
  }
  if (macAhead && winAhead) {
    return { kind: 'diverged', title: '양쪽 발산', head: `Mac ↑${macAhead} / Win ↑${winAhead}`, desc: '양쪽 미푸시 — 통합 결정 후 한쪽씩 push' };
  }
  if (macAhead) {
    return { kind: 'diverged', title: '발산', head: `Mac이 origin보다 ${macAhead} 커밋 앞섬`, desc: winHost ? 'Win은 origin과 동기화됨 · Mac에서 push 후 Win에서 pull' : 'Mac에서 push 권장 (Win 스캔 데이터 없음)' };
  }
  if (winAhead) {
    return { kind: 'diverged', title: '발산', head: `Win이 origin보다 ${winAhead} 커밋 앞섬`, desc: macHost ? 'Mac은 깨끗하고 동기화됨 · Win에서 push 권장' : 'Win에서 push 권장 (Mac 스캔 데이터 없음)' };
  }
  if (macBehind || winBehind) {
    const pulls = [];
    if (macBehind) pulls.push(`Mac ↓${macBehind}`);
    if (winBehind) pulls.push(`Win ↓${winBehind}`);
    return { kind: 'diverged', title: '뒤처짐', head: pulls.join(', ') + ' pull 필요', desc: pulls.length === 2 ? '양쪽 모두 git pull 권장' : `${pulls[0].split(' ')[0]}에서 git pull 권장` };
  }
  if (macDirty || winDirty) {
    return { kind: 'diverged', title: '미커밋 변경', head: `로컬 변경 ${macDirty + winDirty}개`, desc: '로컬 변경 커밋 후 push 권장' };
  }
  if (!macHost && !winHost) {
    return { kind: 'partial', title: '데이터 없음', head: '호스트 스캔 데이터가 없습니다', desc: '"지금 스캔"으로 로컬 git 상태를 게시하세요' };
  }
  return { kind: 'synced', title: '동기화됨', head: '모든 호스트가 origin과 일치', desc: '안전하게 작업을 시작할 수 있습니다' };
}

// ADR-0006: connector chip between two lanes
function gitL2Connector(host, ahead, behind) {
  const label = host === 'mac' ? 'Mac' : 'Win';
  if (!ahead && !behind) return { kind: 'synced', icon: 'check-circle-2', text: '동기화' };
  if (ahead && behind)   return { kind: 'diverged', icon: 'alert-triangle', text: `${label} ↑${ahead} ↓${behind}` };
  if (ahead)             return { kind: 'diverged', icon: 'arrow-up',       text: `${label} ↑ ${ahead}` };
  return                        { kind: 'diverged', icon: 'arrow-down',     text: `${label} ↓ ${behind}` };
}

function gitConnectorBar(ma, mb, wa, wb) {
  const macSummary = (!ma && !mb)
    ? `<span class="conn-eq">${svgIcon('check-circle-2')}<span>동기화</span></span>`
    : `${ma ? `<span class="conn-up">${svgIcon('arrow-up')}${ma}</span>` : ''}${mb ? `<span class="conn-down">${svgIcon('arrow-down')}${mb}</span>` : ''}`;
  const winSummary = (!wa && !wb)
    ? `<span class="conn-eq">${svgIcon('check-circle-2')}<span>동기화</span></span>`
    : `${wa ? `<span class="conn-up">${svgIcon('arrow-up')}${wa}</span>` : ''}${wb ? `<span class="conn-down">${svgIcon('arrow-down')}${wb}</span>` : ''}`;
  return `
    <div class="git-l2-connbar">
      <span class="conn-label mac">${svgIcon('apple')}<span>Mac</span></span>
      <span class="conn-arrows mac">${macSummary}</span>
      <span class="conn-mid">${svgIcon('github')}<span>Origin</span></span>
      <span class="conn-arrows win">${winSummary}</span>
      <span class="conn-label win">${svgIcon('windows')}<span>Win</span></span>
    </div>`;
}

function gitLaneCol(hostEntry, key, iconName, label, overlaps, ahead, behind) {
  if (!hostEntry) {
    return `<section class="git-lane ${key} off">
      <header class="lane-head">
        <span class="lane-icon">${svgIcon(iconName)}</span>
        <div class="lane-meta">
          <h3 class="lane-title">${escape(label)}</h3>
          <div class="lane-sub">연결되지 않음</div>
        </div>
      </header>
      <div class="lane-body empty">
        <div class="empty-pad">${svgIcon('circle-dot')}<div>이 호스트엔 이 레포가 없어요</div></div>
      </div>
    </section>`;
  }
  const repo = hostEntry.repo;
  const dirty = repo.dirty_files || [];
  const dirtyHtml = dirty.length ? dirty.map(df => {
    const name = gitDirtyFileName(df);
    const isConflict = overlaps.includes(name);
    return `<li class="lane-file${isConflict ? ' conflict' : ''}">
      <span class="lane-file-ic">${svgIcon(isConflict ? 'file-warning' : 'file-code')}</span>
      <span class="lane-file-name${isConflict ? ' bold' : ''}" title="${escape(df)}">${escape(name)}</span>
      ${isConflict ? `<span class="lane-file-tag">CONFLICT</span>` : ''}
    </li>`;
  }).join('') : `<li class="lane-empty">${svgIcon('check-circle-2')}<span>변경 없음</span></li>`;

  const unpushedCount = repo.unpushed || repo.ahead || 0;
  const stashCount = repo.stash || 0;
  return `
    <section class="git-lane ${key}">
      <header class="lane-head">
        <span class="lane-icon">${svgIcon(iconName)}</span>
        <div class="lane-meta">
          <h3 class="lane-title">${escape(label)}</h3>
          <div class="lane-sub"><span class="lane-host">${escape(hostEntry.host)}</span><span class="lane-sep">·</span><span class="mono">${escape((repo.head || '').slice(0,7))}</span></div>
        </div>
        <div class="lane-tags">
          ${ahead ? `<span class="git-tag ${key}-tag">${svgIcon('arrow-up')}${ahead}</span>` : ''}
          ${behind ? `<span class="git-tag warn-tag">${svgIcon('arrow-down')}${behind}</span>` : ''}
        </div>
      </header>
      <div class="lane-body">
        <h4 class="lane-section">${svgIcon('file-diff')}<span>Work In Progress</span><span class="lane-count">${dirty.length}</span></h4>
        <ul class="lane-files">${dirtyHtml}</ul>
        ${unpushedCount ? `
          <h4 class="lane-section">${svgIcon('git-commit')}<span>미푸시 커밋</span><span class="lane-count">${unpushedCount}</span></h4>
          <ul class="lane-files"><li class="lane-info">${svgIcon('arrow-up')}<span>${unpushedCount}개 로컬에서 커밋했지만 origin엔 없음</span></li></ul>` : ''}
        ${stashCount ? `
          <h4 class="lane-section">${svgIcon('package')}<span>Stash</span><span class="lane-count">${stashCount}</span></h4>
          <ul class="lane-files"><li class="lane-info">${svgIcon('package')}<span>${stashCount}개 보관됨</span></li></ul>` : ''}
      </div>
    </section>`;
}

function gitLaneOrigin(rem, ownerRepo) {
  const tip = rem?.default_sha ? rem.default_sha.slice(0, 7) : '—';
  const def = rem?.default_branch || 'main';
  const prs = rem?.open_prs || [];
  const prRows = prs.slice(0, 5).map(p => `
    <li class="lane-info lane-pr">
      <span class="lane-pr-num">#${p.number}</span>
      <span class="lane-pr-title">${escape(p.title)}</span>
      <span class="lane-pr-branch mono">${escape(p.head)} → ${escape(p.base)}</span>
    </li>`).join('');
  return `
    <section class="git-lane remote">
      <header class="lane-head">
        <span class="lane-icon">${svgIcon('github')}</span>
        <div class="lane-meta">
          <h3 class="lane-title">GitHub Origin</h3>
          <div class="lane-sub"><span class="lane-host">${escape(def)}</span><span class="lane-sep">·</span><span class="mono">${escape(tip)}</span></div>
        </div>
        ${prs.length ? `<span class="git-tag remote-tag">${svgIcon('gitfork')}PR ${prs.length}</span>` : ''}
      </header>
      <div class="lane-body lane-origin">
        <div class="origin-tip">
          <div class="origin-dot"></div>
          <div class="origin-card">
            <div class="origin-sha mono">${escape(tip)}</div>
            <div class="origin-msg">${escape(rem?.error || (def + ' 최신 커밋'))}</div>
          </div>
        </div>
        ${prs.length ? `
          <h4 class="lane-section">${svgIcon('gitfork')}<span>열린 PR</span><span class="lane-count">${prs.length}</span></h4>
          <ul class="lane-files">${prRows}</ul>` : ''}
      </div>
    </section>`;
}

// ─── Layer 3 — Raw Data Inspector (dark) ───────────────────────
const GIT_INSPECTOR_TABS = [
  { id: 'diffs',    label: 'Raw Diffs',     icon: 'file-diff' },
  { id: 'logs',     label: 'Daemon Logs',   icon: 'activity' },
  { id: 'config',   label: 'Git Config',    icon: 'settings' },
  { id: 'commits',  label: 'All Commits',   icon: 'list-tree' },
  { id: 'timeline', label: 'Sync Timeline', icon: 'git-branch' },
];

async function openGitInspector(ownerRepo) {
  state.gitInspector = { ownerRepo, tab: 'diffs' };
  $gitInspectorTitle.innerHTML = `<span class="gi-title-ic">${svgIcon('terminal')}</span><span class="gi-title-repo mono">${escape(ownerRepo)}</span><span class="gi-title-sep">/</span><span class="gi-title-label">Inspector</span>`;
  $gitInspectorTabs.innerHTML = `<div class="gi-tabs-head">DATA CATEGORIES</div>` + GIT_INSPECTOR_TABS.map(t =>
    `<button class="gi-tab" data-tab="${t.id}"><span class="gi-tab-ic">${svgIcon(t.icon)}</span><span>${escape(t.label)}</span></button>`
  ).join('');
  $gitInspectorTabs.querySelectorAll('.gi-tab').forEach(el => {
    el.addEventListener('click', () => {
      state.gitInspector.tab = el.getAttribute('data-tab');
      renderGitInspectorTab();
    });
  });
  $gitInspector.classList.remove('hidden');
  renderGitInspectorTab();
}

async function renderGitInspectorTab() {
  const { ownerRepo, tab } = state.gitInspector;
  $gitInspectorTabs.querySelectorAll('.gi-tab').forEach(el => {
    el.classList.toggle('active', el.getAttribute('data-tab') === tab);
  });
  $gitInspectorBody.innerHTML = '<div class="gi-loading">로드 중…</div>';
  try {
    if (tab === 'diffs')         await renderGIDiffs(ownerRepo);
    else if (tab === 'logs')     await renderGILogs(ownerRepo);
    else if (tab === 'config')   await renderGIConfig(ownerRepo);
    else if (tab === 'commits')  await renderGICommits(ownerRepo);
    else if (tab === 'timeline') await renderGITimeline(ownerRepo);
  } catch (e) {
    $gitInspectorBody.innerHTML = `<div class="gi-loading">실패: ${escape(String(e))}</div>`;
  }
}

function gitRepoPathForHost(ownerRepo, os) {
  const snap = (state.git.snapshots || []).find(s => s.os === os);
  if (!snap) return null;
  const r = (snap.repos || []).find(r => r.owner_repo === ownerRepo);
  return r ? r.path : null;
}

async function renderGIDiffs(ownerRepo) {
  // Show working diff for the FIRST host that has this repo (prefer windows host since we're on it).
  const winPath = gitRepoPathForHost(ownerRepo, 'windows');
  const macPath = gitRepoPathForHost(ownerRepo, 'macos');
  const path = winPath || macPath;
  if (!path) { $gitInspectorBody.innerHTML = '<div class="gi-loading">이 머신엔 이 레포 없음.</div>'; return; }
  // Find dirty files from this host's snapshot
  const snap = state.git.snapshots.find(s => s.os === (winPath ? 'windows' : 'macos'));
  const r = (snap?.repos || []).find(r => r.owner_repo === ownerRepo);
  const dirty = (r?.dirty_files || []).map(gitDirtyFileName).filter(Boolean).slice(0, 8);
  if (dirty.length === 0) {
    $gitInspectorBody.innerHTML = '<div class="gi-empty">변경된 파일이 없습니다 — diff 없음</div>';
    return;
  }
  let out = `<div class="gi-diffs">`;
  for (const file of dirty) {
    let diff = '';
    try { diff = await invoke('git_file_diff', { repoPath: path, file, side: 'working' }); } catch (_) {}
    out += `
      <div class="gi-diff-card">
        <header class="gi-diff-head">${svgIcon('file-code')}<span class="mono">${escape(file)}</span></header>
        <pre class="gi-diff-pre">${gitColorDiff(diff || '(no diff hunks)')}</pre>
      </div>`;
  }
  out += '</div>';
  $gitInspectorBody.innerHTML = out;
}
function gitColorDiff(text) {
  return text.split('\n').map(line => {
    let cls = 'd-ctx';
    if (line.startsWith('+++') || line.startsWith('---')) cls = 'd-meta';
    else if (line.startsWith('@@')) cls = 'd-hunk';
    else if (line.startsWith('+')) cls = 'd-add';
    else if (line.startsWith('-')) cls = 'd-del';
    return `<span class="${cls}">${escape(line)}</span>`;
  }).join('\n');
}

async function renderGILogs(ownerRepo) {
  // Pull recent send/recv/error/worklog entries; filter mentions of this repo if possible.
  let lines = [];
  const cats = ['recv', 'send', 'error', 'worklog'];
  for (const c of cats) {
    try {
      const entries = await invoke('list_log_entries', { category: c, limit: 50 });
      for (const e of (entries || [])) {
        const ts = e.ts || '';
        const level = e.event && e.event.includes('fail') ? 'ERROR'
                    : e.event && e.event.includes('ok') ? 'SUCCESS'
                    : 'INFO';
        const main = e.summary || e.event || JSON.stringify(e).slice(0, 120);
        lines.push({ ts, level, cat: c, main });
      }
    } catch (_) {}
  }
  lines.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
  lines = lines.slice(0, 80);
  if (lines.length === 0) lines = [{ ts: new Date().toISOString(), level: 'INFO', cat: 'sys', main: '아직 로그가 없습니다.' }];
  $gitInspectorBody.innerHTML = `
    <div class="gi-logs">
      ${lines.map(l => {
        const lc = l.level === 'ERROR' ? 'l-err' : l.level === 'SUCCESS' ? 'l-ok' : 'l-info';
        return `<div class="gi-log-line"><span class="l-ts">${escape(l.ts.slice(11, 19))}</span><span class="l-lvl ${lc}">${escape(l.level)}</span><span class="l-cat">${escape(l.cat.toUpperCase())}</span><span class="l-msg">${escape(l.main)}</span></div>`;
      }).join('')}
      <div class="gi-log-tail">_ waiting for new logs…</div>
    </div>`;
}

async function renderGIConfig(ownerRepo) {
  const winPath = gitRepoPathForHost(ownerRepo, 'windows');
  const macPath = gitRepoPathForHost(ownerRepo, 'macos');
  const path = winPath || macPath;
  if (!path) { $gitInspectorBody.innerHTML = '<div class="gi-loading">이 머신엔 이 레포 없음.</div>'; return; }
  let conf = '';
  try { conf = await invoke('git_config_read', { repoPath: path }); } catch (e) { conf = '(read failed: ' + e + ')'; }
  $gitInspectorBody.innerHTML = `
    <div class="gi-config">
      <div class="gi-config-path">${svgIcon('settings')}<span class="mono">${escape(path)}/.git/config</span></div>
      <pre class="gi-config-pre">${escape(conf)}</pre>
    </div>`;
}

async function renderGICommits(ownerRepo) {
  // Build a unified commit table from per-host git-log.json + remote cache
  let commits = [];
  try {
    const docs = await invoke('list_git_logs');
    for (const [host, doc] of Object.entries(docs || {})) {
      const repoLogs = doc?.logs?.[ownerRepo];
      if (!repoLogs) continue;
      for (const [branch, arr] of Object.entries(repoLogs)) {
        for (const c of arr) commits.push({ ...c, host, branch });
      }
    }
  } catch (_) {}
  // dedup by sha (keep first)
  const seen = new Set(); const dedup = [];
  for (const c of commits) { if (!seen.has(c.sha)) { seen.add(c.sha); dedup.push(c); } }
  dedup.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (!dedup.length) { $gitInspectorBody.innerHTML = '<div class="gi-empty">아직 커밋 로그가 없습니다 — "지금 스캔"으로 생성하세요</div>'; return; }
  $gitInspectorBody.innerHTML = `
    <div class="gi-commits">
      <table class="gi-table">
        <thead><tr><th>SHA</th><th>Message</th><th>Branch</th><th>Author</th><th>Date</th></tr></thead>
        <tbody>
          ${dedup.slice(0, 200).map(c => `
            <tr>
              <td class="d-add mono">${escape(c.sha.slice(0,7))}</td>
              <td>${escape(c.msg || '')}</td>
              <td class="d-meta">${escape(c.branch || '')}</td>
              <td class="d-meta">${escape(c.author || '')}</td>
              <td class="d-meta">${escape(fmtRelative(c.date))}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// Best-effort: overlay a small CI status badge on each commit dot using the
// shared PAT. No token / API error → bare dots (no throw). M5 / F-6.
async function overlayCheckRuns(ownerRepo, commits) {
  const shas = (commits || []).map(c => c.sha).filter(Boolean);
  if (!shas.length) return;
  let runs;
  try {
    runs = await invoke('github_fetch_check_runs', { ownerRepo, shas });
  } catch (_) {
    return;
  }
  const CI_COLOR = {
    success: '#2DA44E', failure: '#D11A2A', pending: '#D4A72C', neutral: '#8A8E97', error: '#8A8E97',
  };
  const NS = 'http://www.w3.org/2000/svg';
  $gitInspectorBody.querySelectorAll('.gtl-river svg circle[data-sha]').forEach(el => {
    const sha = el.getAttribute('data-sha');
    const s = runs[sha];
    if (!s || !s.overall || s.overall === 'none') return;
    const color = CI_COLOR[s.overall];
    if (!color) return;
    const svg = el.ownerSVGElement;
    if (!svg) return;
    const cx = parseFloat(el.getAttribute('cx'));
    const cy = parseFloat(el.getAttribute('cy'));
    const r = parseFloat(el.getAttribute('r'));
    const badge = document.createElementNS(NS, 'circle');
    badge.setAttribute('cx', cx + r);
    badge.setAttribute('cy', cy - r);
    badge.setAttribute('r', '3');
    badge.setAttribute('fill', color);
    badge.setAttribute('stroke', '#FFFFFF');
    badge.setAttribute('stroke-width', '1.5');
    badge.setAttribute('pointer-events', 'none');
    const title = document.createElementNS(NS, 'title');
    title.textContent = `CI: ${s.overall} (✓${s.success} ✗${s.failure} ⏳${s.in_progress})`;
    badge.appendChild(title);
    svg.appendChild(badge);
  });
}

async function renderGITimeline(ownerRepo) {
  // ADR-0004: 3-panel narrative — Status Summary + Graph + Selected Commit
  $gitInspectorBody.innerHTML = '<div class="gi-loading">3-소스 그래프 계산 중…</div>';
  try {
    const graph = await invoke('build_repo_graph', { ownerRepo });
    const branches = graph.branches || [];
    const branch = (graph.default_branch && branches.includes(graph.default_branch)) ? graph.default_branch : branches[0];
    const pb = (graph.per_branch || {})[branch];
    if (!pb) { $gitInspectorBody.innerHTML = '<div class="gi-empty">데이터 없음</div>'; return; }

    const narrative = computeGitNarrative(graph, pb, branch);
    const initialCommit = (pb.commits || []).find(c => c.ancestor) || (pb.commits || [])[0];

    $gitInspectorBody.innerHTML = `
      <div class="gi-timeline">
        ${renderTimelineStatus(narrative, graph, pb, branch)}
        ${renderTimelineGraph(gitTimelineSVG(pb, graph), ownerRepo, branch)}
        ${renderTimelineDetail(initialCommit, graph)}
      </div>`;

    // Wire dot clicks → update Panel 3
    $gitInspectorBody.querySelectorAll('.gtl-river svg circle[data-sha]').forEach(el => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => {
        const sha = el.getAttribute('data-sha');
        const c = (pb.commits || []).find(x => x.sha === sha);
        if (c) updateTimelineDetail(c, graph);
      });
    });

    // M5: overlay CI check-run badges (best-effort; needs PAT).
    overlayCheckRuns(ownerRepo, pb.commits).catch(() => {});
  } catch (e) {
    $gitInspectorBody.innerHTML = `<div class="gi-loading">실패: ${escape(String(e))}</div>`;
  }
}

function computeGitNarrative(graph, pb, branch) {
  const hosts = graph.hosts || [];
  const summary = pb.summary || {};
  const macHost = hosts.find(h => h.os === 'macos');
  const winHost = hosts.find(h => h.os === 'windows');
  const macSum = macHost ? summary[macHost.host] : null;
  const winSum = winHost ? summary[winHost.host] : null;

  const macA = macSum?.ahead || 0, macB = macSum?.behind || 0;
  const winA = winSum?.ahead || 0, winB = winSum?.behind || 0;
  const hasRemote = macSum?.has_remote || winSum?.has_remote || pb.pointers?.remote;
  const macMeta = macHost ? gitDetailHostMeta(macHost.host) : null;
  const winMeta = winHost ? gitDetailHostMeta(winHost.host) : null;
  const macDirty = macMeta?.dirty || 0;
  const winDirty = winMeta?.dirty || 0;
  const dirtyOverlap = macDirty && winDirty; // approximate; per-file overlap is in dashboard

  let verdict, kind, action;
  if (!macHost && !winHost) {
    verdict = '호스트 데이터가 없습니다'; kind = 'partial';
    action = '"지금 스캔" 으로 로컬 git 상태를 게시하세요';
  } else if (!hasRemote) {
    verdict = '원격 상태 미확인'; kind = 'partial';
    action = '대시보드의 "원격 동기화" 버튼으로 GitHub API 조회';
  } else if (dirtyOverlap) {
    verdict = `충돌 임박 · 양쪽에서 같은 파일 수정 중`; kind = 'danger';
    action = '대시보드의 "충돌 레이더" 또는 Resolver 로 파일 단위 결정';
  } else if (macA && winA) {
    verdict = `양쪽 발산 · Mac ↑${macA} / Win ↑${winA}`; kind = 'danger';
    action = '양쪽 미푸시 — 통합 결정 후 한쪽씩 push';
  } else if (macA) {
    verdict = `Mac이 origin보다 ${macA}커밋 앞섬`; kind = 'warn';
    action = winHost
      ? `Mac에서 git push 후 Win에서 git pull`
      : `Mac에서 git push (Win 스캔 데이터 없음)`;
  } else if (winA) {
    verdict = `Win이 origin보다 ${winA}커밋 앞섬`; kind = 'warn';
    action = macHost
      ? `Win에서 git push 후 Mac에서 git pull`
      : `Win에서 git push (Mac 스캔 데이터 없음)`;
  } else if (macB || winB) {
    const pulls = [];
    if (macB) pulls.push(`Mac (↓${macB})`);
    if (winB) pulls.push(`Win (↓${winB})`);
    verdict = `뒤처짐 · ${pulls.join(', ')}`; kind = 'warn';
    action = pulls.length === 2 ? '양쪽 모두 git pull 권장' : `${pulls[0].split(' ')[0]}에서 git pull`;
  } else if (macDirty || winDirty) {
    verdict = `동기화됨 · 미커밋 변경 ${macDirty + winDirty}개`; kind = 'warn';
    action = '로컬 변경사항을 커밋 후 push 권장';
  } else {
    verdict = '모든 호스트가 origin과 일치'; kind = 'synced';
    action = '추가 작업 필요 없음 — 모두 동기화됨';
  }

  return { verdict, kind, action, macHost, winHost, macSum, winSum, macMeta, winMeta };
}

function renderTimelineStatus(n, graph, pb, branch) {
  const kindIcon = { synced: 'check-circle-2', warn: 'alert-triangle', danger: 'shield-alert', partial: 'circle-dot' };
  const lcaSha = pb.common_ancestor ? pb.common_ancestor.slice(0, 7) : '범위 밖';
  return `
    <section class="gtl-status gtl-status-${n.kind}">
      <header class="gtl-status-head">
        <span class="gtl-status-icon">${svgIcon(kindIcon[n.kind])}</span>
        <div>
          <h3 class="gtl-status-title">${escape(n.verdict)}</h3>
          <div class="gtl-status-sub">${escape(branch)} 브랜치 · 공통 조상 <span class="mono">${escape(lcaSha)}</span></div>
        </div>
      </header>
      <div class="gtl-status-rows">
        ${gtlHostRow('remote', 'github', 'GitHub origin', pb.pointers?.remote, null, null)}
        ${n.macHost ? gtlHostRow('mac', 'apple', n.macHost.host, pb.pointers?.[n.macHost.host], n.macSum, n.macMeta) : gtlHostRowOff('mac', 'macOS')}
        ${n.winHost ? gtlHostRow('win', 'windows', n.winHost.host, pb.pointers?.[n.winHost.host], n.winSum, n.winMeta) : gtlHostRowOff('win', 'Windows')}
      </div>
      ${n.action ? `
        <div class="gtl-action">
          ${svgIcon('zap')}<span class="gtl-action-text">${escape(n.action)}</span>
        </div>` : ''}
    </section>`;
}

function gtlHostRow(cls, iconKey, host, sha, sum, meta) {
  const chips = [];
  if (sum) {
    if (sum.ahead)  chips.push(`<span class="gtl-chip ahead">${svgIcon('arrow-up')}${sum.ahead}</span>`);
    if (sum.behind) chips.push(`<span class="gtl-chip behind">${svgIcon('arrow-down')}${sum.behind}</span>`);
    if (!sum.ahead && !sum.behind && sum.has_remote) chips.push(`<span class="gtl-chip eq">${svgIcon('check-circle-2')}<span>origin과 동일</span></span>`);
  }
  if (cls === 'remote' && !chips.length) chips.push(`<span class="gtl-chip remote-tag">${svgIcon('git-branch')}<span>기준</span></span>`);
  if (meta) {
    if (meta.dirty) chips.push(`<span class="gtl-chip dirty">dirty ${meta.dirty}</span>`);
    if (meta.unpushed) chips.push(`<span class="gtl-chip ahead">미푸시 ${meta.unpushed}</span>`);
    if (meta.stash) chips.push(`<span class="gtl-chip muted">stash ${meta.stash}</span>`);
  }
  return `
    <div class="gtl-row gtl-row-${cls}">
      <span class="gtl-row-ic">${svgIcon(iconKey)}</span>
      <span class="gtl-row-name">${escape(host)}</span>
      <span class="gtl-row-sha mono">${escape((sha || '').slice(0, 7) || '—')}</span>
      <span class="gtl-row-chips">${chips.join('')}</span>
    </div>`;
}

function gtlHostRowOff(cls, label) {
  const iconKey = cls === 'mac' ? 'apple' : 'windows';
  return `
    <div class="gtl-row gtl-row-${cls} off">
      <span class="gtl-row-ic">${svgIcon(iconKey)}</span>
      <span class="gtl-row-name">${escape(label)} <span class="gtl-row-off">(스캔 데이터 없음)</span></span>
      <span class="gtl-row-sha mono">—</span>
      <span class="gtl-row-chips"><span class="gtl-chip muted">단일 호스트</span></span>
    </div>`;
}

function renderTimelineGraph(svg, ownerRepo, branch) {
  return `
    <section class="gtl-graph">
      <header class="gtl-graph-head">
        <span class="mono">${escape(ownerRepo)}</span>
        <span class="gtl-sep">·</span>
        <span>${escape(branch)}</span>
        <span class="gtl-spacer"></span>
        <span class="gtl-hint">점에 hover · 클릭하면 아래에 상세 표시</span>
      </header>
      <div class="gtl-river">${svg}</div>
    </section>`;
}

function renderTimelineDetail(c, graph) {
  return `
    <section class="gtl-detail">
      <header class="gtl-detail-head">${svgIcon('git-commit')}<span>선택된 커밋</span></header>
      ${c ? gitTimelineDetailBody(c, graph) : `<div class="gtl-detail-body empty">위 그래프의 점을 클릭하면 상세 정보가 표시돼요.</div>`}
    </section>`;
}

function gitTimelineDetailBody(c, graph) {
  const sources = c.in || {};
  const present = Object.entries(sources).filter(([_, v]) => v).map(([k]) => k);
  const tipPills = (c.tips || []).map(t => {
    const os = (graph.hosts || []).find(h => h.host === t)?.os || '';
    const cls = t === 'remote' ? 'remote' : os === 'macos' ? 'mac' : 'win';
    const lbl = t === 'remote' ? 'origin/' + (graph.default_branch || 'main') : t + ' HEAD';
    return `<span class="gtl-chip tip-${cls}">${escape(lbl)}</span>`;
  }).join('');
  return `
    <div class="gtl-detail-body">
      <div class="gtl-detail-row">
        <span class="gtl-detail-sha mono">${escape(c.sha)}</span>
        ${c.ancestor ? `<span class="gtl-chip lca">⊥ 공통 조상</span>` : ''}
        ${tipPills}
      </div>
      <div class="gtl-detail-msg">${escape(c.msg || '(메시지 없음)')}</div>
      <div class="gtl-detail-meta">
        <span>${escape(c.author || '')}</span>
        <span class="gtl-sep">·</span>
        <span>${escape(fmtRelative(c.date))}</span>
        <span class="gtl-spacer"></span>
        <span class="gtl-detail-sources">존재: ${present.map(s => {
          const os = (graph.hosts || []).find(h => h.host === s)?.os || '';
          const cls = s === 'remote' ? 'remote' : os === 'macos' ? 'mac' : 'win';
          return `<span class="gtl-src-pill ${cls}">${escape(s)}</span>`;
        }).join('')}</span>
      </div>
    </div>`;
}

function updateTimelineDetail(c, graph) {
  const det = document.querySelector('.gtl-detail');
  if (!det) return;
  det.querySelectorAll('.gtl-detail-body').forEach(b => b.remove());
  det.insertAdjacentHTML('beforeend', gitTimelineDetailBody(c, graph));
}

function gitTimelineSVG(pb, graph) {
  // ADR-0003: Light theme · 200px label area · full-width usage · no truncation.
  const srcKeys = ['remote', ...(graph.hosts || []).map(h => h.host)];
  const all = [...(pb.commits || [])].reverse();
  let start = 0;
  const ancFromOld = all.findIndex(c => c.ancestor);
  if (ancFromOld >= 0) start = Math.max(0, ancFromOld - 2);
  const win = all.slice(start);
  const n = win.length;
  if (n === 0) return '<div class="gi-empty">커밋 없음</div>';

  const lanes = srcKeys.map((k, idx) => {
    const os = (graph.hosts || []).find(h => h.host === k)?.os || '';
    const cls = k === 'remote' ? 'remote' : os === 'macos' ? 'mac' : 'win';
    return { key: k, idx, label: k === 'remote' ? 'GitHub' : k, cls, os };
  });

  // ── Layout: light, generous spacing
  const padL = 220;     // 200px label + 20 padding (ADR-0003 fix)
  const padR = 360;     // room for tip pills (ADR-0004: avoid right clip)
  const padT = 56;      // room for LCA label above first lane
  const padB = 32;
  const laneH = 86;     // each lane breathes (was 60)
  const dotR = 9;
  const xStep = 52;     // commit spacing (was 38)
  const W = padL + padR + Math.max(1, n - 1) * xStep + 80;
  const H = padT + lanes.length * laneH + padB;
  const xAt = i => padL + i * xStep;
  const yAt = li => padT + li * laneH + laneH / 2;

  // Light palette
  const COLOR = { remote: '#6E40C9', mac: '#2563EB', win: '#0F766E' };
  const LANE_BG = {
    remote: 'rgba(110,64,201,0.07)',
    mac:    'rgba(37,99,235,0.07)',
    win:    'rgba(15,118,110,0.07)',
  };
  const ICON_SVG = {
    apple:   '<path d="M16.06 13.06c-.03-2.66 2.17-3.93 2.27-3.99-1.23-1.8-3.16-2.05-3.84-2.08-1.64-.17-3.19.97-4.02.97-.83 0-2.11-.94-3.46-.92-1.78.03-3.41 1.03-4.33 2.62-1.84 3.2-.47 7.94 1.33 10.54.88 1.27 1.93 2.7 3.31 2.65 1.33-.05 1.83-.86 3.44-.86 1.6 0 2.05.86 3.46.83 1.43-.02 2.34-1.29 3.22-2.57 1.01-1.47 1.43-2.91 1.46-2.98-.03-.01-2.8-1.07-2.84-4.23zM13.93 5.4c.72-.88 1.21-2.09 1.07-3.31-1.04.05-2.32.7-3.07 1.56-.67.76-1.26 2-1.1 3.17 1.17.09 2.37-.59 3.1-1.42z"/>',
    windows: '<path d="M3 5.48 10.5 4.4v7.7H3V5.48zm0 13.04v-6.34h7.5v7.42L3 18.52zm8.5-7.42V4.2L21 2.8v9.3h-9.5zm0 1.08H21V21.2l-9.5-1.4v-7.62z"/>',
    github:  '<path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.55 0-.27-.01-1-.02-1.96-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.27-1.68-1.27-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.24 3.34.95.1-.74.4-1.24.72-1.53-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.95 10.95 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.73.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.4-5.25 5.69.41.36.78 1.06.78 2.14 0 1.55-.01 2.8-.01 3.18 0 .31.21.66.8.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"/>',
  };
  const laneIcon = (l) => l.cls === 'remote' ? 'github' : l.cls === 'mac' ? 'apple' : 'windows';

  let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" style="display:block">`;

  // Lane bands
  for (const l of lanes) {
    const y = yAt(l.idx);
    svg += `<rect class="lane-band" x="${padL - 14}" y="${y - laneH/2 + 14}" width="${W - padL - padR + 28}" height="${laneH - 28}" rx="14" fill="${LANE_BG[l.cls]}"/>`;
  }

  // Label area divider (subtle)
  svg += `<line x1="${padL - 14}" y1="${padT - 10}" x2="${padL - 14}" y2="${H - padB + 6}" stroke="#E4E4EA" stroke-width="1"/>`;

  // Lane labels — 200px area, brand icon + name (mono, can be long)
  for (const l of lanes) {
    const y = yAt(l.idx);
    // Icon tile (28×28 brand box)
    svg += `<g transform="translate(16, ${y - 14})">`;
    svg += `<rect width="28" height="28" rx="8" fill="#FFFFFF" stroke="#E4E4EA" stroke-width="1"/>`;
    svg += `<g transform="translate(5,5) scale(0.79)" fill="${COLOR[l.cls]}">${ICON_SVG[laneIcon(l)]}</g>`;
    svg += `</g>`;
    // Label text (mono, truncated naturally at 165px)
    svg += `<text x="52" y="${y + 5}" fill="${COLOR[l.cls]}" font-size="13.5" font-weight="700" font-family="JetBrains Mono, SF Mono, Consolas, monospace">${escape(l.label)}</text>`;
  }

  // Lane connection lines (through present dots only)
  for (const l of lanes) {
    const xs = win.map((c, i) => c.in && c.in[l.key] ? xAt(i) : null).filter(x => x !== null);
    if (xs.length >= 2) {
      svg += `<line x1="${Math.min(...xs)}" y1="${yAt(l.idx)}" x2="${Math.max(...xs)}" y2="${yAt(l.idx)}" stroke="${COLOR[l.cls]}" stroke-width="2.5" opacity="0.4"/>`;
    }
  }

  // Shared spine (vertical dotted) where all sources agree
  for (let i = 0; i < n; i++) {
    const c = win[i];
    if (lanes.length >= 2 && lanes.every(l => c.in && c.in[l.key])) {
      const ys = lanes.map(l => yAt(l.idx));
      svg += `<line x1="${xAt(i)}" y1="${Math.min(...ys)}" x2="${xAt(i)}" y2="${Math.max(...ys)}" stroke="#B4B7BD" stroke-width="1.5" stroke-dasharray="2 4" opacity="0.7"/>`;
    }
  }

  // LCA marker
  const ancI = win.findIndex(c => c.ancestor);
  if (ancI >= 0) {
    const x = xAt(ancI);
    svg += `<line x1="${x}" y1="${padT - 18}" x2="${x}" y2="${H - padB + 8}" stroke="#D4A72C" stroke-width="2" stroke-dasharray="5 4" opacity="0.85"/>`;
    svg += `<rect x="${x - 86}" y="${padT - 38}" width="172" height="22" rx="6" fill="rgba(245,158,11,0.13)" stroke="rgba(212,167,44,0.4)" stroke-width="1"/>`;
    svg += `<text x="${x}" y="${padT - 22}" text-anchor="middle" fill="#9a6700" font-size="11.5" font-weight="800" font-family="JetBrains Mono, SF Mono, Consolas, monospace">⊥ 공통 조상 · ${escape(win[ancI].short)}</text>`;
  }

  // Commit dots
  for (let i = 0; i < n; i++) {
    const c = win[i];
    for (const l of lanes) {
      if (!(c.in && c.in[l.key])) continue;
      const isTip = (c.tips || []).includes(l.key);
      const r = c.ancestor ? dotR + 3 : (isTip ? dotR + 1 : dotR);
      const x = xAt(i), y = yAt(l.idx);
      // outer ring for tip
      if (isTip) svg += `<circle cx="${x}" cy="${y}" r="${r + 4}" fill="${COLOR[l.cls]}" opacity="0.18"/>`;
      // ancestor amber ring
      if (c.ancestor) svg += `<circle cx="${x}" cy="${y}" r="${r + 3}" fill="none" stroke="#D4A72C" stroke-width="2"/>`;
      // main dot (data-sha for click → Panel 3)
      svg += `<circle cx="${x}" cy="${y}" r="${r}" fill="${COLOR[l.cls]}" stroke="#FFFFFF" stroke-width="2.5" data-sha="${escape(c.sha)}">`;
      svg += `<title>${escape(c.short || '')} · ${escape(c.msg || '')} · ${escape(c.author || '')} · ${escape(fmtRelative(c.date))}</title>`;
      svg += `</circle>`;
    }
  }

  // Tip pills
  for (const l of lanes) {
    let rightI = -1;
    for (let i = n - 1; i >= 0; i--) if (win[i].in && win[i].in[l.key]) { rightI = i; break; }
    if (rightI < 0) continue;
    const x = xAt(rightI) + dotR + 16;
    const y = yAt(l.idx);
    const refName = l.key === 'remote'
      ? `origin/${graph.default_branch || 'main'}`
      : `${l.key} HEAD`;
    const sha = win[rightI].short || '';
    const pillLabel = sha ? `${refName} · ${sha}` : refName;
    const w = Math.max(140, pillLabel.length * 8 + 36);
    // pill with brand icon
    svg += `<g transform="translate(${x}, ${y - 15})">`;
    svg += `<rect width="${w}" height="30" rx="8" fill="${COLOR[l.cls]}"/>`;
    svg += `<g transform="translate(8, 6) scale(0.72)" fill="#FFFFFF">${ICON_SVG[laneIcon(l)]}</g>`;
    svg += `<text x="32" y="20" fill="#FFFFFF" font-weight="800" font-size="12" font-family="JetBrains Mono, SF Mono, Consolas, monospace">${escape(pillLabel)}</text>`;
    svg += `</g>`;
  }

  svg += `</svg>`;

  // Legend below the graph
  const legend = `
    <div style="display:flex; align-items:center; gap:18px; padding:14px 8px 4px; font-size:11.5px; color: var(--text-sec); flex-wrap:wrap;">
      <span style="display:inline-flex; align-items:center; gap:6px;">
        <span style="width:10px; height:10px; border-radius:50%; background:#6E40C9;"></span> 원격 커밋
      </span>
      <span style="display:inline-flex; align-items:center; gap:6px;">
        <span style="width:10px; height:10px; border-radius:50%; background:#2563EB;"></span> Mac 로컬 커밋
      </span>
      <span style="display:inline-flex; align-items:center; gap:6px;">
        <span style="width:10px; height:10px; border-radius:50%; background:#0F766E;"></span> Win 로컬 커밋
      </span>
      <span style="display:inline-flex; align-items:center; gap:6px;">
        <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#B4B7BD" stroke-width="2" stroke-dasharray="2 4"/></svg>
        모든 호스트 공유
      </span>
      <span style="display:inline-flex; align-items:center; gap:6px;">
        <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#D4A72C" stroke-width="2" stroke-dasharray="5 4"/></svg>
        공통 조상 (LCA)
      </span>
      <span style="margin-left:auto; color: var(--text-dim);">점에 마우스 올리면 상세 정보</span>
    </div>`;

  return svg + legend;
}

function gitDetailHostMeta(host) {
  const or = state.gitDetail.ownerRepo;
  const snap = state.git.snapshots.find(s => s.host === host);
  if (!snap) return null;
  return (snap.repos || []).find(r => r.owner_repo === or) || null;
}

function gitSrcLabel(key, graph) {
  if (key === 'remote') return { icon: '📦', cls: 'remote' };
  const h = (graph.hosts || []).find(x => x.host === key);
  const os = h ? h.os : '';
  if (os === 'macos') return { icon: '🍎', cls: 'mac' };
  if (os === 'windows') return { icon: '🪟', cls: 'win' };
  return { icon: '•', cls: '' };
}

function renderGitDetailBody() {
  const graph = state.gitDetail.graph;
  const branch = state.gitDetail.branch;
  if (!graph || !branch) return;
  const pb = (graph.per_branch || {})[branch];
  const srcKeys = ['remote', ...(graph.hosts || []).map(h => h.host)];
  let chips = '';
  for (const k of srcKeys) {
    const lbl = gitSrcLabel(k, graph);
    if (k === 'remote') {
      const tip = pb && pb.pointers && pb.pointers.remote;
      chips += `<span class="git-chip ${lbl.cls}">${lbl.icon} GitHub ${tip ? ('· ' + tip.slice(0, 7)) : (graph.has_token ? '(브랜치 없음)' : '(토큰 필요)')}</span>`;
    } else {
      const s = pb && pb.summary && pb.summary[k];
      const meta = gitDetailHostMeta(k);
      let rel = '';
      if (s && s.has_remote) {
        if (!s.ahead && !s.behind) rel = ' · = 원격';
        else rel = ` ·${s.ahead ? ' ↑' + s.ahead : ''}${s.behind ? ' ↓' + s.behind : ''}`;
      }
      const dirty = meta ? `${meta.dirty ? ' · dirty ' + meta.dirty : ''}${meta.unpushed ? ' · ↑' + meta.unpushed + ' 미푸시' : ''}` : '';
      chips += `<span class="git-chip ${lbl.cls}">${lbl.icon} ${escape(k)}${rel}${dirty}</span>`;
    }
  }
  $gitDetailSummary.innerHTML = chips;
  if (state.gitDetail.mode === 'dag') { renderGitDag(pb, graph); return; }
  renderGitSyncMap(pb, graph);
}

function renderGitSyncMap(pb, graph) {
  if (!pb || !pb.commits || !pb.commits.length) {
    $gitDetailBody.innerHTML = '<div class="git-detail-loading">이 브랜치의 커밋 데이터가 없어요. (스캔/토큰 확인)</div>';
    return;
  }
  const srcKeys = ['remote', ...(graph.hosts || []).map(h => h.host)];

  // Order: oldest LEFT → newest RIGHT (pb.commits is newest-first).
  const all = [...pb.commits].reverse();
  // Trim to the relevant window: ancestor - 2 onward (so divergence is the focus).
  let start = 0;
  const ancFromOld = all.findIndex(c => c.ancestor);
  if (ancFromOld >= 0) start = Math.max(0, ancFromOld - 2);
  const win = all.slice(start);
  const n = win.length;

  // Lanes
  const lanes = srcKeys.map((k, idx) => {
    const lbl = gitSrcLabel(k, graph);
    const name = k === 'remote' ? 'GitHub' : k;
    return { key: k, idx, label: name, cls: lbl.cls, icon: lbl.icon };
  });

  // Layout
  const padL = 130, padR = 180, padT = 36, padB = 28;
  const laneH = 64;
  const dotR = 8;
  const xStep = 40;
  const W = padL + padR + Math.max(1, n - 1) * xStep + 80;
  const H = padT + lanes.length * laneH + padB;

  const xAt = (i) => padL + i * xStep;
  const yAt = (laneIdx) => padT + laneIdx * laneH + laneH / 2;

  let svg = `<svg class="git-river" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`;

  // Lane backgrounds + labels
  for (const lane of lanes) {
    const y = yAt(lane.idx);
    svg += `<rect x="${padL - 30}" y="${y - laneH/2 + 10}" width="${W - padL - padR + 60}" height="${laneH - 20}" class="lane-bg lane-${lane.cls}" rx="8" />`;
    svg += `<text x="14" y="${y + 5}" class="lane-label lane-${lane.cls}">${lane.icon}  ${escape(lane.label)}</text>`;
  }

  // Lane connection lines (between present dots per lane)
  for (const lane of lanes) {
    const presentXs = win.map((c, i) => (c.in && c.in[lane.key]) ? xAt(i) : null).filter(x => x !== null);
    if (presentXs.length >= 2) {
      const y = yAt(lane.idx);
      svg += `<line x1="${Math.min(...presentXs)}" y1="${y}" x2="${Math.max(...presentXs)}" y2="${y}" class="lane-line lane-${lane.cls}" />`;
    }
  }

  // Vertical "all-shared" indicator: at each X where ALL lanes have this commit
  for (let i = 0; i < n; i++) {
    const c = win[i];
    const presence = lanes.map(l => c.in && c.in[l.key]);
    if (presence.every(Boolean) && lanes.length >= 2) {
      const ys = lanes.map(l => yAt(l.idx));
      svg += `<line x1="${xAt(i)}" y1="${Math.min(...ys)}" x2="${xAt(i)}" y2="${Math.max(...ys)}" class="share-bar" />`;
    }
  }

  // Common ancestor highlight (vertical band + label)
  const ancI = win.findIndex(c => c.ancestor);
  if (ancI >= 0) {
    const x = xAt(ancI);
    svg += `<line x1="${x}" y1="${padT - 14}" x2="${x}" y2="${H - padB + 8}" class="anc-line" />`;
    svg += `<text x="${x}" y="${padT - 18}" text-anchor="middle" class="anc-label">⊥ 공통 조상 ${escape(win[ancI].short)}</text>`;
  }

  // Dots per (commit, lane)
  for (let i = 0; i < n; i++) {
    const c = win[i];
    for (const lane of lanes) {
      if (!(c.in && c.in[lane.key])) continue;
      const isTip = (c.tips || []).includes(lane.key);
      const r = isTip ? dotR + 2 : (c.ancestor ? dotR + 1 : dotR);
      const cls = `dot dot-${lane.cls}${isTip ? ' dot-tip' : ''}${c.ancestor ? ' dot-anc' : ''}`;
      svg += `<circle cx="${xAt(i)}" cy="${yAt(lane.idx)}" r="${r}" class="${cls}" data-sha="${escape(c.sha)}">`;
      svg += `<title>${escape(c.short)} · ${escape(c.msg)} · ${escape(c.author)} · ${escape(fmtRelative(c.date))}</title>`;
      svg += `</circle>`;
    }
  }

  // Tip pointer pills next to each lane's rightmost present dot
  for (const lane of lanes) {
    let rightI = -1;
    for (let i = n - 1; i >= 0; i--) {
      if (win[i].in && win[i].in[lane.key]) { rightI = i; break; }
    }
    if (rightI < 0) continue;
    const x = xAt(rightI) + dotR + 10;
    const y = yAt(lane.idx);
    const label = lane.key === 'remote'
      ? ('origin/' + (graph.default_branch || state.gitDetail.branch))
      : (lane.label + ' HEAD');
    // estimate width: 8px per char (CJK-safe-ish)
    const w = Math.max(80, label.length * 8 + 36);
    svg += `<g transform="translate(${x},${y - 14})">`;
    svg += `<rect x="0" y="0" rx="7" ry="7" width="${w}" height="28" class="pill-bg pill-${lane.cls}" />`;
    svg += `<text x="12" y="18" class="pill-text pill-${lane.cls}">${lane.icon}  ${escape(label)}</text>`;
    svg += `</g>`;
  }

  svg += `</svg>`;

  // Detail list (full 50 commits) collapsible below the river
  let listRows = '';
  for (const c of pb.commits) {
    let dots = '';
    for (const k of srcKeys) {
      const present = c.in && c.in[k];
      const lbl = gitSrcLabel(k, graph);
      dots += `<span class="git-dot ${lbl.cls} ${present ? 'on' : 'off'}" title="${escape(k)}">${present ? '●' : '·'}</span>`;
    }
    let pills = '';
    for (const t of (c.tips || [])) {
      const lbl = gitSrcLabel(t, graph);
      pills += `<span class="git-pill ${lbl.cls}">${lbl.icon}</span>`;
    }
    listRows += `
      <div class="git-commit-row${c.ancestor ? ' ancestor' : ''}" data-sha="${escape(c.sha)}">
        <span class="git-dots">${dots}</span>
        <span class="git-csha">${escape(c.short)}</span>
        <span class="git-cmsg">${escape(c.msg)}</span>
        <span class="git-cpills">${pills}${c.ancestor ? '<span class="git-anc">⊥</span>' : ''}</span>
        <span class="git-cmeta">${escape(c.author)} · ${escape(fmtRelative(c.date))}</span>
      </div>`;
  }

  $gitDetailBody.innerHTML = `
    <div class="git-river-wrap">${svg}</div>
    <details class="git-detail-list">
      <summary>📋 커밋 목록 (전체 ${pb.commits.length}개)</summary>
      <div class="git-syncmap">${listRows}</div>
    </details>`;

  // Click dots + rows → copy SHA
  const copy = async (sha) => {
    try { await invoke('copy_to_os_clipboard', { text: sha }); toast('SHA 복사됨: ' + sha.slice(0, 7), 'success'); } catch (_) {}
  };
  $gitDetailBody.querySelectorAll('.dot[data-sha]').forEach(el => el.addEventListener('click', () => copy(el.getAttribute('data-sha'))));
  $gitDetailBody.querySelectorAll('.git-commit-row[data-sha]').forEach(el => el.addEventListener('click', () => copy(el.getAttribute('data-sha'))));
}

function renderGitDag(pb, graph) {
  $gitDetailBody.innerHTML = '<div class="git-detail-loading">DAG 보기는 다음 단계(5d)에서 추가됩니다 — 지금은 Sync Map을 사용하세요.</div>';
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
    groupEl.innerHTML = `<div class="nav-group-header">${svgIcon(group.iconName)}<span>${escape(group.title)}</span><span class="nav-group-chev">${svgIcon('chevron-right')}</span></div>`;

    // "전체" pseudo-item
    const allItem = navItemEl('All', svgIcon('asterisk'), allCount, () => {
      state.view = VIEW_ITEMS;
      state.selection = { group: group.id, categoryKey: null };
      renderNav(); renderView();
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
        renderNav(); renderView();
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
  $panelLog.classList.add('hidden');
  $panelGit.classList.add('hidden');
  // 액션 카드 그리드의 active 표시를 현재 뷰와 동기화.
  renderActionGrid();

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
  } else if (state.view === VIEW_LOG) {
    $panelLog.classList.remove('hidden');
    renderLogView();
  } else if (state.view === VIEW_GIT) {
    $panelGit.classList.remove('hidden');
    refreshGit();
  } else if (state.view === VIEW_SETTINGS) {
    $panelSettings.classList.remove('hidden');
    renderSettings();
  } else {
    $panelItems.classList.remove('hidden');
    renderItems();
  }

  // Keep the collapsible log hub's active state in sync with the view.
  renderLogHub();
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
    $title.textContent = group.title;
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
        <div class="item-name" title="${escape(it.name)}">${escape(displayName)}${verifyBadge(it.verify_status)}</div>
        <div class="item-meta">${metaParts.map(escape).join(' · ')}</div>
      </div>
      <div class="item-tail">${escape(fmtFull(it.modified_iso))}</div>
    `;
    li.addEventListener('click', () => openDetails(it));
    li.addEventListener('dblclick', () => invoke('open_path', { path: it.path }).catch(e => toast(e, 'error')));
    $items.appendChild(li);
  }
}

function verifyBadge(status) {
  if (status === 'ok') return ' <span class="verify-badge verify-ok" title="무결성 검증됨">✓</span>';
  if (status === 'mismatch') return ' <span class="verify-badge verify-bad" title="무결성 불일치">✗</span>';
  return '';
}

// ─── Details modal ──────────────────────────────────────────────
function openDetails(it) {
  const parsed = parseTransferName(it.name);
  const displayName = parsed ? (parsed.basename + parsed.ext) : it.name;
  $detailsTitle.textContent = displayName;
  const versionRow = parsed
    ? `<div class="detail-row"><div class="detail-label">버전</div><div class="detail-value">v${escape(parsed.version)} · 전송일 ${escape(parsed.date)}</div></div>`
    : '';
  const tidRow = it.transfer_id
    ? `<div class="detail-row"><div class="detail-label">transfer_id</div><div class="detail-value detail-mono">${escape(it.transfer_id)}</div></div>`
    : '';
  $detailsBody.innerHTML = `
    <div class="detail-row"><div class="detail-label">카테고리</div><div class="detail-value">${escape(it.category_emoji)} ${escape(it.category_label)}</div></div>
    <div class="detail-row"><div class="detail-label">방향</div><div class="detail-value">${it.direction === 'mac_to_windows' ? 'MacBook → Windows' : 'Windows → MacBook'}</div></div>
    <div class="detail-row"><div class="detail-label">상태</div><div class="detail-value">${escape(it.state)}</div></div>
    <div class="detail-row"><div class="detail-label">크기</div><div class="detail-value">${fmtBytes(it.size_bytes)}</div></div>
    ${versionRow}
    <div class="detail-row"><div class="detail-label">수정 시각</div><div class="detail-value">${escape(fmtFull(it.modified_iso))}</div></div>
    ${tidRow}
    <div class="detail-row"><div class="detail-label">저장 파일명</div><div class="detail-value detail-mono">${escape(it.name)}</div></div>
    <div class="detail-row"><div class="detail-label">전체 경로</div><div class="detail-value detail-mono">${escape(it.path)}</div></div>
  `;
  // Reset verify result + wire verify button (only when transfer_id known
  // AND the manual button is enabled in settings).
  $verifyResult.classList.add('hidden');
  $verifyResult.innerHTML = '';
  const showManual = !state.settings || !state.settings.integrity || state.settings.integrity.show_manual_button !== false;
  if (it.transfer_id && showManual) {
    $detailsVerify.classList.remove('hidden');
    $detailsVerify.onclick = () => runVerify(it.transfer_id);
  } else {
    $detailsVerify.classList.add('hidden');
    $detailsVerify.onclick = null;
  }
  $detailsOpen.onclick = () => invoke('open_path', { path: it.path }).catch(e => toast(e, 'error'));
  $detailsReveal.onclick = () => invoke('reveal_in_explorer', { path: it.path }).catch(e => toast(e, 'error'));
  $details.classList.remove('hidden');
}

async function runVerify(transferId) {
  $verifyResult.classList.remove('hidden', 'success', 'error');
  $verifyResult.innerHTML = '<div class="result-row"><span>무결성 검증 중…</span></div>';
  $detailsVerify.disabled = true;
  try {
    const r = await invoke('verify_transfer', { transferId });
    if (r.ok) {
      $verifyResult.classList.add('success');
      $verifyResult.innerHTML = `
        <div class="result-row"><span class="result-key">결과</span><span class="result-val">✓ 무결성 OK</span></div>
        <div class="result-row"><span class="result-key">검증 파일</span><span class="result-val">${r.checked}개 일치</span></div>
        <div class="result-row"><span class="result-key">모드</span><span class="result-val">${escape(r.mode)}</span></div>`;
    } else {
      $verifyResult.classList.add('error');
      const bad = r.files.filter(f => !f.ok).slice(0, 5);
      const rows = bad.map(f =>
        `<div class="result-row"><span class="result-key" style="font-family:Consolas,monospace;font-size:10.5px">${escape(f.path)}</span><span class="result-val">${f.error ? escape(f.error) : '해시 불일치'}</span></div>`
      ).join('');
      const more = (r.mismatches + r.missing) > bad.length ? `<div class="result-row"><span class="result-key">…</span><span class="result-val">외 ${(r.mismatches + r.missing) - bad.length}건</span></div>` : '';
      $verifyResult.innerHTML = `
        <div class="result-row"><span class="result-key">결과</span><span class="result-val">✗ 불일치 ${r.mismatches} · 누락 ${r.missing} (검증 ${r.checked})</span></div>
        ${rows}${more}`;
    }
  } catch (e) {
    $verifyResult.classList.remove('success');
    $verifyResult.classList.add('error');
    $verifyResult.innerHTML = `<div class="result-row"><span>검증 실패: ${escape(String(e))}</span></div>`;
  } finally {
    $detailsVerify.disabled = false;
  }
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

// ─── HTML dependency pre-flight ─────────────────────────────────
// A bare .html whose styling/scripts/images live in sibling files would
// arrive looking broken (text only). Warn before sending; offer to send
// the parent folder instead (directory mode preserves internal names).
const $htmlWarn        = document.getElementById('html-warn');
const $htmlWarnList    = document.getElementById('html-warn-list');
const $htmlWarnCancel  = document.getElementById('html-warn-cancel');
const $htmlWarnProceed = document.getElementById('html-warn-proceed');
const $htmlWarnFolder  = document.getElementById('html-warn-folder');
let _htmlWarnResolve = null;

function showHtmlWarn(flagged) {
  $htmlWarnList.innerHTML = '';
  for (const f of flagged) {
    const fileName = f.path.split(/[\\/]/).pop();
    const rows = f.info.assets.map(a => {
      const tag = a.exists ? '<span class="hw-ok">있음</span>' : '<span class="hw-miss">없음 ⚠</span>';
      return `<div class="hw-asset"><span class="hw-kind">${escape(a.kind)}</span><span class="hw-ref">${escape(a.reference)}</span>${tag}</div>`;
    }).join('');
    const inline = f.info.has_inline_style ? '' : ' <span class="hw-miss">(인라인 스타일 없음)</span>';
    $htmlWarnList.innerHTML += `<div class="hw-file"><div class="hw-name">📄 ${escape(fileName)}${inline}</div>${rows}</div>`;
  }
  $htmlWarn.classList.remove('hidden');
  return new Promise(resolve => { _htmlWarnResolve = resolve; });
}

function closeHtmlWarn(choice) {
  $htmlWarn.classList.add('hidden');
  if (_htmlWarnResolve) { _htmlWarnResolve(choice); _htmlWarnResolve = null; }
}
$htmlWarnCancel.addEventListener('click', () => closeHtmlWarn('cancel'));
$htmlWarnProceed.addEventListener('click', () => closeHtmlWarn('proceed'));
$htmlWarnFolder.addEventListener('click', () => closeHtmlWarn('folder'));

// Returns { action: 'proceed'|'cancel', paths } — paths may have flagged
// htmls swapped for their parent dir when the user picks 폴더째.
async function htmlAssetGate(paths) {
  const flagged = [];
  for (const p of paths) {
    if (!/\.html?$/i.test(p)) continue;
    try {
      const info = await invoke('inspect_html_assets', { path: p });
      if (info.is_html && info.assets.length > 0) flagged.push({ path: p, info });
    } catch (e) { console.warn('html inspect:', e); }
  }
  if (flagged.length === 0) return { action: 'proceed', paths };

  const choice = await showHtmlWarn(flagged);
  if (choice === 'cancel') return { action: 'cancel', paths };
  if (choice === 'folder') {
    const flaggedSet = new Set(flagged.map(f => f.path));
    const seenDirs = new Set();
    const out = [];
    for (const p of paths) {
      if (flaggedSet.has(p)) {
        const dir = p.replace(/[\\/][^\\/]+$/, '');
        if (!seenDirs.has(dir)) { seenDirs.add(dir); out.push(dir); }
      } else {
        out.push(p);
      }
    }
    return { action: 'proceed', paths: out };
  }
  return { action: 'proceed', paths }; // 'proceed' = send as-is
}

// Send one path; if the target already exists (PS exit 20), ask to overwrite
// and retry with the force variant. Throws on real failure / declined overwrite.
async function sendOne(p, category) {
  try {
    await invoke('send_path', { sourcePath: p, category });
  } catch (e) {
    const msg = String(e);
    if (msg.includes('Target already exists') || msg.includes('exit Some(20)')) {
      const name = p.split(/[\\/]/).pop();
      if (window.confirm(`"${name}" 이(가) 이미 있어요. 덮어쓸까요?`)) {
        await invoke('send_path_force', { sourcePath: p, category });
      } else {
        throw new Error('덮어쓰기 취소됨');
      }
    } else {
      throw e;
    }
  }
}

async function sendBatch(paths, category) {
  const gate = await htmlAssetGate(paths);
  if (gate.action === 'cancel') { setStatus('전송 취소됨'); return; }
  paths = gate.paths;
  const cat = CATEGORIES.find(c => c.key === category);
  const label = cat ? `${cat.emoji} ${cat.label}` : category;
  setStatus(`${paths.length}개 항목을 ${label}으로 전송 중…`);
  let ok = 0;
  const errors = [];
  for (const p of paths) {
    try {
      await sendOne(p, category);
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
  const gate = await htmlAssetGate(state.pendingDrop);
  if (gate.action === 'cancel') { setStatus('전송 취소됨'); return; }
  const sendPaths = gate.paths;
  $catPickerSend.disabled = true;
  $catPickerSend.textContent = '보내는 중…';
  let okCount = 0;
  let errors = [];
  for (const p of sendPaths) {
    try {
      await sendOne(p, category);
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

$logRefresh.addEventListener('click', () => renderLogView());
$gitScan.addEventListener('click', scanGitNow);
$gitFetchRemote.addEventListener('click', fetchRemoteNow);
$gitRefresh.addEventListener('click', refreshGit);
$gitDetailBranch.addEventListener('change', () => { state.gitDetail.branch = $gitDetailBranch.value; renderGitL2Lanes(state.gitDetail.ownerRepo); });
$gitDetailMode.addEventListener('click', () => {
  // Layer 3: Raw inspector
  if (state.gitDetail.ownerRepo) openGitInspector(state.gitDetail.ownerRepo);
});
$treeUp.addEventListener('click', navigateTreeUp);
$treeHome.addEventListener('click', navigateTreeHome);
$treeDesktop.addEventListener('click', navigateTreeDesktop);
$dropZone.addEventListener('click', pickFilesAndSend);
$dropZonePick.addEventListener('click', (e) => { e.stopPropagation(); pickFilesAndSend(); });
$depthDec.addEventListener('click', () => changeDepth(-1));
$depthInc.addEventListener('click', () => changeDepth(+1));
$addShortcut.addEventListener('click', addShortcut);
$remoteHost.addEventListener('change', changeHost);
$checkConn.addEventListener('click', runConnectionCheck);
$speedTest.addEventListener('click', runSpeedTest);
$installTheme.addEventListener('click', installIconTheme);
$themeGitAdd.addEventListener('click', installThemeFromGit);
$integrityAuto.addEventListener('change', async () => {
  state.settings.integrity.auto_verify_on_receive = $integrityAuto.checked;
  await persistSettings();
  if ($integrityAuto.checked) maybeAutoVerify();
});
$integrityManual.addEventListener('change', async () => {
  state.settings.integrity.show_manual_button = $integrityManual.checked;
  await persistSettings();
});

// ─── Git settings (PAT / SSH / owner filter) ────────────────────
function gitSettings() {
  if (!state.settings.git) state.settings.git = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.git));
  return state.settings.git;
}

async function renderGitSettings() {
  const g = gitSettings();
  $gitOnlyMine.checked = g.only_mine !== false;
  $gitOwners.textContent = (g.owners && g.owners.length)
    ? `소유 owner: ${g.owners.join(', ')}`
    : '토큰 검증하면 소유 owner가 여기 채워져요.';
  // token presence
  try {
    const has = await invoke('git_has_token');
    $gitTokenStatus.textContent = has ? '✅ 토큰 등록됨 (키체인). "저장 + 검증"으로 재확인 가능.' : '⚠ 등록된 토큰 없음.';
  } catch (_) {}
  // ssh
  try {
    const ssh = await invoke('git_ssh_status');
    if (ssh.has_key) {
      $gitSshStatus.textContent = `✅ SSH 키 있음: ${ssh.path}`;
      $gitSshPubkey.value = ssh.public_key || '';
      $gitSshPubkey.style.display = ssh.public_key ? 'block' : 'none';
      $gitSshCopy.style.display = ssh.public_key ? 'inline-flex' : 'none';
    } else {
      $gitSshStatus.textContent = '⚠ SSH 키 없음 — "키 생성/표시"로 만들 수 있어요.';
      $gitSshPubkey.style.display = 'none';
      $gitSshCopy.style.display = 'none';
    }
  } catch (_) {}
}

$gitTokenSave.addEventListener('click', async () => {
  const tok = ($gitToken.value || '').trim();
  if (!tok) { toast('토큰을 입력하세요', 'error'); return; }
  $gitTokenSave.disabled = true;
  $gitTokenStatus.textContent = '검증 중…';
  try {
    await invoke('git_set_token', { token: tok });
    // G2: publish my ssh pubkey + push PAT to peers (best-effort; needs an ssh key).
    try {
      await invoke('git_publish_host_pubkey');
      const shared = await invoke('git_share_pat_to_peers');
      if (shared > 0) toast(`PAT를 ${shared}개 호스트에 자동 공유함`, 'success');
    } catch (_) {}
    const info = await invoke('git_test_token');
    const owners = [info.login, ...(info.orgs || [])].filter(Boolean);
    gitSettings().owners = owners;
    await persistSettings();
    $gitToken.value = '';
    $gitTokenStatus.textContent = `✅ ${info.login}${info.name ? ' (' + info.name + ')' : ''} · org: ${(info.orgs || []).join(', ') || '없음'}`;
    $gitOwners.textContent = `소유 owner: ${owners.join(', ')}`;
    toast('토큰 검증 완료', 'success');
    if (state.view === VIEW_GIT) renderGitPanel();
  } catch (e) {
    $gitTokenStatus.textContent = '❌ ' + e;
    toast('토큰 검증 실패: ' + e, 'error');
  } finally {
    $gitTokenSave.disabled = false;
  }
});

$gitTokenClear.addEventListener('click', async () => {
  try {
    await invoke('git_clear_token');
    gitSettings().owners = [];
    await persistSettings();
    $gitTokenStatus.textContent = '⚠ 토큰 삭제됨.';
    $gitOwners.textContent = '토큰 검증하면 소유 owner가 여기 채워져요.';
    toast('토큰 삭제됨', 'success');
  } catch (e) { toast('삭제 실패: ' + e, 'error'); }
});

$gitSshGen.addEventListener('click', async () => {
  $gitSshGen.disabled = true;
  try {
    const pub = await invoke('git_generate_ssh_key');
    try { await invoke('git_publish_host_pubkey'); } catch (_) {}
    $gitSshPubkey.value = pub;
    $gitSshPubkey.style.display = 'block';
    $gitSshCopy.style.display = 'inline-flex';
    $gitSshStatus.textContent = '✅ SSH 키 준비됨 — 아래 공개키를 GitHub에 등록하세요.';
    toast('SSH 키 생성/표시 완료', 'success');
  } catch (e) { toast('SSH 키 실패: ' + e, 'error'); }
  finally { $gitSshGen.disabled = false; }
});

$gitSshCopy.addEventListener('click', async () => {
  try { await invoke('copy_to_os_clipboard', { text: $gitSshPubkey.value }); toast('공개키 복사됨', 'success'); }
  catch (e) { toast('복사 실패: ' + e, 'error'); }
});
[$notifyEnabled, $notifyNative, $notifyOnSendOk, $notifyOnSendFail, $notifyOnVerifyOk, $notifyOnVerifyFail]
  .forEach(el => el.addEventListener('change', saveNotificationSettings));
$notifyWebhook.addEventListener('change', saveNotificationSettings);
$notifyTest.addEventListener('click', async () => {
  await saveNotificationSettings();
  try { await invoke('notify_test'); toast('테스트 알림 보냄', 'success'); }
  catch (e) { toast('테스트 실패: ' + e, 'error'); }
});

$gitOnlyMine.addEventListener('change', async () => {
  gitSettings().only_mine = $gitOnlyMine.checked;
  await persistSettings();
  if (state.view === VIEW_GIT) renderGitPanel();
});
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
$clipRefresh.addEventListener('click', refreshClipboard);
$clipClear.addEventListener('click', clearOwnClipboardHistory);

setupModals();
setupHeaderActions();

// Paint static brand icon once. (Action card icons are painted by renderActionGrid.)
document.getElementById('brand-icon').innerHTML = svgIcon('arrow-left-right');

(async () => {
  await loadSettingsFromBackend().catch(e => console.error('load settings:', e));
  await applyActiveTheme().catch(e => console.error('apply theme:', e));
  renderActionGrid();
  renderLogHub();
  await refreshAll().catch(e => { console.error('initial refresh failed:', e); setStatus('초기화 실패: ' + e); });
  await setupDragDrop().catch(e => console.error('drag-drop setup failed:', e));
  maybeAutoVerify();

  // G2: on startup, import a PAT a peer may have shared while we were closed.
  invoke('git_pull_pat_from_share').then((imported) => {
    if (imported && state.view === VIEW_GIT) refreshGit().catch(() => {});
  }).catch(() => {});

  // File-watcher driven refresh (no polling). Rust emits "share-changed"
  // events with topic ∈ {transfers, clipboard, notes, profiles, git, git-token}. Frontend
  // refreshes only the relevant slice and only if it's visible-ish.
  try {
    const { listen } = window.__TAURI__.event;
    await listen('share-changed', (event) => {
      const topic = event && event.payload && event.payload.topic;
      if (!topic) return;
      switch (topic) {
        case 'transfers':
          refreshAll().then(maybeAutoVerify).catch(() => {});
          break;
        case 'clipboard':
          refreshClipboard().catch(() => {});
          break;
        case 'notes':
          loadNotesList().catch(() => {});
          break;
        case 'profiles':
          if (state.view === VIEW_SETTINGS) refreshProfilesList().catch(() => {});
          break;
        case 'git':
          if (state.view === VIEW_GIT) refreshGit().catch(() => {});
          break;
        case 'git-token':
          invoke('git_pull_pat_from_share').then((imported) => {
            if (imported) {
              toast('다른 호스트에서 PAT를 받아 등록함', 'success');
              if (state.view === VIEW_GIT) refreshGit().catch(() => {});
            }
          }).catch(() => {});
          break;
      }
    });
  } catch (e) {
    console.warn('file watcher event listen failed; falling back to slow poll:', e);
    setInterval(() => refreshAll().catch(() => {}), 30000);
  }
})();
