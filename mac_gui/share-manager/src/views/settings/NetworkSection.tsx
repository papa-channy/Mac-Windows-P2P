// NetworkSection — remote_host text input + check_connection + speed_test.
//
// Result cards render with `.success` / `.error` left-border accent. Hidden
// until the user clicks the corresponding button.

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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
  const [busy, setBusy] = useState<"" | "conn" | "speed">("");

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
            placeholder="192.168.50.1"
            value={settings.network.remote_host}
            onChange={(e) => setHost(e.target.value)}
          />
          <span className="settings-hint">직결 링크의 Windows 호스트 주소.</span>
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
