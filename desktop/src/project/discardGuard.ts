// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  discardGuard.ts
 * @brief The single unsaved-changes gate. Any action that would discard the
 *        current scene (new / open / close / switch) calls this first, so the
 *        prompt logic lives in one place and reflects the REAL dirty state
 *        (EditorHistory.isDirty), not the old `canUndo` proxy that stayed true
 *        after a save and false-warned.
 */
import { EditorHistory } from '@/engine/EditorHistory';
import { confirm } from '@/components/confirm';
import { t } from '@/i18n';

/**
 * Resolves true if it's safe to proceed with a destructive document action:
 * when there are no unsaved changes, or the user confirms discarding them.
 * `what` names the consequence, PRE-TRANSLATED and without a trailing period —
 * e.g. t('discard.newScene'); the body template owns the punctuation.
 * Async (a themed dialog, not window.confirm) — callers gate with
 * `if (!(await confirmDiscard(...))) return;`.
 */
export async function confirmDiscard(what = t('discard.default')): Promise<boolean> {
  if (!EditorHistory.isDirty()) return true;
  return confirm({
    title: t('discard.title'),
    body: t('discard.body', { what }),
    confirmLabel: t('discard.confirm'),
    danger: true,
  });
}
