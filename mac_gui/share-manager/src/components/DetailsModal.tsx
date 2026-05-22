// DetailsModal.tsx — item details popup. Mirrors openDetails() in
// windows_gui/share-manager/src/app.js (app.js:1212–1233) plus a
// "🔍 검증" action that runs SHA-256 verification against the manifest.

import { useState } from "react";
import { Modal } from "./Modal";
import { api, type TransferItem, type VerifyResult } from "../lib/api";
import { useToast } from "../lib/toast";
import { fmtBytes, fmtFull, parseTransferName, prettyName } from "../lib/format";

interface Props {
  item: TransferItem | null;
  onClose: () => void;
}

export function DetailsModal({ item, onClose }: Props) {
  const toast = useToast();
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);

  // reset verify state whenever a new item is opened
  if (item && verifyResult && verifyResult.transfer_id !== (item.transfer_id ?? "")) {
    setVerifyResult(null);
  }

  if (!item) return null;
  const parsed = parseTransferName(item.name);
  const directionLabel =
    item.direction === "mac_to_windows" ? "Windows로 보냄" : "Windows에서 받음";

  const runVerify = async () => {
    if (!item.transfer_id) {
      toast("검증 불가: 매니페스트가 없어요 (orphan 파일)", "error");
      return;
    }
    setVerifying(true);
    setVerifyResult(null);
    try {
      const r = await api.verifyTransfer(item.transfer_id);
      setVerifyResult(r);
      if (r.ok) toast(`✓ 무결성 OK (${r.checked}개 확인)`, "success");
      else toast(`✗ 검증 실패 — 누락 ${r.missing} · 불일치 ${r.mismatches}`, "error");
    } catch (e) {
      toast("검증 명령 실패: " + String(e), "error");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Modal
      title={prettyName(item.name)}
      isOpen={!!item}
      onClose={onClose}
      footer={
        <>
          <button
            className="ghost-btn"
            onClick={runVerify}
            disabled={verifying || !item.transfer_id}
            title={item.transfer_id ? "SHA-256 으로 무결성 확인" : "매니페스트 없음 — 검증 불가"}
          >
            {verifying ? "검증 중…" : "🔍 검증"}
          </button>
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
      {item.transfer_id && (
        <Row label="transfer_id" value={item.transfer_id} mono />
      )}
      {verifyResult && <VerifyCard result={verifyResult} />}
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

function VerifyCard({ result }: { result: VerifyResult }) {
  return (
    <div
      className={"result-card " + (result.ok ? "success" : "error")}
      style={{ marginTop: 12 }}
    >
      <div className="result-row">
        <span className="result-key">검증 결과</span>
        <span className="result-val">
          {result.ok ? "✓ OK" : "✗ 실패"}
        </span>
      </div>
      <div className="result-row">
        <span className="result-key">확인 대상</span>
        <span className="result-val">{result.checked}개</span>
      </div>
      {result.missing > 0 && (
        <div className="result-row">
          <span className="result-key">누락</span>
          <span className="result-val">{result.missing}</span>
        </div>
      )}
      {result.mismatches > 0 && (
        <div className="result-row">
          <span className="result-key">SHA 불일치</span>
          <span className="result-val">{result.mismatches}</span>
        </div>
      )}
      {result.files.filter((f) => !f.ok).slice(0, 5).map((f, i) => (
        <div className="result-row" key={i}>
          <span className="result-key detail-mono">{f.path}</span>
          <span className="result-val detail-mono">
            {f.error ?? `expected ${f.expected.slice(0, 12)}… got ${f.actual.slice(0, 12)}…`}
          </span>
        </div>
      ))}
    </div>
  );
}
