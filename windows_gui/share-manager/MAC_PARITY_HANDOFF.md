# Mac → Windows Parity 핸드오프 (Mac v0.3.2 → v0.3.4)

> **이 문서만 보고 Windows 측 작업을 바로 시작할 수 있도록** Mac 측이 최근
> 적용한 모든 개선을 빠짐없이 대조하고, Windows 에 어떻게 미러링할지
> 파일·라인·코드 단위로 지시한다. Mac 측 식별자(예: `E-8-a`)는
> `mac_gui/share-manager/mockups/quality/CODE_MAP.md` 참조.
>
> 작성 시점 기준: Windows `share-manager` = vanilla HTML/CSS/JS
> (`src/index.html` + `src/app.js` + `src/style.css`) + 단일
> `src-tauri/src/commands.rs`. Mac = React/TS + 모듈 분산 Rust.

---

## 0. Mac 측 최근 변경 요약 (대조 대상)

| Mac 릴리스 | 변경 | 식별자 | Windows 미러 |
|---|---|---|---|
| v0.3.2 | FDA 권한 onboarding 시 multi-path TCC trigger | B-1-e | **N/A** — Windows 는 macOS TCC 권한 모델 없음 |
| v0.3.3 | 공유 텍스트 sticky 패널 제거 (공유 메모와 중복) | E-8-b dep | **이미 충족** — Windows 클립보드 화면엔 애초에 sticky UI 없음 |
| v0.3.4 | **클립보드 2컬럼 OS-split 카드 레이아웃** | E-8-a | **필수 ① — 본 문서 §1** |
| v0.3.4 | 노트 오프라인 쓰기 큐 + reconnect flush | E-10-i/j | **불필요(조건부) — §3** |
| v0.3.4 | 클립보드 상대 host 캐시(pull) | E-2/E-5-b/c | **불필요(조건부) — §3** |
| v0.3.4 | 노트 자동저장 id 분열 버그 수정 | E-12-a | **필수 ② — 본 문서 §2** |

### 작업 우선순위
1. **§1 클립보드 2컬럼 카드 레이아웃** (필수, UI — 플랫폼 무관)
2. **§2 노트 자동저장 id 분열 버그 수정** (필수, 동일 버그 존재 확인됨)
3. **§3 오프라인 복원력** (조건부 — Windows 가 셰어를 *로컬 NTFS* 로 쓰면
   불필요, *네트워크 드라이브* 로 쓰면 권장)

---

## 1. 클립보드 2컬럼 OS-split 카드 레이아웃 (필수)

### 1.1 배경 / 목표

Mac 이 클립보드 페이지를 **1열 평면 리스트 → OS별 좌우 2컬럼 카드**로
재설계했다. 규칙:

- 화면을 좌우 2컬럼으로 분할
- **좌측 = 상대(remote) OS, 우측 = 내(local) OS**
  - Windows 에서 보면: **좌 = Mac, 우 = Windows**
  - (Mac 에서 보면 좌 = Windows, 우 = Mac — `detectLocalOs()` 로 자동 반전)
- 각 컬럼은 **독립적으로 newest-first** → OS 분리와 시간순 정렬을 동시 만족
  (1열일 땐 둘 중 하나만 가능했음)
- 각 항목은 **카드형** (border + radius + hover)
- 컬럼 헤더는 **sticky** (스크롤해도 어느 OS인지 고정), 내 쪽(local) 헤더에
  accent 보더로 강조
- 한쪽 OS 기록이 없으면 dashed 빈 박스

### 1.2 `src/index.html` 변경

현재 (line ~147):
```html
        <div class="clip-timeline-body">
          <div id="clip-timeline" class="clip-timeline"></div>
        </div>
```

