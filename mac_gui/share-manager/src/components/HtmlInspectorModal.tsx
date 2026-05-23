// HtmlInspectorModal — T6 send-pre-flight UI. Shown when the user is
// about to send one or more .html files that reference local assets
// (css/js/img siblings). Mirror of windows_gui/.../app.js
// showHtmlWarn + closeHtmlWarn.
//
// Three choices:
//   - cancel:  abort the entire batch
//   - folder:  swap each flagged html for its parent dir
//              (so the assets ship along)
//   - proceed: send the .html files as-is (user accepts the risk)

import { Modal } from "./Modal";
import type { HtmlInspect } from "../lib/api";

export interface FlaggedHtml {
  path: string;
  info: HtmlInspect;
}

export type HtmlInspectorChoice = "cancel" | "proceed" | "folder";

interface Props {
  isOpen: boolean;
  flagged: FlaggedHtml[];
  onChoice: (choice: HtmlInspectorChoice) => void;
}

export function HtmlInspectorModal({ isOpen, flagged, onChoice }: Props) {
  if (!isOpen) return null;
  const totalMissing = flagged.reduce(
    (acc, f) => acc + f.info.assets.filter((a) => !a.exists).length,
    0,
  );

  return (
    <Modal
      title="⚠ HTML asset check"
      isOpen={isOpen}
      onClose={() => onChoice("cancel")}
      footer={
        <>
          <button className="ghost-btn" onClick={() => onChoice("cancel")}>
            취소
          </button>
          <button
            className="ghost-btn"
            onClick={() => onChoice("proceed")}
            title="Send the .html files alone — referenced assets will be missing on the other side."
          >
            그대로 보내기
          </button>
          <button
            className="primary-btn"
            onClick={() => onChoice("folder")}
            title="Send the parent folder so sibling assets ship along."
          >
            폴더째 보내기
          </button>
        </>
      }
    >
      <p className="html-inspector-summary">
        <b>{flagged.length}</b>개 HTML 이 로컬 의존 자산을 참조해요.
        {totalMissing > 0 && (
          <>
            {" "}그 중 <b>{totalMissing}</b>개는 같은 폴더에 없어요.
          </>
        )}{" "}
        <code>.html</code> 만 보내면 그 자산들이 함께 가지 않아요.
      </p>

      <div className="html-inspector-body">
        {flagged.map((f) => (
          <FlaggedFile key={f.path} flagged={f} />
        ))}
      </div>
    </Modal>
  );
}

function FlaggedFile({ flagged }: { flagged: FlaggedHtml }) {
  const { path, info } = flagged;
  const name = path.replace(/^.*[\\/]/, "");
  return (
    <details className="html-inspector-file" open>
      <summary>
        <span className="html-inspector-name">{name}</span>
        <span className="html-inspector-count">
          {info.assets.length} ref{info.assets.length === 1 ? "" : "s"}
          {info.has_inline_style && " · inline <style>"}
        </span>
      </summary>
      <ul className="html-inspector-assets">
        {info.assets.map((a, i) => (
          <li
            key={i}
            className={
              "html-inspector-asset html-inspector-asset-" +
              a.kind +
              (a.exists ? " is-present" : " is-missing")
            }
          >
            <span className="html-inspector-kind">{a.kind}</span>
            <code className="html-inspector-ref">{a.reference}</code>
            <span className="html-inspector-status">
              {a.exists ? "✓ present" : "✗ missing"}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
