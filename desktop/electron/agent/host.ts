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
import { runTurn, agentTools, type ContributedTool } from './kernel';
import { SYSTEM_PROMPT, editorContext } from './prompt';
import type {
  AgentEvent, AgentProvider, AgentSession, ConfirmAnswer, ConfirmDecision, ConfirmRequest,
  KernelDeps, UserImage,
} from './types';
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
  /**
   * How the last turn ENDED — null before the first one.
   *
   * `phase` going back to 'idle' says a turn stopped, not whether it finished:
   * a run cut off at the round cap idles exactly like one that answered the
   * question. The drawer shows the difference (a badge, and a Resume); a driver
   * polling status could not see it at all, and read half a game as a delivered
   * one.
   */
  lastTurn: TurnEndReason | null;
}

/** Why a turn stopped. `max_rounds` and `aborted` leave the work UNFINISHED. */
export type TurnEndReason = 'end_turn' | 'aborted' | 'error' | 'refusal' | 'max_rounds';

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
  /**
   * Keep this conversation, or forget it. Absent (no project open) means the
   * conversation is not persisted, which is a fine state to be in — it is not
   * an error, and the host carries on either way.
   */
  persist?(conversation: PersistedConversation): void;
  /**
   * Tools loaded plugins have contributed, as the WINDOW last reported them.
   *
   * A pull rather than a push into this host: it is read once per session, and
   * the answer has to be whatever is true at that moment — a list captured at
   * construction would be the empty one, since plugins load after main does.
   */
  contributedTools?(): readonly ContributedTool[];
  /** The disk half of a turn's checkpoint. Absent in a host with no project —
   *  the kernel then confirms the writes it would otherwise have covered. */
  journal?: KernelDeps['journal'];
}

/** A conversation as the host hands it over to be kept. See agent/store.ts. */
export interface PersistedConversation {
  id: string;
  startedAt: number;
  model: string;
  endpoint: string;
  events: readonly AgentEvent[];
  memory: unknown;
}

export interface AgentHost {
  status(): AgentStatus;
  /** Start a turn, optionally with images the person attached. Returns the
   *  resulting status — including a refusal, which is an `error` on it rather
   *  than a rejection. Does not wait for the turn. */
  send(text: string, images?: readonly UserImage[]): AgentStatus;
  /** Abort the running turn. Idempotent, and a no-op when nothing runs. */
  stop(): void;
  /** Answer a pending confirmation. Unknown ids are ignored — the turn it
   *  belonged to may have been aborted between the ask and the click. */
  confirm(callId: string, answer: ConfirmAnswer, declined?: readonly number[]): void;
  /** Drop the conversation and start over; the next turn re-reads the key. */
  reset(): AgentStatus;
  /** Put a saved conversation back — transcript and memory both. */
  resume(conversation: PersistedConversation): AgentStatus;
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
  // Names the conversation on disk. Minted when a session is, so a reset starts
  // a new file rather than overwriting the one the user may want back.
  let conversationId: string | null = null;
  let startedAt = 0;
  let endpoint = '';
  /** Memory handed to the next session this creates — see {@link AgentHost.resume}. */
  let resuming: unknown;

  /** Sortable and filename-safe. Time first so a directory listing reads
   *  chronologically even before anything parses it. */
  const newId = (): string =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  /**
   * Hand the conversation over to be kept. Called when a turn ends rather than
   * on every event: a run is the unit anyone would want back, and the stream
   * carries one event per token.
   */
  const keep = (): void => {
    if (!deps.persist || !conversationId || !session) return;
    deps.persist({
      id: conversationId,
      startedAt,
      model: model ?? '',
      endpoint,
      events: log,
      memory: session.serialize(),
    });
  };
  let acceptsImages = true;
  let phase: AgentPhase = 'idle';
  let error: string | null = null;
  let lastTurn: TurnEndReason | null = null;
  let running: AbortController | null = null;
  const pending = new Map<string, (decision: ConfirmDecision) => void>();

  const status = (): AgentStatus => ({
    ready: deps.ready(),
    conversation: session !== null,
    phase,
    model,
    error,
    lastTurn,
  });

  // Deltas out first: status and transcript share one channel BECAUSE the two
  // must not be reordered, and a buffered delta is a transcript event that has
  // not left yet. (Defined below; hoisted, so this reads in the order it runs.)
  const pushStatus = (): void => {
    flushDeltas();
    deps.push({ kind: 'status', status: status() });
  };

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

  const record = (event: AgentEvent): void => {
    log.push(event);
    if (log.length > LOG_LIMIT) trimOldestRun();
    deps.push({ kind: 'event', event });
  };

  /**
   * Streaming deltas, merged before they leave main.
   *
   * A model writes a tool's arguments one JSON fragment at a time, and a scene
   * edit's arguments run to tens of kilobytes — hundreds of fragments, back to
   * back with nothing between them. Forwarded one by one, each cost an IPC
   * message, a store update that rebuilds the run's whole entry list, and a
   * re-render of the drawer. The renderer's main thread saturated exactly while
   * a call was being written, which is why the window froze mid-tool, would not
   * scroll, and appeared to ignore Stop — a blocked renderer cannot deliver the
   * click that would have stopped it either.
   *
   * Text that arrives 30 times a second reads exactly like text that arrives
   * 600 times a second, so consecutive deltas of one kind merge and go out on a
   * frame's delay. Everything else flushes them first: this sits at the one
   * place events leave for the window precisely so nothing can be reordered
   * around a merge — a store-side buffer could not promise that.
   */
  const FLUSH_MS = 33;
  let buffered: (AgentEvent & { delta: string }) | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const isDelta = (e: AgentEvent): e is AgentEvent & { delta: string } =>
    e.type === 'text' || e.type === 'thinking' || e.type === 'tool_args';

