// TokenSettings — Settings → Git 섹션 안의 PAT 등록 / 검증 / 삭제 UI.
// Mirror of windows_gui/.../app.js git-token-{save,clear,status} wiring.
//
// Token CRUD ops are single-PAT (no host param) per brief §18.3 —
// `api.git.setToken(token)` writes to Keychain at
// service="mac-window-git", account="github-pat".

import { useEffect, useState } from "react";
import { api, type TokenInfo } from "../../lib/api";
import { useToast } from "../../lib/toast";
import { useGitStore } from "../../lib/gitStore";

export function TokenSettings() {
  const toast = useToast();
  const store = useGitStore();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  // On mount: if a token already exists, try to validate (best-effort)
  // so the user sees who they're logged in as without re-entering.
  useEffect(() => {
    if (!store.hasToken) return;
    let cancelled = false;
    (async () => {
      try {
        const i = await api.git.testToken();
        if (!cancelled) setInfo(i);
      } catch {
        /* ignore — Save again to surface the error */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store.hasToken]);

  const save = async () => {
    const t = token.trim();
    if (!t) {
      toast("토큰을 입력하세요", "error");
      return;
    }
    setBusy(true);
    setErrorText(null);
    try {
      await api.git.setToken(t);
      const i = await api.git.testToken();
      setInfo(i);
      setToken("");
      toast(`토큰 검증 완료 · ${i.login}`, "success");
      // Auto-share to peer hosts via age + ssh keys. Best-effort —
      // failures don't block the local save (the user might not have
      // SSH set up yet, or peer keys aren't published yet).
      try {
        await api.git.publishHostPubkey();
        const shared = await api.git.sharePatToPeers();
        if (shared > 0) {
          toast(`다른 호스트 ${shared}개에 PAT 자동 공유됨`, "success");
        }
      } catch (e) {
        console.warn("share PAT to peers failed:", e);
      }
      await store.refresh();
    } catch (e) {
      setErrorText(String(e));
      toast(`토큰 검증 실패: ${e}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const publishMyKey = async () => {
    setBusy(true);
    try {
      // Auto-generate the SSH key on the first publish so the user
      // doesn't need a separate "generate" click. No-op if a key
      // already exists.
      if (!store.ssh?.has_key) {
        await api.git.generateSshKey();
        await store.refresh();
      }
      const dst = await api.git.publishHostPubkey();
      toast(`SSH 공개키 셰어에 게시됨: ${dst.replace(/^.*\//, "")}`, "success");
    } catch (e) {
      toast(`공개키 게시 실패: ${e}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      await api.git.clearToken();
      setInfo(null);
      toast("토큰 삭제됨", "success");
      await store.refresh();
    } catch (e) {
      toast(`삭제 실패: ${e}`, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="git-settings-block">
      <div className="git-settings-block-head">
        <h4>GitHub Personal Access Token</h4>
        <p>
          Classic 권장 · 스코프 <code>repo</code> + <code>read:org</code> · 키체인에 저장됩니다
          (셰어 / settings.json 에는 미저장).
        </p>
      </div>

      <div className="git-settings-status">
        {store.hasToken
          ? info
            ? (
                <span className="git-settings-ok">
                  ✅ 등록됨 · <b>{info.login}</b>
                  {info.name && <> ({info.name})</>}
                  {info.orgs.length > 0 && (
                    <span className="git-settings-orgs"> · org: {info.orgs.join(", ")}</span>
                  )}
                </span>
              )
            : <span className="git-settings-ok">✅ 등록됨 (검증 대기)</span>
          : <span className="git-settings-warn">⚠ 등록된 토큰 없음</span>}
        {errorText && <div className="git-settings-error">❌ {errorText}</div>}
      </div>

      <div className="git-settings-row">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          className="git-settings-input"
          placeholder="ghp_… 토큰 입력"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          disabled={busy}
        />
        <button className="primary-btn" onClick={save} disabled={busy}>
          {busy ? "검증 중…" : "저장 + 검증"}
        </button>
        <button
          className="ghost-btn"
          onClick={clear}
          disabled={busy || !store.hasToken}
        >
          삭제
        </button>
      </div>

      <p className="git-settings-hint">
        💡 PAT 저장 시 다른 호스트의 SSH 공개키로 age 암호화 후 셰어 통해 자동 공유.
        다른 호스트가 자기 SSH 키로 복호화해서 keychain 에 import — 양쪽 등록 1회로 OK.
        SSH 키가 없거나 peer 키가 셰어에 없으면 자동 공유는 skip 됩니다.
      </p>
      <div className="git-settings-row">
        <button
          className="ghost-btn"
          onClick={publishMyKey}
          disabled={busy}
          title="다른 호스트가 내게 PAT 보낼 수 있게 SSH 공개키를 셰어에 게시 (키 없으면 자동 생성)"
        >
          {busy ? "처리 중…" : store.ssh?.has_key ? "내 SSH 공개키 셰어에 게시" : "SSH 키 생성 + 셰어에 게시"}
        </button>
      </div>
    </div>
  );
}
