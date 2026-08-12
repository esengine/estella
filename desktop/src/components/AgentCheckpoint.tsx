// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AgentCheckpoint.tsx
 * @brief   The one gesture that takes a whole agent turn back, floating over the
 *          viewport where the result of that turn actually is.
 *
 * A turn can change two things — the document and the project on disk — and this
 * takes back both: `EditorHistory.undoToMark` here, then main's file journal
 * over IPC. Undo runs FIRST so the document is at its pre-turn state before the
 * restored files arrive, which is what lets the reload land without a prompt.
 *
 * It appears whenever the turn left EITHER behind. A turn that only wrote files
 * has zero undo steps, and a bar that asked about steps alone offered nothing
 * for exactly the work undo could not reach.
 *
 * The revert runs from this window, not from main: the agent that made the edits
 * deliberately has no tool for rolling them back — a model that can undo its own
 * work can undo the user's and call it a correction.
 */
import { useState, useSyncExternalStore } from 'react';
import { Undo2, Check, Loader } from 'lucide-react';
import { useAgent, dismissCheckpoint, revertScope } from '@/store/AgentStore';
import { EditorHistory } from '@/engine/EditorHistory';
import type { HistoryMark } from '@/engine/EditorHistory';
import { planRewind, rewind, reportRewind } from '@/engine/rewind';
import { t } from '@/i18n';

export function AgentCheckpoint() {
  const turns = useAgent((s) => s.turns);
  const done = useAgent((s) => s.checkpointDone);
  const [reverting, setReverting] = useState(false);
  // Re-read across every edit: what an Undo would now take back changes as the
  // user keeps working, and the bar has to say so before they press it.
  const version = useSyncExternalStore(EditorHistory.subscribe, EditorHistory.getVersion);

  const last = turns[turns.length - 1];
  if (!last || done === last.id) return null;
  const mark = last.mark as HistoryMark | null;
  void version;
  const scope = revertScope(last, mark ? EditorHistory.stepsSince(mark) : 0);
  if (!scope) return null;
  const { files, stale, stranded } = scope;

  const revert = async (): Promise<void> => {
    setReverting(true);
    try {
      // The same one-way operation a History row runs, over this turn's own
      // point — there is one way to put the project back, not two.
      const result = await rewind(planRewind(mark?.seq ?? 0, [last]));
      dismissCheckpoint(last.id);
      reportRewind(result);
    } finally {
      setReverting(false);
    }
  };

  const keep = (): void => {
    dismissCheckpoint(last.id);
    if (last.tx) void window.estella?.agent?.keepFiles?.(last.tx);
  };

  return (
    <div className={`ag-cp${stale ? ' stale' : ''}`}>
      <span className="ag-cp-what">{last.prompt}</span>
      <span className="ag-cp-stat">
        {scope.steps > 0 && t('agent.checkpoint.steps', { count: scope.steps })}
        {scope.steps > 0 && files.length > 0 && ' · '}
        {files.length > 0 && t('agent.checkpoint.files', { count: files.length })}
      </span>
      {stale && <span className="ag-cp-stale">{t('agent.checkpoint.stale')}</span>}
      {stranded.length > 0 && (
        <span className="ag-cp-stale" title={stranded.map((f) => f.path).join('\n')}>
          {t('agent.checkpoint.tooBig', { count: stranded.length })}
        </span>
      )}
      <span className="ag-cp-acts">
        <button type="button" disabled={reverting} onClick={() => void revert()}>
          {reverting
            ? <Loader size={13} strokeWidth={1.9} className="ag-spin" />
            : <Undo2 size={13} strokeWidth={1.9} />}
          {t('agent.checkpoint.undo')}
        </button>
        <button type="button" className="keep" disabled={reverting} onClick={keep}>
          <Check size={13} strokeWidth={2} />{t('agent.checkpoint.keep')}
        </button>
      </span>
    </div>
  );
}