  /** Same kind, and for arguments the same call — two tools written in one
   *  response must not have their JSON concatenated into one of them. */
  const mergeable = (a: AgentEvent & { delta: string }, b: AgentEvent & { delta: string }): boolean =>
    a.type === b.type
    && (a.type !== 'tool_args' || (a as { id: string }).id === (b as unknown as { id: string }).id);

  const flushDeltas = (): void => {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (!buffered) return;
    const merged = buffered;
    buffered = null;
    record(merged);
  };

  /** Throw the buffer away — for a reset, whose log is emptied anyway. */
  const dropDeltas = (): void => {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    buffered = null;
  };

  const emit = (event: AgentEvent): void => {
    // Every ending passes through here (invariant 1), so this is the one place
    // that can answer "did the last run finish?" — see AgentStatus.lastTurn.
    if (event.type === 'turn_end') lastTurn = event.reason;
    if (isDelta(event)) {
      if (buffered && mergeable(buffered, event)) {
        buffered = { ...buffered, delta: buffered.delta + event.delta };
      } else {
        flushDeltas();
        buffered = event;
      }
      if (!flushTimer) flushTimer = setTimeout(flushDeltas, FLUSH_MS);
      return;
    }
    flushDeltas();
    record(event);
  };

  /** Settle every outstanding ask as declined. See invariant 2. */
  const settlePending = (): void => {
    for (const resolve of pending.values()) resolve({ answer: 'no' });
    pending.clear();
  };

  const confirm = (request: ConfirmRequest): Promise<ConfirmDecision> =>
    new Promise<ConfirmDecision>((resolve) => {
      pending.set(request.callId, resolve);
      phase = 'awaiting_confirm';
      pushStatus();
    });

  const send = (text: string, rewindTo?: number, images?: readonly UserImage[]): AgentStatus => {
    if (phase !== 'idle') {
      error = 'the agent is still working on the previous message';
      pushStatus();
      return status();
    }
    if (!session) {
      try {
        const provider = deps.provider();
        session = provider.createSession(
          { system: SYSTEM_PROMPT, tools: agentTools(deps.contributedTools?.() ?? []) },
          resuming,
        );
        model = provider.model;
        acceptsImages = provider.acceptsImages;
        endpoint = provider.id;
        if (!conversationId) { conversationId = newId(); startedAt = Date.now(); }
        resuming = undefined;
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
          {
            driver: deps.driver, session: session!, model: model ?? '',
            acceptsImages, confirm, emit, journal: deps.journal,
          },
          text,
          context,
          controller.signal,
          images,
        );
      } catch (e) {
        // Invariant 1: runTurn rejected, so it emitted no turn_end of its own.
        // The reason goes on the status rather than into the transcript — this
        // path is reached BEFORE the turn starts (runTurn takes its checkpoint
        // outside its own try), so there is no turn for it to be part of.
        error = (e as Error)?.message ?? String(e);
        emit({ type: 'turn_end', steps: 0, mark: null, endMark: null, tx: null, files: [], acceptance: { verdict: 'unverified', results: [] }, reason: 'error' });
      } finally {
        settlePending();
        // The run is over either way — errors included, since a conversation
        // that ended badly is still one you may want back.
        if (running === controller) keep();
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
    send: (text: string, images?: readonly UserImage[]) => send(text, undefined, images),
    // A retry with no session yet is just a first message — nothing to rewind to.
    retry: (n, text) => send(text, session ? n : undefined),
    stop: () => {
      running?.abort();
      // The kernel may be parked on a confirmation, which an aborted signal does
      // not interrupt — it is waiting on us, not on the model.
      settlePending();
    },
    confirm: (callId, answer, declined) => {
      const resolve = pending.get(callId);
      if (!resolve) return;
      pending.delete(callId);
      resolve({ answer, declined });
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
      // The half-written delta belongs to a conversation that no longer exists.
      dropDeltas();
      session = null;
      model = null;
      // A new conversation is a new file. The old one keeps whatever it had at
      // its last turn — it was saved then, and nothing here takes that back.
      conversationId = null;
      resuming = undefined;
      phase = 'idle';
      error = null;
      log.length = 0;
      // Straight to the window, not through `emit`: the log it would join was
      // just emptied, and a window attaching later has nothing to reset.
      deps.push({ kind: 'event', event: { type: 'conversation_reset' } });
      pushStatus();
      return status();
    },
    /**
     * Continue a saved conversation: its transcript for the window, its memory
     * for the model.
     *
     * The session is not built here — it is built by the next `send`, from the
     * provider the endpoint resolves to THEN. Building it now would pin the
     * conversation to whatever provider happens to be configured at the moment
     * of clicking, which is not the same thing as the moment of asking.
     */
    resume: (conversation) => {
      running?.abort();
      running = null;
      settlePending();
      dropDeltas();
      session = null;
      model = conversation.model;
      conversationId = conversation.id;
      startedAt = conversation.startedAt;
      endpoint = conversation.endpoint;
      resuming = conversation.memory;
      phase = 'idle';
      error = null;
      log.length = 0;
      log.push(...conversation.events);
      // Reset first so a window holding another conversation drops it, then
      // replay: the same pair an attaching window gets, in the same order.
      deps.push({ kind: 'event', event: { type: 'conversation_reset' } });
      for (const event of conversation.events) deps.push({ kind: 'event', event });
      pushStatus();
      return status();
    },
    transcript: () => log,
  };
}
