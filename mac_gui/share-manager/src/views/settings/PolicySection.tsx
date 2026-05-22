// PolicySection — closed/open network mode radio + language presets info
// + host profile publish/list. All three sub-sections talk to the SHARED
// policy.json living at share/00_System/10_Config/global/policy.json so
// the Windows side sees changes immediately.

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useToast } from "../../lib/toast";
import { useShareTopic } from "../../lib/useShareTopic";

type NetMode = "closed" | "open";

interface LanguagePreset {
  language: string;
  patterns: string[];
}

interface ProfileEntry {
  host?: string;
  os?: string;
  os_version?: string;
  arch?: string;
  user?: string;
  published_at?: string;
  tools?: Record<string, string>;
  capabilities?: string[];
}

export function PolicySection() {
  const toast = useToast();
  const [policy, setPolicy] = useState<Record<string, unknown> | null>(null);
  const [presets, setPresets] = useState<LanguagePreset[]>([]);
  const [profiles, setProfiles] = useState<ProfileEntry[]>([]);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    invoke<Record<string, unknown>>("load_policy")
      .then(setPolicy)
      .catch(() => setPolicy(null));
    invoke<LanguagePreset[]>("list_language_presets")
      .then(setPresets)
      .catch(() => setPresets([]));
    invoke<ProfileEntry[]>("list_profiles")
      .then(setProfiles)
      .catch(() => setProfiles([]));
  }, []);

  const mode = (policy?.network_mode as NetMode | undefined) ?? "closed";

  const setMode = async (m: NetMode) => {
    const next = { ...(policy ?? {}), network_mode: m };
    setPolicy(next);
    try {
      await invoke("save_policy", { policy: next });
    } catch (e) {
      toast("정책 저장 실패: " + String(e), "error");
    }
  };

  const publishMyProfile = async () => {
    setPublishing(true);
    try {
      await invoke<string>("publish_profile");
      toast("프로필 게시 완료", "success");
      const list = await invoke<ProfileEntry[]>("list_profiles");
      setProfiles(list);
    } catch (e) {
      toast("프로필 게시 실패: " + String(e), "error");
    } finally {
      setPublishing(false);
    }
  };

  const refreshProfiles = useCallback(async () => {
    try {
      const list = await invoke<ProfileEntry[]>("list_profiles");
      setProfiles(list);
    } catch (e) {
      toast("프로필 목록 실패: " + String(e), "error");
    }
  }, [toast]);

  // Other hosts publishing their profile → 10_Config/profiles/ changes →
  // watcher emits "profiles" topic → we re-fetch silently.
  const silentRefreshProfiles = useCallback(() => {
    invoke<ProfileEntry[]>("list_profiles").then(setProfiles).catch(() => void 0);
  }, []);
  useShareTopic("profiles", silentRefreshProfiles);

  return (
    <section className="settings-section">
      <h3>정책 & 프로필 (양쪽 공유)</h3>

      <div className="settings-row">
        <div className="settings-label">네트워크 모드</div>
        <div className="settings-control">
          <div className="theme-options">
            <label className="theme-opt">
              <input
                type="radio"
                name="netmode"
                value="closed"
                checked={mode === "closed"}
                onChange={() => setMode("closed")}
              />
              <span className="theme-opt-name">닫힘 (closed)</span>
              <span className="theme-opt-meta">
                10GbE 직결 신뢰망 · .env / API 키 통과
              </span>
            </label>
            <label className="theme-opt">
              <input
                type="radio"
                name="netmode"
                value="open"
                checked={mode === "open"}
                onChange={() => setMode("open")}
              />
              <span className="theme-opt-name">열림 (open)</span>
              <span className="theme-opt-meta">노출망 · 모든 시크릿 차단</span>
            </label>
          </div>
          <span className="settings-hint">
            SSH 키 · 인증서 · 모바일 프로비저닝은 어느 모드든 차단됩니다.
          </span>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-label">언어 프리셋</div>
        <div className="settings-control">
          <div className="result-card">
            {presets.length === 0 ? (
              <div className="result-row">
                <span className="result-key">presets</span>
                <span className="result-val">(셰어에 프리셋 없음)</span>
              </div>
            ) : (
              presets.map((p) => (
                <div className="result-row" key={p.language}>
                  <span className="result-key">{p.language}</span>
                  <span className="result-val">{p.patterns.length} 규칙</span>
                </div>
              ))
            )}
          </div>
          <span className="settings-hint">
            감지된 프로젝트 언어로 자동 적용. 정식 enforcement는{" "}
            <code>shareguard send</code> Rust 구현에서.
          </span>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-label">호스트 프로필</div>
        <div className="settings-control">
          <div className="btn-row">
            <button className="primary-btn" onClick={publishMyProfile} disabled={publishing}>
              {publishing ? "게시 중…" : "📤 내 프로필 게시"}
            </button>
            <button className="ghost-btn" onClick={refreshProfiles}>
              ↻ 게시된 프로필 다시 로드
            </button>
          </div>
          <div className="result-card">
            {profiles.length === 0 ? (
              <div className="result-row">
                <span className="result-key">profiles</span>
                <span className="result-val">(아직 게시된 호스트 없음)</span>
              </div>
            ) : (
              profiles.map((p, idx) => (
                <div className="result-row" key={(p.host ?? "host") + idx}>
                  <span className="result-key">
                    {p.host ?? "(unknown)"} · {p.os ?? "?"}
                  </span>
                  <span className="result-val">
                    {p.published_at ? p.published_at.slice(0, 19) : "-"}
                  </span>
                </div>
              ))
            )}
          </div>
          <span className="settings-hint">
            셰어 <code>00_System/10_Config/profiles/</code> 에 호스트 정보 저장.
            Windows 도 동일하게 게시하면 여기 같이 보임.
          </span>
        </div>
      </div>
    </section>
  );
}
