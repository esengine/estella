// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The project-open load gate: a small store of the prewarm tasks the
 *        editor waits on before it's fully interactive (the editor engine boot,
 *        the play-realm engine prewarm, …). A LoadingScreen overlays the editor
 *        while any task is pending, so everything heavy is warmed up front —
 *        entering the editor and the FIRST Play are both smooth (Unreal-style).
 */
import { createStore } from 'zustand/vanilla';

export interface LoadTask {
  key: string;
  label: string;
  done: boolean;
}

interface LoadGateState {
  active: boolean;
  tasks: readonly LoadTask[];
}

class LoadGateImpl {
  private readonly store = createStore<LoadGateState>(() => ({ active: false, tasks: [] }));

  subscribe = (fn: () => void): (() => void) => this.store.subscribe(fn);
  getSnapshot = (): LoadGateState => this.store.getState();

  /** Open the gate with the prewarm tasks to wait on (all start pending). */
  begin(tasks: ReadonlyArray<{ key: string; label: string }>): void {
    this.store.setState({ active: true, tasks: tasks.map((t) => ({ ...t, done: false })) });
  }

  /** Mark a task complete; the gate closes once every task is done. */
  done(key: string): void {
    const tasks = this.store.getState().tasks.map((t) => (t.key === key ? { ...t, done: true } : t));
    this.store.setState({ tasks, active: tasks.some((t) => !t.done) });
  }

  /** Force the gate shut — the editor must never be stuck behind it (timeout / abort). */
  close(): void {
    this.store.setState({ active: false });
  }
}

/** Shared singleton — one load gate at a time (a project open is a single sequence). */
export const LoadGate = new LoadGateImpl();
