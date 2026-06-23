// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Modal.tsx — a centered modal dialog (backdrop + portal). The editor's
 *        general dialog primitive: dismiss on backdrop press / Escape, with a
 *        titled header, scrollable body, and an optional footer (action row).
 */
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 460,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        style={{ width }}
        role="dialog"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <span className="modal__title">{title}</span>
          <button type="button" className="modal__x" title="Close" onClick={onClose}>
            <X size={15} strokeWidth={2} />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
