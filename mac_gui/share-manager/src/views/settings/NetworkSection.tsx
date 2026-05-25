// NetworkSection — remote_host text input + check_connection + speed_test.
//
// Result cards render with `.success` / `.error` left-border accent. Hidden
// until the user clicks the corresponding button.

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { api, type SmbHost } from "../../lib/api";
import { useSettings } from "../../lib/settings";

interface ConnectionStatus {
  host: string;
  port: number;
  tcp_reachable: boolean;
  tcp_latency_ms: number;
  ping_reachable: boolean;
  ping_latency_ms: number | null;
}

interface SpeedResult {
  bytes: number;
  write_ms: number;
  read_ms: number;
  write_mb_per_sec: number;
  read_mb_per_sec: number;
}

export function NetworkSection() {
  const { settings, update } = useSettings();
  const [conn, setConn] = useState<ConnectionStatus | null>(null);
  const [speed, setSpeed] = useState<SpeedResult | null>(null);
  const [hosts, setHosts] = useState<SmbHost[] | null>(null);
  const [busy, setBusy] = useState<"" | "conn" | "speed" | "discover">("");

  const setHost = (h: string) =>
    update((s) => ({ ...s, network: { ...s.network, remote_host: h } }));

  const checkConn = async () => {
    setBusy("conn");
    try {
      const r = await invoke<ConnectionStatus>("check_connection", {
        host: settings.network.remote_host,
        port: 445,
      });
      setConn(r);
    } catch (e) {
      setConn({
        host: settings.network.remote_host,
        port: 445,
        tcp_reachable: false,
        tcp_latency_ms: 0,
        ping_reachable: false,
        ping_latency_ms: null,
      });
      console.error(e);
    } finally {
      setBusy("");
    }
  };

  const discover = async () => {
    setBusy("discover");
    setHosts(null);
    try {
      const r = await api.discoverSmbHosts(3);
      setHosts(r);
    } catch (e) {
      console.error("smb discover failed:", e);
      setHosts([]);
    } finally {
      setBusy("");
    }
  };

  const pickHost = (h: SmbHost) => {
    // Prefer the .local mDNS hostname over a raw IPv4 — it survives
    // DHCP-induced IP changes on the same subnet.
    setHost(h.mdns_host);
  };

  const runSpeed = async () => {
    setBusy("speed");
    setSpeed(null);
    try {
      const r = await invoke<SpeedResult>("speed_test_local", {
        bytes: 100 * 1024 * 1024,
      });
      setSpeed(r);
    } catch (e) {
      console.error("speed test failed:", e);
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="settings-section">
      <h3>네트워크 (10GbE 직결)</h3>

      <div className="settings-row">
        <div className="settings-label">Windows 측 IP</div>
        <div className="settings-control">
          <input
            type="text"
            className="text-input"
            placeholder="DESKTOP-XXXX.local 또는 192.168.x.x"
            value={settings.network.remote_host}
            onChange={(e) => setHost(e.target.value)}
          />
          <span className="settings-hint">
            직결 링크의 Windows 호스트 주소. `.local` mDNS 이름을 쓰면 IP 가
            바뀌어도 자동 추적.
          </span>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-label">자동 검색</div>
        <div className="settings-control">
          <div className="btn-row">
            <button
              className="ghost-btn"
              onClick={discover}
              disabled={!!busy}
              title="직결망 내 SMB 호스트 (445 포트) 를 mDNS 로 browse"
            >
              {busy === "discover" ? "🔍 검색 중…" : "🔍 직결망 호스트 자동 검색"}
            </button>
          </div>
          {hosts !== null && (
            <div className="discovery-results">
              {hosts.length === 0 ? (
                <div className="discovery-empty">
                  발견된 호스트 없음. Windows 의 native SMB 는 mDNS 광고를 안 하므로
                  보통 여기엔 안 잡혀요. Windows 호스트명을 알면 위 입력란에
                  <code> DESKTOP-XXXX.local</code> 형태로 직접 입력하세요 — 그대로
                  연결됩니다.
                </div>
              ) : (
                hosts.map((h) => {
                  const active = settings.network.remote_host === h.mdns_host;
                  return (
                    <button
                      key={h.fullname}
                      className={"discovery-row" + (active ? " active" : "")}
                      onClick={() => pickHost(h)}
                      title={`address: ${h.addresses.join(", ")} · port ${h.port}`}
                    >
                      <span className="discovery-host">{h.hostname}</span>
                      <span className="discovery-mdns">{h.mdns_host}</span>
                      <span className="discovery-addrs">
                        {h.addresses.slice(0, 2).join(", ")}
                      </span>
                      {active && <span className="discovery-tick">선택됨</span>}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-label"></div>
        <div className="settings-control">
          <div className="btn-row">
            <button className="primary-btn" onClick={checkConn} disabled={!!busy}>
              {busy === "conn" ? "확인 중…" : "🔌 연결 확인"}
            </button>
            <button className="ghost-btn" onClick={runSpeed} disabled={!!busy}>
              {busy === "speed" ? "측정 중…" : "⏱ 속도 측정 (100MB)"}
            </button>
          </div>
          {conn && (
            <div className={"result-card " + (conn.tcp_reachable ? "success" : "error")}>
              <div className="result-row">
                <span className="result-key">대상</span>
                <span className="result-val">{conn.host}:{conn.port}</span>
              </div>
              <div className="result-row">
                <span className="result-key">TCP</span>
                <span className="result-val">
                  {conn.tcp_reachable ? `✓ ${conn.tcp_latency_ms} ms` : "✗ 도달 불가"}
                </span>
              </div>
              <div className="result-row">
                <span className="result-key">ICMP ping</span>
                <span className="result-val">
                  {conn.ping_reachable
                    ? `✓ ${conn.ping_latency_ms ?? "-"} ms`
                    : "✗"}
                </span>
              </div>
            </div>
          )}
          {speed && (
            <div className="result-card success">
              <div className="result-row">
                <span className="result-key">전송량</span>
                <span className="result-val">
                  {(speed.bytes / 1024 / 1024).toFixed(0)} MB
                </span>
              </div>
              <div className="result-row">
                <span className="result-key">쓰기</span>
                <span className="result-val">
                  {speed.write_mb_per_sec.toFixed(1)} MB/s · {speed.write_ms} ms
                </span>
              </div>
              <div className="result-row">
                <span className="result-key">읽기</span>
                <span className="result-val">
                  {speed.read_mb_per_sec.toFixed(1)} MB/s · {speed.read_ms} ms
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
