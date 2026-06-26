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

/**
 * Returns true if it's safe to proceed with a destructive document action: when
 * there are no unsaved changes, or the user confirms discarding them. `what`
 * names the consequence, e.g. "Creating a new scene will discard them".
 */
export function confirmDiscard(what = 'They will be lost'): boolean {
  if (!EditorHistory.isDirty()) return true;
  return window.confirm(`You have unsaved changes. ${what}. Continue?`);
}
