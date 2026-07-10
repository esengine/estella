// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  ConfirmDialog.tsx — a themed yes/no confirm built on Modal, replacing
 *        native window.confirm (blocking, unthemed, no keyboard contract). The
 *        confirm button takes focus so Enter confirms; Escape/backdrop cancel
 *        via Modal. `danger` puts the error fill on the confirm action.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { Modal } from './Modal';

export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'OK',
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  /** Destructive action — the confirm button wears the error fill. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Runs after Modal's dialogFocus (child effects first), so this wins.
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => btn.current?.focus(), []);

  return (
    <Modal
      title={title}
      onClose={onCancel}
      width={420}
      footer={
        <>
          <button type="button" className="btn-soft" onClick={onCancel}>
            Cancel
          </button>
          <button
            ref={btn}
            type="button"
            className={`btn-soft ${danger ? 'is-danger' : 'is-primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="confirm-body">{body}</div>
    </Modal>
  );
}
