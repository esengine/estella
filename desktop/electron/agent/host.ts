// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    host.ts
 * @brief   Main's owner of the live agent conversation: one session, one turn at
 *          a time, and the stream the editor window renders from.
 *
 * The session lives here for the same reason the MCP endpoint does — it holds
 * something the window cannot be trusted with (the API key) and must survive a
 * renderer that reloads mid-turn. The window keeps a MIRROR (store/AgentStore.ts)
 * built from the messages this pushes, so the transcript and the session cannot
 * disagree about what happened.
 *
 * Two invariants the rest of the editor is allowed to rely on:
 *
 *   1. An accepted `send` ALWAYS ends with exactly one `turn_end`. runTurn takes
 *      its checkpoint before its own try block, so a turn can reject before it
 *      ever starts (no editor window, no automation hook); a UI left in "running"
 *      by that has no way back short of a restart.
 *   2. A pending confirmation is always answered. Abort, session reset and a
 *      finished turn all resolve it as declined — a kernel awaiting a promise
 *      nobody will settle is a hang, not an error anyone can see.
 */
import { runTurn, agentTools } from './kernel';
import { SYSTEM_PROMPT, editorContext } from './prompt';
import type { AgentEvent, AgentProvider, AgentSession, ConfirmRequest } from './types';
import type { SurfaceDriver } from '../surfaceDriver';

export type AgentPhase = 'idle' | 'running' | 'awaiting_confirm';

/** The conversation as the editor window is allowed to see it. */
export interface AgentStatus {
  /** A credential is configured, so a session can be created at all. */
  ready: boolean;
  /** Open — follow-ups continue it, and the transcript below is about it. */
  conversation: boolean;
  phase: AgentPhase;
  /** The model of the running session, once there is one. */
  model: string | null;
  /** Why the last attempt did not happen. Cleared by one that does. */
  error: string | null;
}

/** One push to the window: a transcript event, or the mirror's new state. */
export type AgentMessage =
  | { kind: 'event'; event: AgentEvent }
  | { kind: 'status'; status: AgentStatus };

export interface AgentHostDeps {
  /** The one driver every consumer shares (surfaceDriver.ts). */
  driver: SurfaceDriver;
  /** To the window. Must tolerate there not being one. */
  push(message: AgentMessage): void;
  /** Whether a credential exists — the status bit, without decrypting it. */
  ready(): boolean;
  /** Build the provider, or throw with a sentence the user can act on. */
  provider(): AgentProvider;
}

export interface AgentHost {
  status(): AgentStatus;
  /** Start a turn. Returns the resulting status — including a refusal, which is
   *  an `error` on it rather than a rejection. Does not wait for the turn. */
  send(text: string): AgentStatus;
  /** Abort the running turn. Idempotent, and a no-op when nothing runs. */
  stop(): void;
  /** Answer a pending confirmation. Unknown ids are ignored — the turn it
   *  belonged to may have been aborted between the ask and the click. */
  confirm(callId: string, allow: boolean): void;
  /** Drop the conversation and start over; the next turn re-reads the key. */
  reset(): AgentStatus;
  /**
   * Re-push the status because something OUTSIDE changed it — the window picked
   * a different provider, so `ready` now answers differently. Without this the
   * mirror only learns on the next transition, and the drawer keeps saying
   * "no model configured" at a user who just configured one.
   */
  announce(): void;
}

export function createAgentHost(deps: AgentHostDeps): AgentHost {
  let session: AgentSession | null = null;
  let model: string | null = null;
  let phase: AgentPhase = 'idle';
  let error: string | null = null;
  let running: AbortController | null = null;
  const pending = new Map<string, (allow: boolean) => void>();

  const status = (): AgentStatus => ({
    ready: deps.ready(),
    conversation: session !== null,
    phase,
    model,
    error,
  });

  const pushStatus = (): void => deps.push({ kind: 'status', status: status() });
  const emit = (event: AgentEvent): void => deps.push({ kind: 'event', event });

  /** Settle every outstanding ask as declined. See invariant 2. */
  const settlePending = (): void => {
    for (const resolve of pending.values()) resolve(false);
    pending.clear();
  };

  const confirm = (request: ConfirmRequest): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      pending.set(request.callId, resolve);
      phase = 'awaiting_confirm';
      pushStatus();
    });

  const send = (text: string): AgentStatus => {
    if (phase !== 'idle') {
      error = 'the agent is still working on the previous message';
      pushStatus();
      return status();
    }
    if (!session) {
      try {
        const provider = deps.provider();
        session = provider.createSession({ system: SYSTEM_PROMPT, tools: agentTools() });
        model = provider.model;
      } catch (e) {
        error = (e as Error)?.message ?? String(e);
        pushStatus();
        return status();
      }
    }

    error = null;
    phase = 'running';
    const controller = new AbortController();
    running = controller;
    pushStatus();

    void (async () => {
      try {
        // Gathered here rather than in the kernel: what the editor is showing is
        // this host's business, and a kernel that read the editor for itself
        // would be a second definition of "what the agent knows".
        const context = await editorContext(deps.driver).catch(() => null);
        await runTurn(
          { driver: deps.driver, session: session!, confirm, emit },
          text,
          context,
          controller.signal,
        );
      } catch (e) {
        // Invariant 1: runTurn rejected, so it emitted no turn_end of its own.
        // The reason goes on the status rather than into the transcript — this
        // path is reached BEFORE the turn starts (runTurn takes its checkpoint
        // outside its own try), so there is no turn for it to be part of.
        error = (e as Error)?.message ?? String(e);
        emit({ type: 'turn_end', steps: 0, mark: null, reason: 'error' });
      } finally {
        settlePending();
        // A turn that was superseded by a reset must not walk the phase back:
        // reset already put it at idle for a conversation this one is no longer
        // part of.
        if (running === controller) {
          running = null;
          phase = 'idle';
          pushStatus();
        }
      }
    })();

    return status();
  };

  return {
    status,
    send,
    stop: () => {
      running?.abort();
      // The kernel may be parked on a confirmation, which an aborted signal does
      // not interrupt — it is waiting on us, not on the model.
      settlePending();
    },
    confirm: (callId, allow) => {
      const resolve = pending.get(callId);
      if (!resolve) return;
      pending.delete(callId);
      resolve(allow);
      if (pending.size === 0 && phase === 'awaiting_confirm') {
        phase = 'running';
        pushStatus();
      }
    },
    announce: pushStatus,
    reset: () => {
      running?.abort();
      running = null;
      settlePending();
      session = null;
      model = null;
      phase = 'idle';
      error = null;
      pushStatus();
      return status();
    },
  };
}
