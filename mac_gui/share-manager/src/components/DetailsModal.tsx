// DetailsModal.tsx — item details popup. Mirrors openDetails() in
// windows_gui/share-manager/src/app.js (app.js:1212–1233).
//
// Direction label is from the Mac side perspective:
//   mac_to_windows → "Windows로 보냄"     (outbox)
//   windows_to_mac → "Windows에서 받음"   (inbox)

import { Modal } from "./Modal";
import { api, type TransferItem } from "../lib/api";
import { useToast } from "../lib/toast";
import { fmtBytes, fmtFull, parseTransferName, prettyName } from "../lib/format";

interface Props {
  item: TransferItem | null;
  onClose: () => void;
}

export function DetailsModal({ item, onClose }: Props) {
  const toast = useToast();
  if (!item) return null;
  const parsed = parseTransferName(item.name);
  const directionLabel =
    item.direction === "mac_to_windows" ? "Windows로 보냄" : "Windows에서 받음";

  return (
    <Modal
      title={prettyName(item.name)}
      isOpen={!!item}
      onClose={onClose}
      footer={
        <>
          <button
            className="ghost-btn"
            onClick={() =>
              api.openPath(item.path).catch((e) => toast(String(e), "error"))
            }
          >
            열기
          </button>
          <button
            className="primary-btn"
            onClick={() =>
              api
                .revealInExplorer(item.path)
                .catch((e) => toast(String(e), "error"))
            }
          >
            Finder에서 보기
          </button>
        </>
      }
    >
      <Row label="카테고리" value={`${item.category_emoji} ${item.category_label}`} />
      <Row label="방향" value={directionLabel} />
      <Row label="상태" value={item.state} />
      <Row label="크기" value={fmtBytes(item.size_bytes)} />
      {parsed && (
        <Row label="버전" value={`v${parsed.version} · 전송일 ${parsed.date}`} />
      )}
      <Row label="수정 시각" value={fmtFull(item.modified_iso)} />
      <Row label="저장 파일명" value={item.name} mono />
      <Row label="전체 경로" value={item.path} mono />
    </Modal>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="detail-row">
      <div className="detail-label">{label}</div>
      <div className={"detail-value" + (mono ? " detail-mono" : "")}>{value}</div>
    </div>
  );
}
