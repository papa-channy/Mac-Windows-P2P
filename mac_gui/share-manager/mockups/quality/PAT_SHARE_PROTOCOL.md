# PAT cross-host sync — protocol & Windows backport

한 호스트가 GitHub PAT 를 등록하면 다른 호스트의 OS keychain 에도 자동
import 되는 프로토콜. 양 호스트가 이미 가진 **ed25519 SSH 키** 를 활용 —
사용자 추가 입력 0 (페어 코드도 없음). `age` crate 의 ssh-ed25519
recipient 지원이 핵심.

## 공유 디렉토리

```
<share>/00_System/10_Config/
├── host-keys/
│   ├── chanui-MacBookPro.ssh.pub      ← Mac 의 ssh ed25519 공개키
│   └── DESKTOP-Q0S7LSQ.ssh.pub        ← Win 의 ssh ed25519 공개키
└── git-token/
    ├── chanui-MacBookPro.age          ← Mac 용 (Win 이 Win 의 PAT 를 Mac 키로 암호화)
    └── DESKTOP-Q0S7LSQ.age            ← Win 용 (Mac 이 Mac 의 PAT 를 Win 키로 암호화)
```

## 프로토콜

### 1. 키 생성 (양쪽 1회)
- Settings → Git → "SSH 키 생성" 클릭
- `~/.ssh/mac_window_git_ed25519` (Mac) 또는 `%USERPROFILE%\.ssh\mac_window_git_ed25519`
  (Win) 에 ed25519 키페어 생성

### 2. 공개키 셰어에 게시 (양쪽 1회)
- Settings → Git → "내 SSH 공개키 셰어에 게시" 클릭
- `git_publish_host_pubkey()` 호출:
  - `~/.ssh/mac_window_git_ed25519.pub` 읽어 셰어의
    `host-keys/<sanitized-host>.ssh.pub` 에 작성

### 3. PAT 등록 (한쪽만)
- Settings → Git → PAT 입력 + 저장
- `git_set_token(token)` → 자기 keychain 에 저장
- 자동 후속 (`save()` 안에서 best-effort):
  - `git_publish_host_pubkey()` — 자기 공개키도 같이 publish (idempotent)
  - `git_share_pat_to_peers()`:
    - `host-keys/` 의 모든 다른 호스트 공개키 읽어옴
    - 각 peer 의 공개키로 PAT 를 `age` 암호화
    - `git-token/<peer>.age` 에 저장

### 4. PAT 자동 import (다른 호스트)
- 다른 호스트의 watcher 가 `<share>/00_System/10_Config/git-token/` 변경 감지
- `share-changed` 이벤트 topic=`"git-token"` fire
- `gitStore` 가 자동 `git_pull_pat_from_share()` 호출:
  - `git-token/<my-host>.age` 가 있으면 자기 SSH 개인키로 복호화
  - 자기 keychain 에 `service="mac-window-git", account="github-pat"` 으로 저장
  - 기존 token 과 동일하면 skip (keychain churn 방지)

## 보안 모델

- **PAT 평문** 은 양쪽 OS keychain 안에만 (Mac Keychain / Win Credential Manager)
- **셰어에는 암호문만** — age 의 X25519 (ed25519 -> X25519 변환) 으로 ChaCha20-Poly1305 AEAD
- **SSH 개인키가 빠져나가지 않는 한 PAT 는 안전**. 양쪽 호스트의 `~/.ssh/`
  는 OS file permission (0600) 로 protected.
- **양쪽이 SSH 공개키 한 번 publish** → 그 후 PAT 등록은 한 번만, 양쪽 자동
- 외부 attacker 가 셰어를 읽어도 PAT 복호화 불가능 (자기 키 없음)
- 한 호스트가 compromised 되면 해당 호스트의 키체인 + ssh 키 모두 노출 —
  그 호스트만의 위험. 다른 호스트는 안전.

## Windows 측 backport (TODO)

Mac 측 구현은 commit `<pending>` 에 land. Windows 측도 같은 contract 로
동등 구현 필요 (Mac 만 publish 하고 Win 이 못 받으면 단방향이 됨):

### Cargo.toml
```toml
age = { version = "0.10", features = ["ssh"] }
```

### `windows_gui/share-manager/src-tauri/src/commands.rs` 에 3 commands 추가

함수 시그니처는 Mac 측과 동일. `mac_hostname()` 대신 Windows 의
`COMPUTERNAME` env, `home_dir()` 의 `USERPROFILE` 우선. 나머지 로직 그대로:

```rust
#[tauri::command]
pub fn git_publish_host_pubkey() -> Result<String, String> { /* ... */ }

#[tauri::command]
pub fn git_share_pat_to_peers() -> Result<u32, String> { /* ... */ }

#[tauri::command]
pub fn git_pull_pat_from_share() -> Result<bool, String> { /* ... */ }
```

### watcher (commands.rs::start_file_watcher) 추가

```rust
share.join("00_System").join("10_Config").join("git-token"),
```
+ `classify_event_path` 의 `/git-token/` → `"git-token"`.

### invoke_handler 등록 (lib.rs)

3 개 commands.

### Frontend (windows_gui/share-manager/src/app.js)

PAT 저장 시 자동 호출 + share-changed listener 의 `git-token` topic 처리:

```js
async function gitSaveToken() {
  // ... 기존 git_set_token ...
  try {
    await invoke('git_publish_host_pubkey');
    const shared = await invoke('git_share_pat_to_peers');
    if (shared > 0) toast(`${shared}개 호스트에 자동 공유됨`, 'success');
  } catch (_) {}
}
// share-changed handler:
if (e.payload.topic === 'git-token') {
  invoke('git_pull_pat_from_share').then((imported) => {
    if (imported) refreshGit();
  });
}
```

### Sidebar UI

Mac TokenSettings 처럼 "내 SSH 공개키 셰어에 게시" 버튼 추가 (또는 SSH 키
생성 흐름 안에 자동 호출).

## 검증 시나리오 (cross-OS live)

1. **Win**: Settings → Git → SSH 키 생성 + "내 공개키 게시"
2. **Mac**: Settings → Git → SSH 키 생성 + "내 공개키 게시"
3. **Mac** (or Win): PAT 입력 + 저장 → toast "1개 호스트에 자동 공유됨"
4. **다른 쪽 (Win or Mac)**: 1.5초 내 share-changed 이벤트 fire
5. **다른 쪽**: Settings → Git 의 PAT 상태가 "✅ 등록됨" 으로 자동 갱신
6. **다른 쪽**: GitView → Sync Remote 클릭 → 정상 작동 (PAT 자동 import 됨)

## 알려진 한계

- SSH 개인키가 passphrase 보호되어 있으면 age decrypt 시 실패. v0.3 의
  `git_generate_ssh_key` 는 passphrase 없이 생성. 사용자가 직접 생성한
  키에 passphrase 있으면 별도 처리 필요 (현재 미지원).
- ssh-rsa 도 age 가 지원하지만 우리 publish 는 ed25519 만. ssh-rsa 키만
  가진 호스트는 ed25519 새로 생성해야.
