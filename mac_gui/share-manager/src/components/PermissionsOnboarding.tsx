// PermissionsOnboarding.tsx — shown once on the very first launch to walk
// the user through granting Full Disk Access. Without FDA macOS asks for
// per-folder permission every time we touch Desktop/Documents/Downloads/
// external drives, which gets painful fast.
//
// "처음 한 번" 판단은 localStorage 키 — share-manager.permissions_onboarded.

import { Modal } from "./Modal";
import { api } from "../lib/api";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function PermissionsOnboarding({ isOpen, onClose }: Props) {
  return (
    <Modal
      title="권한 설정 안내"
      isOpen={isOpen}
      onClose={onClose}
      footer={
        <>
          <button className="ghost-btn" onClick={onClose}>
            나중에
          </button>
          <button
            className="primary-btn"
            onClick={async () => {
              try {
                await api.openPrivacySettings("Privacy_AllFiles");
              } catch (e) {
                console.warn("open_privacy_settings failed:", e);
              }
            }}
          >
            🔓 시스템 설정 열기
          </button>
        </>
      }
    >
      <p style={{ margin: "0 0 12px 0", fontSize: 13, lineHeight: 1.6 }}>
        share-manager 가 데스크탑·Documents·외장 디스크·셰어 폴더를 자유롭게 송수신
        하려면 <b>전체 디스크 접근 권한</b>이 필요합니다. 권한 없이도 동작은 하지만
        매번 폴더마다 macOS 가 허용 여부를 물어봐서 번거로워요.
      </p>
      <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12.5, color: "var(--text-sec)", lineHeight: 1.7 }}>
        <li>아래 <b>시스템 설정 열기</b> 클릭</li>
        <li>좌측 자물쇠 클릭 → Touch ID / 암호 인증</li>
        <li>우측 목록에서 <code>share-manager</code> 토글을 <b>ON</b></li>
        <li>이 창으로 돌아와 <b>나중에</b> 또는 창 닫기</li>
      </ol>
      <p
        className="settings-hint"
        style={{ marginTop: 14 }}
      >
        한 번만 설정하면 됩니다. 안 켜도 앱은 동작하지만 macOS 권한 dialog 가 매번 뜸.
      </p>
    </Modal>
  );
}
