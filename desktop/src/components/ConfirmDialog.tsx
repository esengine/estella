// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  ConfirmDialog.tsx — a themed yes/no confirm built on Modal, replacing
 *        native window.confirm (blocking, unthemed, no keyboard contract). A safe
 *        dialog focuses Confirm (Enter proceeds); a `danger` dialog focuses Cancel
 *        instead, so a reflexive Enter on "Discard unsaved changes?" can't destroy
 *        anything. Escape/backdrop cancel via Modal. `danger` also puts the error
 *        fill on the confirm action.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { t } from '@/i18n';
import { Modal } from './Modal';
import { Button } from './Button';

export function ConfirmDialog({
  title,
  body,
  confirmLabel = t('ui.ok'),
  danger,
  info,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  /** Destructive action — the confirm button wears the error fill. */
  danger?: boolean;
  /** Acknowledge-only — a single OK button, no Cancel. */
  info?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Runs after Modal's dialogFocus (child effects first), so this wins. A
  // destructive dialog seeds focus on Cancel (Enter = the safe choice); a safe or
  // info dialog seeds Confirm (Enter = proceed).
  const confirmBtn = useRef<HTMLButtonElement>(null);
  const cancelBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    (danger && !info ? cancelBtn : confirmBtn).current?.focus();
  }, [danger, info]);

  return (
    <Modal
      title={title}
      onClose={onCancel}
      width={420}
      footer={
        <>
          {!info && <Button ref={cancelBtn} onClick={onCancel}>{t('ui.cancel')}</Button>}
          <Button ref={confirmBtn} variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="confirm-body">{body}</div>
    </Modal>
  );
}
