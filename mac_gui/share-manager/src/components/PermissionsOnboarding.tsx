// PermissionsOnboarding.tsx — first-launch Full Disk Access walkthrough.
//
// macOS won't populate the FDA list unless the app actually attempts to
// access a protected location. On Ventura a single TCC.db probe was
// usually enough; Sonoma+ batches probes and may not surface us in the
// list on the first try (SP-B-1).
//
// Two-phase trigger for that reason:
//   1. On mount — has_full_disk_access() runs as both the FDA probe AND
//      the polling driver.
//   2. Right before opening System Settings — trigger_mac_tcc_registration
//      hits multiple protected paths in one shot so tccd MUST register us
//      across every relevant privacy pane. A short delay lets tccd flush
//      before the System Settings UI reads its state.
//
// While the modal is open we poll has_full_disk_access every 1.5s. When
// the user toggles us ON in System Settings the poll returns true and
// the modal auto-dismisses with a success toast.

import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { api } from "../lib/api";
import { useToast } from "../lib/toast";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function PermissionsOnboarding({ isOpen, onClose }: Props) {
  const toast = useToast();
  const [granted, setGranted] = useState(false);

  // (a) Register us in the FDA list (one-shot, side effect of probe)
  // (b) Poll for the user toggling us ON and auto-close
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      try {
        const ok = await api.hasFullDiskAccess();
        if (cancelled) return;
        if (ok && !granted) {
          setGranted(true);
          toast("✓ 전체 디스크 접근 권한이 부여됐어요", "success");
          // close after a brief moment so the user sees the badge
          window.setTimeout(() => {
            if (!cancelled) onClose();
          }, 800);
          return;
        }
      } catch {
        /* ignore — keep polling */
      }
      timer = window.setTimeout(tick, 1500);
    };
    // Initial call registers in TCC list AND starts the poll loop.
    tick();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [isOpen, granted, toast, onClose]);

  // Reset granted state on close so the next opening polls fresh
  useEffect(() => {
    if (!isOpen) setGranted(false);
  }, [isOpen]);

  return (
    <Modal
      title={granted ? "✓ 권한 부여 완료" : "권한 설정 안내"}
      isOpen={isOpen}
      onClose={onClose}
      footer={
        granted ? (
          <button className="primary-btn" onClick={onClose}>
            확인
          </button>
        ) : (
          <>
            <button className="ghost-btn" onClick={onClose}>
              나중에
            </button>
            <button
              className="primary-btn"
              onClick={async () => {
                try {
                  // Force tccd to register us across all relevant privacy
                  // panels before the user sees the FDA list. Then a short
                  // delay so tccd flushes, then open System Settings.
                  await api.triggerMacTccRegistration();
                  await new Promise((r) => setTimeout(r, 250));
                  await api.openPrivacySettings("Privacy_AllFiles");
                } catch (e) {
                  console.warn("open_privacy_settings failed:", e);
                }
              }}
            >
              🔓 시스템 설정 열기
            </button>
          </>
        )
      }
    >
      {granted ? (
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
          전체 디스크 접근 권한이 활성화됐어요. 이제 데스크탑·Documents·외장
          드라이브·셰어 폴더에 자유롭게 접근할 수 있어요.
        </p>
      ) : (
        <>
          <p style={{ margin: "0 0 12px 0", fontSize: 13, lineHeight: 1.6 }}>
            share-manager 가 데스크탑·Documents·외장 디스크·셰어 폴더를 자유롭게 송수신
            하려면 <b>전체 디스크 접근 권한</b>이 필요합니다.
          </p>
          <ol
            style={{
              margin: 0,
              paddingLeft: 20,
              fontSize: 12.5,
              color: "var(--text-sec)",
              lineHeight: 1.7,
            }}
          >
            <li>아래 <b>시스템 설정 열기</b> 클릭</li>
            <li>리스트에서 <code>share-manager</code> 를 찾아 토글 <b>ON</b></li>
            <li>인증 (Touch ID / 암호) → 이 창이 자동으로 닫힘</li>
          </ol>
          <p className="settings-hint" style={{ marginTop: 14 }}>
            토글하면 1.5초 이내 자동 감지. 리스트에 안 보이면 시스템 설정 새로고침 (좌측
            카테고리 다시 클릭).
          </p>
        </>
      )}
    </Modal>
  );
}
