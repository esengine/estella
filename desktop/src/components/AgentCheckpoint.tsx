// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AgentCheckpoint.tsx
 * @brief   The one gesture that takes a whole agent turn back, floating over the
 *          viewport where the result of that turn actually is.
 *
 * It appears only when the turn left steps behind. A bar offering to undo zero
 * steps is a claim the user has to disprove by clicking it, and the kernel
 * already reports 0 for exactly that reason.
 *
 * The revert runs in this window, not through main: the checkpoint is a mark in
 * THIS EditorHistory, and the agent that made the edits deliberately has no tool
 * for rolling them back — a model that can undo its own work can undo the user's
 * and call it a correction.
 */
import { useSyncExternalStore } from 'react';
import { Undo2, Check } from 'lucide-react';
import { useAgent, dismissCheckpoint } from '@/store/AgentStore';
import { EditorHistory } from '@/engine/EditorHistory';
import type { HistoryMark } from '@/engine/EditorHistory';
import { Toasts } from '@/store/Toasts';
import { t } from '@/i18n';

export function AgentCheckpoint() {
  const turns = useAgent((s) => s.turns);
  const done = useAgent((s) => s.checkpointDone);
  // Re-read across every edit: what an Undo would now take back changes as the
  // user keeps working, and the bar has to say so before they press it.
  const version = useSyncExternalStore(EditorHistory.subscribe, EditorHistory.getVersion);

  const last = turns[turns.length - 1];
  if (!last || last.reason === null || last.steps === 0 || done === last.id) return null;
  const mark = last.mark as HistoryMark | null;
  if (!mark) return null;

  // More steps on the stack than the turn recorded means the user has edited
  // since. Undo would take those back too, so say so rather than quietly doing it.
  void version;
  const now = EditorHistory.stepsSince(mark);
  const stale = now > last.steps;

  return (
    <div className={`ag-cp${stale ? ' stale' : ''}`}>
      <span className="ag-cp-what">{last.prompt}</span>
      <span className="ag-cp-stat">{t('agent.checkpoint.steps', { count: last.steps })}</span>
      {stale && <span className="ag-cp-stale">{t('agent.checkpoint.stale')}</span>}
      <span className="ag-cp-acts">
        <button
          type="button"
          onClick={() => {
            const undone = EditorHistory.undoToMark(mark);
            dismissCheckpoint(last.id);
            Toasts.push(t('agent.checkpoint.undone', { count: undone }), 'info');
          }}
        >
          <Undo2 size={13} strokeWidth={1.9} />{t('agent.checkpoint.undo')}
        </button>
        <button type="button" className="keep" onClick={() => dismissCheckpoint(last.id)}>
          <Check size={13} strokeWidth={2} />{t('agent.checkpoint.keep')}
        </button>
      </span>
    </div>
  );
}
