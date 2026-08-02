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
import type { AgentEvent, AgentProvider, AgentSession, ConfirmAnswer, ConfirmRequest } from './types';
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
  confirm(callId: string, answer: ConfirmAnswer): void;
  /** Drop the conversation and start over; the next turn re-reads the key. */
  reset(): AgentStatus;
  /**
   * Ask the `n`-th turn again, discarding it and everything after. The point of
   * having it: a bad answer three turns in should cost you that answer, not the
   * whole conversation leading up to it.
   */
  retry(n: number, text: string): AgentStatus;
  /**
   * Every event of the open conversation, in order, so a window that was not
   * there for them can rebuild the transcript.
   *
   * The stream is the record. A reloaded renderer used to come back to an empty
   * drawer while this host still held the conversation — the model remembered
   * what the screen had forgotten, and a "re-ask" aimed at run 0 of a transcript
   * that started counting again rewound the session to somewhere nobody asked
   * for. Replaying is what makes the two sides agree again.
   */
  transcript(): readonly AgentEvent[];
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
  const pending = new Map<string, (answer: ConfirmAnswer) => void>();

  const status = (): AgentStatus => ({
    ready: deps.ready(),
    conversation: session !== null,
    phase,
    model,
    error,
  });

  const pushStatus = (): void => deps.push({ kind: 'status', status: status() });

  // The conversation as a replayable stream. Bounded, and trimmed by WHOLE runs
  // from the front: half a run replays as a run that never ended. Dropping the
  // oldest is safe only because a run's identity is the session's own index and
  // not its position here — see AgentSession.turnIndex.
  const log: AgentEvent[] = [];
  const LOG_LIMIT = 4000;

  const trimOldestRun = (): void => {
    const next = log.findIndex((e, i) => i > 0 && e.type === 'turn_start');
    // One run longer than the whole budget: keep it rather than corrupt it.
    if (next > 0) log.splice(0, next);
  };

  /** A re-ask discards that run and everything after it — here too, or the
   *  replay would hand a reloaded window the runs it just threw away. */
  const trimFrom = (turnIndex: number): void => {
    const at = log.findIndex((e) => e.type === 'turn_start' && e.index === turnIndex);
    if (at >= 0) log.length = at;
  };

  const emit = (event: AgentEvent): void => {
    log.push(event);
    if (log.length > LOG_LIMIT) trimOldestRun();
    deps.push({ kind: 'event', event });
  };

  /** Settle every outstanding ask as declined. See invariant 2. */
  const settlePending = (): void => {
    for (const resolve of pending.values()) resolve('no');
    pending.clear();
  };

  const confirm = (request: ConfirmRequest): Promise<ConfirmAnswer> =>
    new Promise<ConfirmAnswer>((resolve) => {
      pending.set(request.callId, resolve);
      phase = 'awaiting_confirm';
      pushStatus();
    });

  const send = (text: string, rewindTo?: number): AgentStatus => {
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

    if (rewindTo !== undefined) {
      session.rewindTo(rewindTo);
      trimFrom(rewindTo);
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
          { driver: deps.driver, session: session!, model: model ?? '', confirm, emit },
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
    send: (text: string) => send(text),
    // A retry with no session yet is just a first message — nothing to rewind to.
    retry: (n, text) => send(text, session ? n : undefined),
    stop: () => {
      running?.abort();
      // The kernel may be parked on a confirmation, which an aborted signal does
      // not interrupt — it is waiting on us, not on the model.
      settlePending();
    },
    confirm: (callId, answer) => {
      const resolve = pending.get(callId);
      if (!resolve) return;
      pending.delete(callId);
      resolve(answer);
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
      log.length = 0;
      // Straight to the window, not through `emit`: the log it would join was
      // just emptied, and a window attaching later has nothing to reset.
      deps.push({ kind: 'event', event: { type: 'conversation_reset' } });
      pushStatus();
      return status();
    },
    transcript: () => log,
  };
}
