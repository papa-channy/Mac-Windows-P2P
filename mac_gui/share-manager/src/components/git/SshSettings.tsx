// SshSettings — Settings → Git 섹션의 SSH 키 생성/표시/복사 UI.
// Mirror of windows_gui/.../app.js git-ssh-{gen,copy,status,pubkey}.
//
// macOS uses ed25519 at `~/.ssh/mac_window_git_ed25519` per ADR-0005;
// `git_generate_ssh_key()` shells out to ssh-keygen with `-N ""`
// (no passphrase) and `-C mac-window-git`.

import { useState } from "react";
import { api } from "../../lib/api";
import { useToast } from "../../lib/toast";
import { useGitStore } from "../../lib/gitStore";

export function SshSettings() {
  const toast = useToast();
  const store = useGitStore();
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    setBusy(true);
    try {
      await api.git.generateSshKey();
      await store.refresh();
      toast("SSH 키 준비됨 — 아래 공개키를 GitHub에 등록하세요", "success");
    } catch (e) {
      toast(`SSH 키 실패: ${e}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    const pub = store.ssh?.public_key;
    if (!pub) return;
    try {
      await api.copyToOsClipboard(pub);
      toast("공개키 복사됨", "success");
    } catch (e) {
      toast(`복사 실패: ${e}`, "error");
    }
  };

  const hasKey = store.ssh?.has_key ?? false;
  const pub = store.ssh?.public_key ?? "";

  return (
    <div className="git-settings-block">
      <div className="git-settings-block-head">
        <h4>SSH (ed25519)</h4>
        <p>
          `git fetch` 용 키. 공개키만 GitHub Settings → SSH and GPG keys 에 등록해요.
          개인키는 키체인이 아니라 `~/.ssh/` 에 평문 저장 (macOS 표준).
        </p>
      </div>

      <div className="git-settings-status">
        {hasKey
          ? (
              <span className="git-settings-ok">
                ✅ 키 있음 · <code>{store.ssh?.path}</code>
              </span>
            )
          : <span className="git-settings-warn">⚠ SSH 키 없음 — "키 생성/표시" 로 만들 수 있어요</span>}
      </div>

      <div className="git-settings-row">
        <button className="primary-btn" onClick={generate} disabled={busy}>
          {busy ? "처리 중…" : hasKey ? "공개키 표시" : "키 생성 + 표시"}
        </button>
        {hasKey && pub && (
          <button className="ghost-btn" onClick={copy}>
            공개키 복사
          </button>
        )}
      </div>

      {hasKey && pub && (
        <textarea
          className="git-settings-pubkey"
          readOnly
          value={pub}
          rows={3}
          spellCheck={false}
        />
      )}
    </div>
  );
}
