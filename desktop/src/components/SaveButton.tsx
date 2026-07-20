// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  SaveButton.tsx
 * @brief The shared dirty-aware Save button for asset-editor toolbars — one
 *        recipe replacing the per-editor `fb-save` / `ts-save` / `seq` copies.
 *        Disabled when clean; shows the dirty dot while there are unsaved edits.
 */
import { Save } from 'lucide-react';
import { DirtyDot } from './DirtyDot';
import { t } from '@/i18n';

export function SaveButton(props: {
  dirty: boolean;
  onSave: () => void;
  label?: string;
  title?: string;
  className?: string;
}) {
  const { dirty, onSave, label, title, className } = props;
  return (
    <button
      type="button"
      className={`save-btn${className ? ` ${className}` : ''}`}
      disabled={!dirty}
      title={title}
      onClick={onSave}
    >
      <Save size={13} /> {label ?? t('ui.save')}{dirty && <DirtyDot />}
    </button>
  );
}