변경 후 — 단일 타임라인 컨테이너를 2컬럼 컨테이너로 교체:
```html
        <div id="clip-os-split" class="clip-os-split"></div>
```
(`clip-timeline-body` 래퍼는 제거. `renderClipboardPanel` 이 `#clip-os-split`
안에 두 컬럼을 통째로 그린다. `$clipTimeline` 참조도 `$clipSplit` 로 교체 —
§1.4 참고. 헤더의 부제 문구도 "좌측은 상대 OS · 우측은 내 OS · 카드 클릭 →
복사" 로 갱신 권장.)

### 1.3 `src/style.css` 추가

Mac `global.css` 의 클립보드 카드 CSS 를 그대로 이식한다. **CSS 변수명
(`--surface` / `--border` / `--text` / `--text-sec` / `--text-dim` /
`--accent` / `--surface-low`) 이 Windows `style.css` 에 이미 정의돼 있는지
먼저 확인**하고, 다르면 Windows 토큰명으로 치환할 것. 기존 `.clip-entry*`,
`.clip-timeline*` 규칙은 더 이상 쓰지 않으므로 제거해도 된다 (단
`.clip-entry-os`, `.clip-entry-os-win`, `.clip-entry-os-mac` 배지 규칙은
아래에서 재사용하므로 유지/재정의).

```css
/* ─── Clipboard — OS-split 2-column card timeline ──────────────── */
.clip-os-split {
  flex: 1;
  overflow-y: auto;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  align-items: start;
  padding: 0 28px 24px;
}
.clip-col {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.clip-col-head {
  position: sticky;
  top: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 11px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 6px 10px -8px rgba(0, 0, 0, 0.18);
}
.clip-col.local .clip-col-head { border-color: var(--accent); }
.clip-col-title { font-weight: 600; font-size: 12.5px; color: var(--text); }
.clip-col-count {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-sec);
  font-variant-numeric: tabular-nums;
}
.clip-col-empty {
  padding: 26px 12px;
  text-align: center;
  font-size: 12px;
  color: var(--text-sec);
  border: 1px dashed var(--border);
  border-radius: 8px;
}
.clip-col-body { display: flex; flex-direction: column; gap: 8px; }

/* OS badge (also used in column head) */
.clip-entry-os {
  padding: 2px 7px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  font-family: -apple-system, system-ui, sans-serif;
}
.clip-entry-os-win { background: rgba(10, 132, 255, 0.13); color: #0a84ff; }
.clip-entry-os-mac { background: rgba(45, 164, 78, 0.13); color: #2da44e; }

/* Card */
.clip-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.12s, box-shadow 0.12s, transform 0.06s;
  font: inherit;
  color: inherit;
}
.clip-card:hover {
  border-color: var(--text-dim);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}
.clip-card:active { transform: scale(0.997); }
.clip-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10.5px;
  color: var(--text-sec);
}
.clip-card-host { font-family: "SF Mono", Consolas, monospace; }
.clip-card-time { margin-left: auto; font-variant-numeric: tabular-nums; }
.clip-card-text {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 7.5em;
  overflow: hidden;
}
.clip-card-text.url { color: var(--accent); }
.clip-card-thumb {
  width: 100%;
  max-height: 220px;
  object-fit: contain;
  border-radius: 6px;
  background: var(--surface-low);
}
.clip-card-missing {
  padding: 24px;
  text-align: center;
  font-size: 11.5px;
  color: var(--text-sec);
  background: var(--surface-low);
  border-radius: 6px;
}
.clip-card-imgmeta {
  font-size: 11px;
  color: var(--text-sec);
  font-variant-numeric: tabular-nums;
}
```

### 1.4 `src/app.js` — `renderClipboardPanel` 재작성

현재 `renderClipboardPanel()` (line ~1101) 은 `#clip-timeline` 에 항목을
1열로 그린다. 아래로 **통째 교체**한다. (Mac `ClipboardView.tsx` 의
`ClipColumn` / `TextCard` / `ImageCard` 를 vanilla DOM 으로 옮긴 것.)

먼저 DOM 참조를 교체 — 파일 상단 `$clipTimeline` 정의 부근:
```js
// before: const $clipTimeline = document.getElementById('clip-timeline');
const $clipSplit = document.getElementById('clip-os-split');
```

OS 판정 헬퍼 추가 (osBadge 근처):
```js
// Windows 빌드의 navigator 는 host OS 를 반영 → 'windows'. (Mac 미러
// 빌드라면 'macos' 가 나와 좌우가 자동 반전된다.)
function detectLocalOs() {
  return /Win/i.test(navigator.userAgent) ? 'windows' : 'macos';
}
function osLabel(os, isLocal) {
  const name = os === 'macos' ? 'Mac' : 'Windows';
  return isLocal ? `내 클립보드 · ${name}` : `${name} 클립보드`;
}
```

`renderClipboardPanel` 교체:
```js
function renderClipboardPanel() {
  const localOs  = detectLocalOs();              // 'windows'
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
```

> **주의**: `refreshClipboard()` 의 시그니처 diff(`lastSig`) 로직은 그대로
> 둔다 — 변경 없을 때 재렌더 skip 으로 썸네일 플리커를 막는다. 단 이제
> 재렌더가 컬럼 통째 교체이므로 정상.

### 1.5 §1 완료 기준
- [ ] 클립보드 화면이 좌우 2컬럼 (좌 Mac / 우 Windows)
- [ ] 각 컬럼 카드형 + newest-first
- [ ] 내 컬럼(우, Windows) 헤더에 accent 보더
- [ ] 한쪽 비어도 dashed 박스로 레이아웃 유지
- [ ] 텍스트/이미지 카드 클릭 → OS 클립보드 복사 동작
- [ ] 헤더 sticky (스크롤 시 OS 라벨 고정)

---

## 2. 노트 자동저장 id 분열 버그 수정 (필수)

### 2.1 버그

Windows `saveCurrentNote()` (app.js ~line 1016):
```js
const updated = await invoke('save_note', {
  id: state.notes.current.id || null,   // ← 새 노트는 id 가 null
  ...
});
```
백엔드 `save_note` 는 **id 가 null 이면 매번 새 UUID 를 생성**한다. 새 노트
작성 중 자동저장(600ms 디바운스)이 **첫 저장의 `await` 가 끝나기 전에** 다시
발동하면, 그때까지 `state.notes.current.id` 가 아직 null 이라 **또 다른
UUID 가 생성** → **메모 한 개가 여러 파일로 분열**된다. (Mac 에서 실제로
오프라인 테스트 중 메모 1개가 4개로 분열되는 것을 확인했고, 동일 패턴이
Windows 에도 존재한다.)

### 2.2 수정 — 새 노트 id 를 프론트에서 미리 고정

`new-note` 흐름에서 id 를 한 번 mint 해서 `state.notes.current.id` 에 박고,
모든 자동저장이 그 id 를 재사용하게 한다.

헬퍼 추가 (notes 영역 상단):
```js
function newNoteId() {
  const raw = (window.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`).replace(/-/g, '');
  return 'note-' + raw;
}
```

"＋ 새 메모" 버튼 핸들러 ($newNoteBtn) — 새 노트 객체에 id 를 즉시 부여:
```js
$newNoteBtn.addEventListener('click', () => {
  if (state.notes.saveTimer) clearTimeout(state.notes.saveTimer);
  state.notes.selectedId = null;
  state.notes.current = {
    id: newNoteId(),            // ← 미리 고정
    title: '', body: '',
    created_at: null, updated_at: null,
  };
  renderNotesEditor();
});
```

`saveCurrentNote()` — `|| null` 대신 항상 현재 id 사용 (이제 새 노트도
id 보유):
```js
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
```

> 핵심은 "**새 노트가 첫 입력되는 순간 이미 안정적인 id 를 갖는다**"는 것.
> 그러면 디바운스 자동저장이 몇 번 발동하든 같은 파일만 갱신한다.
> Mac 은 React `useRef` 로, Windows 는 전역 `state.notes.current.id` 로
> 동일 목적 달성.

### 2.3 §2 완료 기준
- [ ] 새 메모 작성 → 빠르게 타이핑하며 멈췄다 이어가도 **노트 리스트에 1개만** 생성
- [ ] 기존 노트 편집은 그대로 동작
- [ ] 삭제 후 새 메모 작성 시 id 충돌 없음

---

## 3. 오프라인 복원력 (조건부)

Mac v0.3.4 는 **셰어(SMB)가 언마운트된 상태**의 복원력을 추가했다:
- 노트: 오프라인 쓰기 큐(`notes-pending/`) + 재연결 시 `flush_pending()`
  (last-write-wins) — Mac 식별자 E-10-i/j
- 클립보드: 상대 host 스트림을 로컬 캐시로 pull(`sync_from_share`) + merge,
  `list_entries` 가 캐시 전체 읽음 — Mac 식별자 E-2/E-5-b/c

### 판단: Windows 는 보통 불필요

직결망 구성에서 **셰어를 호스팅하는 쪽이 보통 Windows(로컬 NTFS, 예 `D:`)**
이거나, Windows 가 셰어를 항상 붙어있는 매핑 드라이브로 쓴다. 이 경우
"언마운트" 상태가 없으므로 오프라인 큐/캐시가 **원천적으로 불필요**하다.
Mac 은 셰어를 SMB 로 마운트하므로 연결이 끊길 수 있어 필요했던 것.

### 그래도 적용해야 하는 경우 (네트워크 드라이브)

Windows 가 셰어를 **네트워크 드라이브(`\\HOST\share` 매핑)** 로 쓰고 그
연결이 끊길 수 있다면, Mac 과 동형으로 구현한다:

1. **마운트 상태 판정** — `is_share_mounted()` 동등 함수 (셰어 루트의
   `00_System` 존재 + 접근 가능 여부). Mac `mount::is_share_mounted` 참조.
2. **노트 로컬 미러** — `%LOCALAPPDATA%\MacWindowShare\cache\notes\` 에
   save/get/list 시 미러. Mac `notes::local_mirror_dir`.
3. **노트 pending 큐** — `...\cache\notes-pending\<id>.json` / `<id>.delete`.
   오프라인 save/delete 시 큐잉. Mac `notes::pending_dir` + 수정된
   `save`/`delete`.
4. **flush_pending** — 재연결 감지 시 큐를 셰어로 replay, last-write-wins
   (`updated_at` RFC3339 비교). Mac `notes::flush_pending` + `is_newer`.
5. **클립보드 캐시** — 이미 로컬 캐시(`<host>.history.jsonl`)가 있으면
   `sync_from_share` 동등(상대 host 스트림 pull + merge dedup) 추가. Mac
   `clipboard::sync_from_share` + `merge_jsonl`. `list_clipboard_entries`
   가 셰어 + 로컬 캐시 디렉토리 전체를 병합하도록.
6. 재연결 트리거는 Mac 처럼 클립보드 poller 의 mount-transition 지점에서
   `flush_pending()` + `sync_from_share()` 호출.

Mac 측 구현 전체는 `mac_gui/share-manager/src-tauri/src/notes.rs` 와
`clipboard.rs` 에 있고, 각 함수에 한국어 주석 + 단위 테스트(`#[cfg(test)]`)가
달려 있으니 그대로 이식 가능. (cargo 68/68 통과 기준 코드.)

