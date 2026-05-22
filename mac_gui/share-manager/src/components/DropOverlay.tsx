// DropOverlay.tsx — fullscreen blur overlay shown while a drag is over the
// window. Pointer-events: none in CSS so it doesn't intercept the drop —
// Tauri's window-level drag-drop listener handles that.

interface Props {
  visible: boolean;
}

export function DropOverlay({ visible }: Props) {
  if (!visible) return null;
  return (
    <div className="drop-overlay">
      <div className="drop-card">
        <div className="drop-icon">↓</div>
        <div className="drop-title">Windows로 보내기</div>
        <div className="drop-hint">놓으면 카테고리 선택 창이 열려요</div>
      </div>
    </div>
  );
}
