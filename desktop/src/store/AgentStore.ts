// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AgentStore.ts
 * @brief   The built-in agent's conversation, as the editor renders it.
 *
 *          Main owns the session (electron/agent/host.ts) — the key, the model
 *          calls, the turn loop. This is its mirror, and the projection: main
 *          pushes a flat stream of what happened, and {@link applyAgentEvent}
 *          folds it into the runs the drawer draws. The fold lives here rather
 *          than in main because it is a rendering decision (what a "row" is, when
 *          two deltas are one paragraph), and rather than in a component because
 *          a projection with a state machine in it should be testable without one.
 *
 *          Rebuilt from the events alone: nothing here pairs a message with state
 *          kept on the side, so a reload that re-reads the stream lands in the
 *          same place.
 */
import { create } from 'zustand';
import type { AgentStatus, AgentMessage } from '../../electron/agent/host';
import type { AgentEvent, ConfirmRequest } from '../../electron/agent/types';

export type { AgentStatus, AgentEvent };

export type AgentEffect = 'read' | 'undoable' | 'irreversible';

/**
 * Where a call is. `queued` is the model having asked for it while an earlier
 * one still runs — the doc's "parallel, greyed, not three spinners" — and
 * `stopped` is a row the turn ended underneath, which is neither a failure nor
 * a success and should not be painted as either.
 */
export type ToolState = 'queued' | 'running' | 'awaiting' | 'ok' | 'error' | 'declined' | 'stopped';

const TERMINAL: ReadonlySet<ToolState> = new Set<ToolState>(['ok', 'error', 'declined', 'stopped']);

export interface AgentToolEntry {
  kind: 'tool';
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** Known once it actually starts; the model's request does not say. */
  effect: AgentEffect | null;
  state: ToolState;
  /** The result, shortened for one row. */
  summary: string | null;
  /** Why it needs saying out loud, while it is awaiting an answer. */
  reason: string | null;
}

export interface AgentProseEntry {
  kind: 'text' | 'thinking';
  text: string;
}

export interface AgentErrorEntry {
  kind: 'error';
  message: string;
}

export type AgentEntry = AgentProseEntry | AgentToolEntry | AgentErrorEntry;

export type TurnReason = 'end_turn' | 'aborted' | 'error' | 'refusal';

export interface AgentTurn {
  /** Position in the conversation; stable, so React keys are too. */
  id: number;
  prompt: string;
  entries: AgentEntry[];
  inputTokens: number;
  outputTokens: number;
  /** What one Undo would take back, once the turn ended. 0 means don't offer it. */
  steps: number;
  /** Where that Undo would go back to (EditorHistory.undoToMark). */
  mark: unknown | null;
  /** null while the turn is still running. */
  reason: TurnReason | null;
}

const IDLE: AgentStatus = {
  ready: false, conversation: false, phase: 'idle', model: null, error: null,
};

interface AgentState {
  status: AgentStatus;
  turns: AgentTurn[];
  /**
   * A conversation is open in THIS window. Tracked separately from
   * `status.conversation` because the automation hook is published off it and
   * has to be up before main can call back in — see {@link sendAgentMessage}.
   */
  driving: boolean;
}

export const useAgent = create<AgentState>(() => ({ status: IDLE, turns: [], driving: false }));

/** The run still taking events, if any. Only the last one can be open. */
const openTurn = (turns: readonly AgentTurn[]): AgentTurn | null => {
  const last = turns[turns.length - 1];
  return last && last.reason === null ? last : null;
};

const patchLast = (turns: readonly AgentTurn[], patch: Partial<AgentTurn>): AgentTurn[] =>
  turns.map((t, i) => (i === turns.length - 1 ? { ...t, ...patch } : t));

const withEntries = (turns: readonly AgentTurn[], entries: AgentEntry[]): AgentTurn[] =>
  patchLast(turns, { entries });

/** Append a delta to the trailing paragraph of the same kind, or start one. */
function appendProse(entries: readonly AgentEntry[], kind: 'text' | 'thinking', delta: string): AgentEntry[] {
  const last = entries[entries.length - 1];
  if (last?.kind === kind) {
    return [...entries.slice(0, -1), { kind, text: last.text + delta }];
  }
  return [...entries, { kind, text: delta }];
}

/** Rewrite the tool row `id` — a no-op if the turn never saw it asked for. */
function patchTool(entries: readonly AgentEntry[], id: string, patch: Partial<AgentToolEntry>): AgentEntry[] {
  return entries.map((e) => (e.kind === 'tool' && e.id === id ? { ...e, ...patch } : e));
}

/**
 * Fold one event into the runs. Pure: same turns + same event ⇒ same result, so
 * the projection is a unit test rather than something only an editor can show.
 *
 * Events for a turn that is not open are dropped rather than opening one. The
 * host can end a turn that never started (its checkpoint is taken before its own
 * try block), and inventing a run to hold that would put an empty row in the
 * transcript for something the user never asked.
 */
