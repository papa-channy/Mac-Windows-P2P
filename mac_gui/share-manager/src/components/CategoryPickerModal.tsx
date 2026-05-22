// CategoryPickerModal.tsx — modal that appears after a single-file drop or
// when the user hits → 전송 on a tree row. Lets them pick a category,
// shows the target file, fires send_path() for each path.
//
// Multi-file drops bypass this modal and auto-send as "unclassified".

import { useState } from "react";
import { Modal } from "./Modal";
import { api } from "../lib/api";
import { CATEGORIES, DEFAULT_CATEGORY } from "../lib/categories";
import { useToast } from "../lib/toast";
import { basename } from "../lib/format";

interface Props {
  isOpen: boolean;
  paths: string[];
  onClose: () => void;
  onSent: () => void;
}

export function CategoryPickerModal({ isOpen, paths, onClose, onSent }: Props) {
  const [category, setCategory] = useState<string>(DEFAULT_CATEGORY);
  const [sending, setSending] = useState(false);
  const toast = useToast();

  if (paths.length === 0 && isOpen) {
    // shouldn't happen but be defensive
    onClose();
    return null;
  }
  const first = paths[0] ?? "";
  const restNote = paths.length > 1 ? ` 외 ${paths.length - 1}개` : "";

  const submit = async () => {
    setSending(true);
    let ok = 0;
    const errors: string[] = [];
    for (const p of paths) {
      try {
        await api.sendPath(p, category);
        ok++;
      } catch (e) {
        errors.push(`${p}: ${e}`);
      }
    }
    setSending(false);
    setCategory(DEFAULT_CATEGORY);
    onClose();
    if (ok > 0) toast(`Windows로 ${ok}개 항목 전송 완료`, "success");
    if (errors.length > 0) {
      toast(`전송 실패 ${errors.length}건: ${errors[0]}`, "error");
      console.error(errors);
    }
    onSent();
  };

  return (
    <Modal
      title="Windows로 보내기"
      isOpen={isOpen}
      onClose={sending ? () => void 0 : onClose}
      footer={
        <>
          <button className="ghost-btn" onClick={onClose} disabled={sending}>
            취소
          </button>
          <button className="primary-btn" onClick={submit} disabled={sending}>
            {sending ? "보내는 중…" : "Windows로 전송"}
          </button>
        </>
      }
    >
      <div className="caption">전송 대상</div>
      <div className="target-card">
        <div className="ti">{paths.length > 1 ? "🗂" : "📄"}</div>
        <div>
          <div className="tn">{basename(first) + restNote}</div>
          <div className="tm">{first}</div>
        </div>
      </div>

      <div className="caption" style={{ marginTop: 18 }}>카테고리</div>
      <select
        className="select"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        disabled={sending}
      >
        {CATEGORIES.map((c) => (
          <option key={c.key} value={c.key}>
            {c.emoji}   {c.label}
          </option>
        ))}
      </select>
    </Modal>
  );
}