### §3 완료 기준 (네트워크 드라이브 구성일 때만)
- [ ] 셰어 연결 끊긴 상태에서 노트 작성/편집 성공
- [ ] 재연결 시 오프라인 노트가 셰어로 자동 동기화 (충돌은 최신이 이김)
- [ ] 연결 끊김 상태에서도 상대 클립보드가 캐시로 표시

---

## 4. 식별자 ↔ Windows 위치 매핑

| Mac 식별자 | Mac 위치 | Windows 적용 위치 | 작업 |
|---|---|---|---|
| E-8-a ClipboardView | `src/views/ClipboardView.tsx` + `global.css` | `src/index.html` + `src/app.js renderClipboardPanel` + `src/style.css` | §1 |
| E-12-a NotesView (id ref) | `src/views/NotesView.tsx` | `src/app.js saveCurrentNote` + new-note 핸들러 | §2 |
| E-10-i flush_pending | `notes.rs` | `commands.rs` (네트워크 구성 시) | §3 |
| E-10-j pending queue | `notes.rs` | `commands.rs` (네트워크 구성 시) | §3 |
| E-5-b sync_from_share | `clipboard.rs` | `commands.rs` (네트워크 구성 시) | §3 |
| E-5-c merge_jsonl | `clipboard.rs` | `commands.rs` (네트워크 구성 시) | §3 |
| B-1-e TCC trigger | `commands.rs` | — | N/A (macOS 전용) |
| E-8-b sticky 제거 | (제거됨) | — | 이미 충족 (Windows 무 sticky) |

