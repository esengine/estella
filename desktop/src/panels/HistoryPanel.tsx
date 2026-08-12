// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    HistoryPanel.tsx
 * @brief   Everything that has happened to this project, in order — with an
 *          agent turn as ONE row rather than the thirty-eight steps it took.
 *
 * The panel exists for the question "what did that do, and can I get out of
 * it". A run scattered across forty identical-looking rows answers neither: you
 * cannot see where it began, and taking it back means holding Ctrl+Z and hoping.
 * Folded, the run states what was asked and lists what it left behind — both
 * halves, entities and files — with one button that takes the lot.
 *
 * Oldest at the top, so the timeline reads downward and the place you are now
 * is the bottom. Undone steps stay, greyed: forward is a place you can go, and
 * a list that dropped them would be a list of the past rather than a timeline.
 */
import { useRef, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { ChevronRight, Undo2, Bot, File as FileIcon, History as HistoryIcon } from 'lucide-react';
import { EditorHistory, type HistoryChange, type HistoryMark } from '@/engine/EditorHistory';
import { historyRows, tally, turnChanges, type HistoryRow, type TurnRow } from '@/engine/historyGroups';
import { useAgent, dismissCheckpoint } from '@/store/AgentStore';
import { useSelection } from '@/store/selectionStore';
import { EmptyState } from '@/components/EmptyState';
import { planRewind, rewind, reportRewind } from '@/engine/rewind';
import { confirm } from '@/components/confirm';
import { t } from '@/i18n';

export function HistoryPanel() {
  useSyncExternalStore(EditorHistory.subscribe, EditorHistory.getVersion);
  const turns = useAgent((s) => s.turns);
  const rows = historyRows(EditorHistory.list(), turns);

  // The bottom is where you are. A panel that stayed put while a run recorded
  // forty steps would leave the newest work out of sight for the whole run.
  const end = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [rows.length]);

  if (rows.length === 0) {
    return <EmptyState icon={HistoryIcon} title={t('hist.empty')} hint={t('hist.empty.hint')} />;
  }
  return (
    <div className="hist">
      {rows.map((row) => <Row key={rowKey(row)} row={row} />)}
      <div ref={end} />
    </div>
  );
}

const rowKey = (row: HistoryRow): string =>
  (row.kind === 'turn' ? `t${row.id}` : `s${row.step.id}`);

/**
 * Put the project back to a point — the ONE operation, whichever row asked.
 * Walking the undo stack is reversible and asks nothing; taking agent runs with
 * it is not, so that case stops first and states how many runs, how many files,
 * and what it would leave behind. Answers whether it happened.
 */
async function goBackTo(point: number): Promise<boolean> {
  const plan = planRewind(point, useAgent.getState().turns);
  if (plan.runs.length > 0) {
    const ok = await confirm({
      title: t('hist.rewind.title', { runs: plan.runs.length }),
      body: plan.stranded.length > 0
        ? `${t('hist.rewind.body', { files: plan.files.length })}\n\n`
          + t('hist.rewind.stranded', { paths: plan.stranded.map((f) => f.path).join(', ') })
        : t('hist.rewind.body', { files: plan.files.length }),
      confirmLabel: t('hist.rewind.go'),
      danger: true,
    });
    if (!ok) return false;
  }
  reportRewind(await rewind(plan));
  return true;
}

function Row({ row }: { row: HistoryRow }) {
  if (row.kind === 'turn') return <TurnGroup row={row} />;
  const { step } = row;
  return (
    <button
      type="button"
      className={`hist-row${step.undone ? ' undone' : ''}`}
      onClick={() => void goBackTo(step.id)}
    >
      <span className="hist-lbl">{step.label}</span>
      <Tally counts={tally(step.changes)} />
    </button>
  );
}

function TurnGroup({ row }: { row: TurnRow }) {
  const [open, setOpen] = useState(false);
  const [reverting, setReverting] = useState(false);
  const changes = turnChanges(row);
  const counts = tally(changes, row.files);

  const revert = async (): Promise<void> => {
    setReverting(true);
    try {
      // Its mark is the point just before it — the same operation a bare row
      // runs, aimed at where this run began.
      if (await goBackTo((row.mark as HistoryMark | null)?.seq ?? 0)) {
        // The floating checkpoint bar is about this same turn; leaving it up
        // after its offer has been taken would invite taking it twice.
        dismissCheckpoint(row.id);
      }
    } finally {
      setReverting(false);
    }
  };

  return (
    <div className={`hist-turn${open ? ' open' : ''}${row.undone ? ' undone' : ''}`}>
      <div className="hist-turn-h">
        <button type="button" className="hist-turn-t" onClick={() => setOpen((o) => !o)}>
          <ChevronRight size={11} strokeWidth={2} className="hist-car" />
          <Bot size={12} strokeWidth={1.8} className="hist-bot" />
          <span className="hist-lbl">{t('hist.turn', { prompt: row.prompt })}</span>
          <Tally counts={counts} />
        </button>
        {/* Only on the newest run. The stack is linear, so an older one's revert
            would reach past itself — historyGroups decides, this renders. */}
        {row.revertable && (
          <button
            type="button"
            className="hist-revert"
            disabled={reverting}
            title={t('hist.revert.why')}
            onClick={() => void revert()}
          >
            <Undo2 size={11} strokeWidth={2} />{t('hist.revert')}
          </button>
        )}
      </div>
      {open && (
        <div className="hist-turn-l">
          {row.files.map((f) => (
            <button
              type="button"
              className={`hist-chg k-${f.kind}`}
              key={`f:${f.path}`}
              title={f.path}
              onClick={() => useSelection.getState().selectAsset(f.path)}
            >
              <span className="hist-sig">{SIGIL[f.kind]}</span>
              <FileIcon size={10} strokeWidth={1.8} className="hist-ico" />
              <span className="hist-what">{f.path}</span>
              {f.unjournaled && <span className="hist-note">{t('agent.changes.tooBig')}</span>}
            </button>
          ))}
          {changes.map((c, i) => (
            <button
              type="button"
              className={`hist-chg k-${c.kind}`}
              key={`e:${i}`}
              onClick={() => useSelection.getState().select(c.entity)}
            >
              <span className="hist-sig">{SIGIL[c.kind]}</span>
              <span className="hist-what">{describe(c)}</span>
            </button>
          ))}
          {changes.length === 0 && row.files.length === 0 && (
            <div className="hist-chg quiet">{t('hist.turn.silent', { count: row.steps.length })}</div>
          )}
        </div>
      )}
    </div>
  );
}

const SIGIL: Record<'add' | 'modify' | 'remove', string> = { add: '+', modify: '~', remove: '−' };

/** An entity change as one line: the name it had, then what about it changed. */
function describe(c: HistoryChange): string {
  const what = [c.component, c.field].filter(Boolean).join('.');
  return what ? `${c.name} · ${what}` : c.name;
}

function Tally({ counts }: { counts: { add: number; modify: number; remove: number } }) {
  if (counts.add + counts.modify + counts.remove === 0) return null;
  return (
    <span className="hist-tally">
      {counts.add > 0 && <span className="k-add">+{counts.add}</span>}
      {counts.modify > 0 && <span className="k-modify">~{counts.modify}</span>}
      {counts.remove > 0 && <span className="k-remove">−{counts.remove}</span>}
    </span>
  );
}
