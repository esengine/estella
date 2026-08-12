// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    rewind.ts
 * @brief   Putting the project back to a point on the timeline — both halves of
 *          it, which is the only version of the operation that is true.
 *
 * The document alone can walk the undo stack in either direction, and for a
 * while that was all a click on a history row did. It left the disk where it
 * was, so going back past an agent run gave the scene from before it and the
 * scripts from after: a state the project had never actually been in.
 *
 * So a rewind takes the runs with it. That makes it ONE-WAY — a reverted
 * transaction hands back its copies and cannot re-apply them — which is why the
 * plan is computed first and shown before anything moves, and why this is not
 * folded into EditorHistory.goTo, which is reversible and must stay so.
 */
import { EditorHistory, type HistoryMark } from './EditorHistory';
import { Toasts } from '@/store/Toasts';
import type { AgentTurn } from '@/store/AgentStore';
import type { FileChange } from '../../electron/agent/types';
import { t } from '@/i18n';

/** What going back to a point would take with it. */
export interface RewindPlan {
  /** The timeline point — every step past it is undone. */
  point: number;
  /** Agent runs whose whole transaction is past the point, oldest first. */
  runs: readonly { id: number; prompt: string; tx: string }[];
  /** Every project path those runs touched. */
  files: readonly FileChange[];
  /** Paths the journal could not hold, which a rewind therefore leaves. */
  stranded: readonly FileChange[];
}

/**
 * What a rewind to `point` would cover.
 *
 * A run counts only when ALL of it is past the point: a transaction is atomic
 * on disk, so there is no half of one to give back, and a point inside a run is
 * not a place the project can be put.
 */
export function planRewind(point: number, turns: readonly AgentTurn[]): RewindPlan {
  const runs: RewindPlan['runs'] = turns
    .filter((t) => t.tx && ((t.mark as HistoryMark | null)?.seq ?? -1) >= point)
    .map((t) => ({ id: t.id, prompt: t.prompt, tx: t.tx! }));
  const files = turns
    .filter((t) => runs.some((r) => r.id === t.id))
    .flatMap((t) => [...t.files]);
  return { point, runs, files, stranded: files.filter((f) => f.unjournaled) };
}

/** What actually happened, so the caller can report it rather than assume. */
export interface RewindResult {
  steps: number;
  restored: readonly string[];
  unjournaled: readonly string[];
  failed: readonly { path: string; error: string }[];
}

/**
 * Carry out `plan`. The DOCUMENT moves first, so it is already at its pre-run
 * state when the restored files land and the reload that follows has nothing to
 * ask about.
 */
export async function rewind(plan: RewindPlan): Promise<RewindResult> {
  const before = EditorHistory.list().filter((s) => !s.undone).length;
  EditorHistory.goTo(plan.point);
  const steps = before - EditorHistory.list().filter((s) => !s.undone).length;
  if (plan.runs.length === 0) return { steps, restored: [], unjournaled: [], failed: [] };

  const result = await window.estella?.agent?.revertFiles?.(plan.runs.map((r) => r.tx));
  return {
    steps,
    restored: result?.restored ?? [],
    unjournaled: result?.unjournaled ?? [],
    failed: result?.failed ?? [],
  };
}

/**
 * Say what a rewind managed, including what it could not. A toast reporting
 * success over a file still sitting there is how the one failure this whole
 * mechanism exists to prevent goes unnoticed until something breaks on it.
 */
export function reportRewind(result: RewindResult): void {
  Toasts.push(
    t('agent.checkpoint.undone', { count: result.steps, files: result.restored.length }),
    'info',
  );
  for (const f of result.failed) {
    Toasts.push(t('agent.checkpoint.failed', { path: f.path, error: f.error }), 'error');
  }
  if (result.unjournaled.length) {
    Toasts.push(t('agent.checkpoint.stranded', { paths: result.unjournaled.join(', ') }), 'warn');
  }
}