---

## 5. 검증

```sh
# Windows 측
cd windows_gui/share-manager
cargo test            # 백엔드 테스트 (네트워크 구성 §3 이식 시 신규 테스트 포함)
# 앱 실행 후 수동:
#  - 클립보드: 좌 Mac / 우 Windows 2컬럼 카드 (§1.5 체크리스트)
#  - 노트: 새 메모 1개만 생성 (§2.3 체크리스트)
```

Mac 측 동일 검증 기준은 `mac_gui/share-manager/mockups/quality/IMPL_STATUS.md`
의 Spotlight **SP-E-2** 참고.

---

## 6. 요약 (TL;DR)

1. **§1 필수** — 클립보드를 OS별 좌우 2컬럼 카드로. index.html DOM 1줄 교체
   + style.css 카드 CSS 추가 + app.js `renderClipboardPanel` 통째 교체
   (코드 본문 §1.4 그대로 사용 가능).
2. **§2 필수** — 노트 새 메모 id 를 프론트에서 미리 고정해 자동저장 분열
   버그 제거. `newNoteId()` + new-note 핸들러 + `saveCurrentNote` 수정.
3. **§3 조건부** — 오프라인 큐/캐시는 Windows 가 로컬 NTFS 면 불필요,
   네트워크 드라이브면 Mac `notes.rs`/`clipboard.rs` 이식.

위 §1·§2 만으로 Mac v0.3.4 의 사용자 가시적 변경(2컬럼 + 분열 버그)이
Windows 에 반영된다. §3 은 구성에 따라 선택.
