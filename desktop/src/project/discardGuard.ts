// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  discardGuard.ts
 * @brief The single unsaved-changes gate. Any action that would discard open
 *        documents (new / open / close / switch) calls this first, so the
 *        prompt logic lives in one place and reflects the REAL dirty state —
 *        the DirtyRegistry aggregate (scene + every open asset editor), not
 *        just the scene's EditorHistory.
 */
import { DirtyRegistry } from '@/document/DirtyRegistry';
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
  if (!DirtyRegistry.isDirty()) return true;
  return ask(what);
}

/**
 * Per-document variant: guards ONE editor document (an asset editor about to
 * load another file, a dock tab about to close) — the aggregate registry would
 * wrongly trip on OTHER dirty documents the action doesn't touch. The caller
 * passes that document's dirty state.
 */
export async function confirmDiscardDoc(dirty: boolean, what = t('discard.default')): Promise<boolean> {
  if (!dirty) return true;
  return ask(what);
}

function ask(what: string): Promise<boolean> {
  return confirm({
    title: t('discard.title'),
    body: t('discard.body', { what }),
    confirmLabel: t('discard.confirm'),
    danger: true,
  });
}
