// SshSettings — Settings → Git 섹션의 SSH 키 + 셰어 게시 UI.
//
// macOS uses ed25519 at `~/.ssh/mac_window_git_ed25519` per ADR-0005;
// `git_generate_ssh_key()` shells out to ssh-keygen with `-N ""`
// (no passphrase) and `-C mac-window-git`.
//
// "셰어에 게시" 는 PAT cross-host sync 의 1회 셋업 — 게시한 호스트가
// 다른 호스트의 PAT 를 받을 수 있게 된다. PAT 등록은 SSH 셋업 후 나오는
// 다음 step. 그래서 GitSection 에서 SSH 가 PAT 보다 먼저 노출됨.

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useToast } from "../../lib/toast";
import { useGitStore } from "../../lib/gitStore";

const PUBLISHED_KEY = "share-manager.ssh.published";

export function SshSettings() {
  const toast = useToast();
  const store = useGitStore();
  const [busy, setBusy] = useState<"" | "gen" | "publish">("");
  // Track whether the local pubkey has been pushed to the share. Stored
  // in localStorage so it survives reloads without an extra Tauri call.
  const [published, setPublished] = useState<boolean>(
    () => localStorage.getItem(PUBLISHED_KEY) === "1",
  );

  useEffect(() => {
    // If SSH key got deleted somehow, drop the "published" flag too —
    // the next bootstrap restarts from scratch.
    if (!store.ssh?.has_key && published) {
      setPublished(false);
      localStorage.removeItem(PUBLISHED_KEY);
    }
  }, [store.ssh?.has_key, published]);

  const generateAndPublish = async () => {
    setBusy("gen");
    try {
      if (!store.ssh?.has_key) {
        await api.git.generateSshKey();
        await store.refresh();
      }
      const dst = await api.git.publishHostPubkey();
      setPublished(true);
      localStorage.setItem(PUBLISHED_KEY, "1");
      toast(`✓ 셰어에 게시됨: ${dst.replace(/^.*\//, "")}`, "success");
    } catch (e) {
      toast(`실패: ${e}`, "error");
    } finally {
      setBusy("");
    }
  };

  const republish = async () => {
    setBusy("publish");
    try {
      await api.git.publishHostPubkey();
      setPublished(true);
      localStorage.setItem(PUBLISHED_KEY, "1");
      toast("공개키 재게시 완료", "success");
    } catch (e) {
      toast(`재게시 실패: ${e}`, "error");
    } finally {
      setBusy("");
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
        <h4>1. SSH 키 + 셰어 게시</h4>
        <p>
          `git fetch` 용 ed25519 키. 공개키만 GitHub Settings 에 등록.
          개인키는 키체인이 아니라 `~/.ssh/` 에 평문 저장 (macOS 표준).
          셰어 게시 후 다른 호스트가 이 키로 PAT 를 암호화해서 보낼 수 있게 됩니다.
        </p>
      </div>

      <div className="git-settings-status">
        {!hasKey && (
          <span className="git-settings-warn">⚠ 아직 키 없음 — 아래 버튼으로 1번에 생성·게시</span>
        )}
        {hasKey && !published && (
          <span className="git-settings-warn">
            ⚠ 키는 있지만 셰어 게시 안 됨 — "셰어에 게시" 누르면 다른 호스트가 보낼 수 있게 됨
          </span>
        )}
        {hasKey && published && (
          <span className="git-settings-ok">
            ✅ 키 + 셰어 게시 OK · <code>{store.ssh?.path}</code>
          </span>
        )}
      </div>

      <div className="git-settings-row">
        {!hasKey || !published ? (
          <button
            className="primary-btn"
            onClick={generateAndPublish}
            disabled={busy !== ""}
            title="SSH ed25519 키 생성 + 셰어의 host-keys/ 에 공개키 게시 (한 번에)"
          >
            {busy === "gen"
              ? "처리 중…"
              : !hasKey
              ? "키 생성 + 셰어에 게시"
              : "셰어에 게시"}
          </button>
        ) : (
          <button
            className="ghost-btn"
            onClick={republish}
            disabled={busy !== ""}
            title="셰어의 host-keys 갱신 (정상 작동 중에는 누를 필요 없음)"
          >
            {busy === "publish" ? "재게시 중…" : "🔄 재게시"}
          </button>
        )}
        {hasKey && pub && (
          <button className="ghost-btn" onClick={copy}>
            📋 공개키 복사 (GitHub Settings 붙여넣기 용)
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
