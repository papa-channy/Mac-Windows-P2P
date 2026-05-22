// Modal.tsx — reusable modal primitive matching the Windows .modal layout:
//   .modal > .modal-backdrop + .modal-window(.modal-header / .modal-body / .modal-footer)
//
// ESC and backdrop click both dismiss. Body content is the children prop.

import { useEffect, type ReactNode } from "react";

interface Props {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  /** rendered in modal-footer; pass buttons here */
  footer?: ReactNode;
  children: ReactNode;
}

export function Modal({ title, isOpen, onClose, footer, children }: Props) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-window" role="dialog" aria-modal="true">
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