export function applyAgentEvent(turns: readonly AgentTurn[], event: AgentEvent): AgentTurn[] {
  if (event.type === 'turn_start') {
    return [...turns, {
      id: turns.length,
      prompt: event.prompt,
      entries: [],
      inputTokens: 0,
      outputTokens: 0,
      steps: 0,
      mark: null,
      reason: null,
    }];
  }

  const open = openTurn(turns);
  if (!open) return turns as AgentTurn[];

  switch (event.type) {
    case 'text':
    case 'thinking':
      return withEntries(turns, appendProse(open.entries, event.type, event.delta));

    case 'tool_call':
      return withEntries(turns, [...open.entries, {
        kind: 'tool',
        id: event.call.id,
        name: event.call.name,
        input: event.call.input,
        effect: null,
        state: 'queued',
        summary: null,
        reason: null,
      }]);

    case 'tool_start':
      return withEntries(turns, patchTool(open.entries, event.call.id, {
        state: 'running', effect: event.effect,
      }));

    case 'awaiting_confirm':
      return withEntries(turns, patchTool(open.entries, event.request.callId, {
        state: 'awaiting', reason: event.request.reason,
      }));

    case 'tool_end':
      return withEntries(turns, open.entries.map((e) => {
        if (e.kind !== 'tool' || e.id !== event.id) return e;
        // A row the user already declined stays declined: the kernel reports the
        // decline as an ordinary failed call, and painting it as an error would
        // blame the tool for the user's answer.
        const state: ToolState = e.state === 'declined' ? 'declined' : event.ok ? 'ok' : 'error';
        return { ...e, state, summary: event.summary };
      }));

    case 'usage':
      return patchLast(turns, {
        inputTokens: open.inputTokens + event.inputTokens,
        outputTokens: open.outputTokens + event.outputTokens,
      });

    case 'error':
      return withEntries(turns, [...open.entries, { kind: 'error', message: event.message }]);

    case 'turn_end':
      return patchLast(turns, {
        reason: event.reason,
        steps: event.steps,
        mark: event.mark,
        // Nothing will report on these now. Neither failed nor succeeded.
        entries: open.entries.map((e) =>
          (e.kind === 'tool' && !TERMINAL.has(e.state) ? { ...e, state: 'stopped' as const } : e)),
      });

    // The turn's outcome arrives as turn_end's reason; the raw stop is the
    // provider's business.
    case 'stop':
      return turns as AgentTurn[];
  }
}

/**
 * A conversation main still holds means this window is driving, whatever it
 * remembers — a renderer that reloaded mid-conversation would otherwise leave
 * the automation hook down under a session that is still alive.
 */
function adoptStatus(status: AgentStatus): void {
  useAgent.setState((s) => ({ status, driving: s.driving || status.conversation }));
}

export function applyAgentMessage(message: AgentMessage): void {
  if (message.kind === 'status') {
    adoptStatus(message.status);
    return;
  }
  useAgent.setState((s) => ({ turns: applyAgentEvent(s.turns, message.event) }));
}

/** Subscribe to main and adopt what it is already doing. Returns an unsubscribe. */
export function attachAgentBridge(): () => void {
  const off = window.estella?.agent?.onMessage(applyAgentMessage) ?? (() => {});
  void window.estella?.agent?.status().then(adoptStatus);
  return off;
}

export async function sendAgentMessage(text: string): Promise<void> {
  // Before the IPC, not after: main drives this window through
  // `window.__estellaEditor`, which is published only while a driver is
  // authorized (engine/automationGate.ts) and this store is what says so for the
  // built-in agent. Waiting for main's status to come back would race the first
  // tool call of the turn we are starting.
  useAgent.setState({ driving: true });
  const status = await window.estella?.agent?.send(text);
  if (status) adoptStatus(status);
}

export function stopAgentTurn(): void {
  void window.estella?.agent?.stop();
}

/**
 * Tell main which endpoint and model to build the next session against.
 *
 * Pushed rather than read: settings live in this window's localStorage and main
 * owns the session, so this is the same one-way path the MCP toggle uses. The
 * settings' `effect` calls it — including the boot replay — and a partial patch
 * is merged in main, because the two rows are separate settings that each fire
 * on their own.
 */
export function setAgentEndpoint(patch: { baseUrl?: string; model?: string }): void {
  void window.estella?.agent?.setEndpoint(patch);
}

/**
 * Answer a pending confirmation. The row moves on the click rather than on
 * main's echo — the person just decided, and a row that sits on "waiting for
 * you" afterwards reads as a click that did not land.
 */
export function confirmAgentCall(callId: string, allow: boolean): void {
  useAgent.setState((s) => {
    const open = openTurn(s.turns);
    if (!open) return {};
    return {
      turns: patchLast(s.turns, {
        entries: patchTool(open.entries, callId, { state: allow ? 'running' : 'declined', reason: null }),
      }),
    };
  });
  void window.estella?.agent?.confirm(callId, allow);
}

/** Drop the conversation — a new one starts with the next message. */
export async function resetAgentSession(): Promise<void> {
  useAgent.setState({ turns: [], driving: false });
  const status = await window.estella?.agent?.reset();
  if (status) useAgent.setState({ status });   // not adoptStatus: reset just ended it
}

/** Whether an agent conversation authorizes the automation hook (main.tsx). */
export const agentDriving = (): boolean => useAgent.getState().driving;
export const subscribeAgent = (fn: () => void): (() => void) => useAgent.subscribe(fn);

export type { ConfirmRequest };
