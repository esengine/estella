// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    agentFresh.ts
 * @brief   Which rows the agent touched JUST NOW, as opposed to at some point.
 *
 * The dot beside a touched row is a standing fact — the agent has been here,
 * and it stays until the checkpoint is acknowledged. A standing mark cannot
 * also carry "this happened a second ago": a row created while you were reading
 * another part of the tree arrives looking exactly like one from four turns
 * back. So arrival gets its own moment and then stops being special.
 *
 * The membership test is pure and separately tested; the hook is the thin part
 * that owns a timer.
 */
import { useEffect, useRef, useState } from 'react';

/**
 * The ids in `next` that were not in `prev`.
 *
 * Additions only. A row LEAVING the set (the checkpoint was acknowledged, so
 * every dot clears at once) is not an event anyone needs flagged — and treating
 * it as one would flash the whole tree on the click that was meant to calm it.
 */
export function newlyAdded(prev: ReadonlySet<number>, next: ReadonlySet<number>): number[] {
  const out: number[] = [];
  for (const id of next) if (!prev.has(id)) out.push(id);
  return out;
}

/** How long a row stays fresh. Matches the `ag-settle` animation in agent.css —
 *  the class has to outlive the animation, or it stops mid-way. */
const FRESH_MS = 900;

/**
 * The subset of `touched` that arrived since the last change.
 *
 * Empty on first render however much is already touched: reopening the panel is
 * not the agent doing something, and a tree that lights up on mount teaches
 * people to ignore the light.
 */
export function useAgentFresh(touched: ReadonlySet<number>): ReadonlySet<number> {
  const seen = useRef<ReadonlySet<number> | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<number>>(() => new Set());

  useEffect(() => {
    const prev = seen.current;
    seen.current = touched;
    // First run: adopt the set without announcing any of it.
    if (prev === null) return;
    const added = newlyAdded(prev, touched);
    if (added.length === 0) return;
    setFresh((f) => new Set([...f, ...added]));
    const id = setTimeout(() => {
      // Only this burst expires — a later one keeps its own moment, which is why
      // the timer removes rather than clearing.
      setFresh((f) => {
        const next = new Set(f);
        for (const e of added) next.delete(e);
        return next;
      });
    }, FRESH_MS);
    return () => clearTimeout(id);
  }, [touched]);

  return fresh;
}
