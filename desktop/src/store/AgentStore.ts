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
import type { AgentEvent, ConfirmAnswer, ConfirmReason, ConfirmRequest } from '../../electron/agent/types';
import {
  agentProviders, agentProvider, agentKeyId, parseModelList, CUSTOM_PROVIDER, DEFAULT_CONTEXT_WINDOW,
} from '@/agent/providers';
import { refreshSecret, secretStatus, subscribeSecrets } from '@/store/SecretStore';
import { useSettings } from '@/store/settingsStore';
import { asEffort, type AgentEffort } from '@/settings/agentIds';
import type { Attachment } from '@/agent/attachments';
import { confirm } from '@/components/confirm';
import { t } from '@/i18n';

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
  /** The result in full, for the disclosure. */
  summary: string | null;
  /** The same result as one cell beside the row — see {@link briefResult}. */
  brief: string | null;
  /** A frame the call rendered — the transcript shows what the agent looked at. */
  image: string | null;
  /** The arguments as the model is WRITING them: raw JSON text, incomplete
   *  until it stops. Display only — the kernel dispatches the parsed object. */
  argText: string;
  /** Why it needs saying out loud, while it is awaiting an answer. */
  reason: ConfirmReason | null;
}

export interface AgentProseEntry {
  kind: 'text' | 'thinking';
  text: string;
  /** When the first delta landed, and when the run moved on to something else.
   *  Reasoning shows how long it took: a long silence is the thing the reader is
   *  already measuring, and guessing at it is what makes a turn feel hung. */
  startedAt: number;
  endedAt: number | null;
}

export interface AgentErrorEntry {
  kind: 'error';
  message: string;
}

/**
 * The point at which the model stopped remembering its earliest runs.
 *
 * An entry rather than a badge on the run, because it happened at a moment —
 * mid-run, between two tool calls — and the runs it took away are still on
 * screen above it. Reading the transcript afterwards, this is the line that
 * explains why the model cannot answer about them.
 *
 * Named for the event it comes from, like every other entry here, and NOT for
 * the fold that produced it: "folded" is already what a collapsed run and a
 * collapsed disclosure are called in the drawer, and a third meaning in the
 * same file is one that has to be worked out from context every time.
 */
export interface AgentCompactedEntry {
  kind: 'compacted';
  runs: number;
}

export type AgentEntry =
  AgentProseEntry | AgentToolEntry | AgentErrorEntry | AgentCompactedEntry;

export type TurnReason = 'end_turn' | 'aborted' | 'error' | 'refusal' | 'max_rounds';

/**
 * Endings the run could have gone further from, so the person can say so.
 *
 * `error` is one of them. A turn that died because the endpoint dropped mid-run
 * ("could not reach the endpoint: terminated" — seen in a real session) leaves
 * half-built work and no way forward: the ending that most needs the offer was
 * the one ending without it, and retyping the request starts the model over
 * instead of continuing. A cause that has not cleared (a rejected key) simply
 * says so again, which is honest.
 */
export const RESUMABLE: ReadonlySet<TurnReason> = new Set<TurnReason>(['aborted', 'max_rounds', 'error']);

export interface AgentTurn {
  /** Position in the conversation; stable, so React keys are too. */
  id: number;
  prompt: string;
  /** Which model answered THIS run — the conversation can switch between them. */
  model: string;
  entries: AgentEntry[];
  inputTokens: number;
  outputTokens: number;
  /**
   * How full the model's context was as of this run's last answer — null for
   * one that never got that far.
   *
   * Kept per run rather than beside the conversation so it is rebuilt by the
   * same replay everything else here is: a window that reloads mid-conversation
   * gets the reading back with the transcript, instead of a blank gauge under a
   * conversation that is nearly full.
   */
  context: { used: number; window: number } | null;
  /** What one Undo would take back, once the turn ended. 0 means don't offer it. */
  steps: number;
  /** Where that Undo would go back to (EditorHistory.undoToMark). */
  mark: unknown | null;
  /** null while the turn is still running. */
  reason: TurnReason | null;
  /** Wall clock, stamped here rather than in main: it is what the person waited,
   *  and the person is on this side of the IPC. */
  startedAt: number;
  endedAt: number | null;
}

/** Runs this window keeps. Past it the oldest go, the way main's log does. */
const MAX_TURNS = 100;

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
  /**
   * Entities under the pointer in the transcript, echoed into the Outliner and
   * the viewport. The link a general-purpose chat UI cannot make: a tool row
   * naming `id: 7` means nothing until 7 lights up where you already look.
   */
  peeked: readonly number[];
  /** Typed while a turn was running, waiting for it to end. See sendAgentMessage. */
  queued: readonly { text: string; images?: readonly Attachment[] }[];
  /**
   * What is typed and not yet sent.
   *
   * Here rather than in the composer because there are TWO composers — the
   * drawer's and the docked panel's — and the drawer's unmounts every time it
   * closes. Half a message should not be the price of pressing Esc, and the two
   * should not disagree about what you were writing.
   */
  draft: string;
  /**
   * Images attached to the draft. Beside it rather than in it for the same
   * reason: the drawer's composer unmounts every time it closes, and a picture
   * you dragged in is worse to lose than a sentence you typed.
   */
  attachments: readonly Attachment[];
  /** The turn whose checkpoint bar has been answered — see AgentCheckpoint. */
  checkpointDone: number | null;
  /** What the user picked, or null for "whichever provider has a key". */
  selection: AgentSelection | null;
  /**
   * Conversations saved with this project, newest first, and whether the list
   * is showing. Read on demand rather than kept in step: the only thing that
   * writes them is main, at the end of a turn.
   */
  conversations: readonly ConversationSummary[];
  historyOpen: boolean;
}

/** One saved conversation as the list shows it (electron/agent/store.ts). */
export interface ConversationSummary {
  id: string;
  startedAt: number;
  updatedAt: number;
  title: string;
  model: string;
  turns: number;
}

export const useAgent = create<AgentState>(() => ({
  status: IDLE, turns: [], driving: false, peeked: [], queued: [], checkpointDone: null,
  draft: '', attachments: [], selection: loadSelection(), conversations: [], historyOpen: false,
}));

// ── Conversations kept with the project ─────────────────────────────────────

/** Re-read the list. Called when the history opens, and after it changes. */
export async function refreshConversations(): Promise<void> {
  const conversations = await window.estella?.agent?.conversations?.() ?? [];
  useAgent.setState({ conversations });
}

export function openAgentHistory(): void {
  useAgent.setState({ historyOpen: true });
  void refreshConversations();
}

export const closeAgentHistory = (): void => useAgent.setState({ historyOpen: false });

/**
 * Carry on a saved conversation. The transcript arrives as a replayed event
 * stream (the same path an attaching window takes), so nothing here rebuilds it
 * — main pushes `conversation_reset` and then every event, and the projection
 * does the rest.
 */
export async function resumeConversation(id: string): Promise<void> {
  useAgent.setState({ historyOpen: false, queued: [], checkpointDone: null });
  const status = await window.estella?.agent?.resumeConversation?.(id);
  if (status) adoptStatus(status);
}

export async function forgetConversation(id: string): Promise<void> {
  await window.estella?.agent?.deleteConversation?.(id);
  await refreshConversations();
}

export const peekEntities = (ids: readonly number[]): void => useAgent.setState({ peeked: ids });

export const setAgentDraft = (draft: string): void => useAgent.setState({ draft });

export const addAgentAttachments = (added: readonly Attachment[]): void =>
    useAgent.setState((s) => ({ attachments: [...s.attachments, ...added] }));

export const removeAgentAttachment = (id: string): void =>
    useAgent.setState((s) => ({ attachments: s.attachments.filter((a) => a.id !== id) }));

// ── Which provider and model the next conversation runs on ──────────────────
// Persisted here rather than as a registered setting: it is picked from the
// composer, and a settings row for it would be a second control for one choice.

const SELECTION_KEY = 'estella.agent.selection';

export interface AgentSelection {
  providerId: string;
  model: string;
}

function loadSelection(): AgentSelection | null {
  try {
    const raw = localStorage.getItem(SELECTION_KEY);
    return raw ? (JSON.parse(raw) as AgentSelection) : null;
  } catch {
    return null;
  }
}

/** The custom provider's endpoint and models come from settings — it is the one
 *  we cannot ship a list for. */
function resolveProvider(id: string) {
  const def = agentProvider(id);
  if (!def) return undefined;
  if (id !== CUSTOM_PROVIDER) return def;
  const settings = useSettings.getState();
  return {
    ...def,
    baseUrl: String(settings.getValue('agents.customBaseUrl') ?? ''),
    models: parseModelList(String(settings.getValue('agents.customModels') ?? '')),
  };
}

/** The configured reasoning depth, narrowed. */
export const agentEffort = (): AgentEffort =>
  asEffort(useSettings.getState().getValue('agents.effort'));

const hasKey = (providerId: string): boolean =>
  secretStatus(agentKeyId(providerId))?.configured === true;

/**
 * What the next conversation will use.
 *
 * With nothing picked, the first provider that has a key IS the answer — so
 * configuring a key is the whole setup, and a person who only ever uses one
 * provider never opens the picker at all.
 */
export function effectiveSelection(): AgentSelection | null {
  const picked = useAgent.getState().selection;
  if (picked && resolveProvider(picked.providerId)) return picked;
  for (const p of agentProviders()) {
    const def = resolveProvider(p.id);
    if (def && def.models.length > 0 && hasKey(p.id)) return { providerId: p.id, model: def.models[0] };
  }
  return null;
}

/** Tell main what to build the next session against. Called on every input to
 *  that answer: the pick, a key appearing, a custom endpoint being typed. */
export function syncAgentEndpoint(): void {
  const selection = effectiveSelection();
  const def = selection ? resolveProvider(selection.providerId) : undefined;
  void window.estella?.agent?.setEndpoint({
    baseUrl: def?.baseUrl ?? '',
    model: selection?.model ?? '',
    keyId: selection ? agentKeyId(selection.providerId) : '',
    // How far the conversation may grow before it is compacted. Travels with the
    // endpoint because it is the same piece of knowledge: which provider this is.
    contextWindow: def?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    // How hard the model is asked to think. A setting rather than part of the
    // model pick: the same model is worth running at different depths, and the
    // depth is the one thing a person adjusts because a turn cost too much or
    // took too long — not because they changed provider.
    effort: agentEffort(),
  });
}

/**
 * Pick a provider + model. A conversation already under way is ENDED rather
 * than continued: a session is built for one model, thinking blocks have to
 * come back to the model that produced them, and the cached prefix is a byte
 * match — so "same conversation, different model" is not a thing that exists.
 *
 * Which is why it asks. Ending the conversation is the unavoidable COST of the
 * switch, not part of what the user asked for, and a transcript that vanished
 * on a click aimed at the model name reads as having lost something rather than
 * as having chosen it. Declining leaves the pick alone too: a selection saved
 * for "next time" while this conversation keeps answering on the old model is a
 * picker that lies about what is running.
 */
export async function selectAgentModel(providerId: string, model: string): Promise<void> {
  if (useAgent.getState().turns.length > 0) {
    const ok = await confirm({
      title: t('agent.switch.title', { model }),
      body: t('agent.switch.body'),
      confirmLabel: t('agent.switch.confirm'),
    });
    if (!ok) return;
  }
  const selection: AgentSelection = { providerId, model };
  useAgent.setState({ selection });
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify(selection));
  } catch { /* private mode — it just will not persist */ }
  syncAgentEndpoint();
  if (useAgent.getState().turns.length > 0) void resetAgentSession();
}
export const dismissCheckpoint = (turnId: number): void => useAgent.setState({ checkpointDone: turnId });

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
    return [...entries.slice(0, -1), { ...last, text: last.text + delta }];
  }
  return [...closeProse(entries), { kind, text: delta, startedAt: Date.now(), endedAt: null }];
}

/** A prose block is over the moment anything else begins — another kind of
 *  block, a tool call, the end of the run. Idempotent. Named by what it CAN
 *  close rather than by what it cannot: a kind added later is not prose, and
 *  listing the exceptions is how it would come to be treated as some. */
function closeProse(entries: readonly AgentEntry[]): AgentEntry[] {
  const last = entries[entries.length - 1];
  if (!last || (last.kind !== 'text' && last.kind !== 'thinking') || last.endedAt !== null) {
    return entries as AgentEntry[];
  }
  return [...entries.slice(0, -1), { ...last, endedAt: Date.now() }];
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
  // A new session numbers its runs from zero again, so keeping the old ones
  // would make the next turn_start look like a repeat of one already held.
  if (event.type === 'conversation_reset') return [];

  if (event.type === 'turn_start') {
    // Idempotent, so replaying the stream over a transcript that already has
    // some of it cannot double a run (see attachAgentBridge).
    if (turns.some((t) => t.id === event.index)) return turns as AgentTurn[];
    const opened: AgentTurn[] = [...turns, {
      // The SESSION's coordinate, not this array's position. They agree while a
      // window sees every run, and stop agreeing the moment one reloads — after
      // which numbering here would aim "re-ask run 0" at the wrong turn.
      id: event.index,
      prompt: event.prompt,
      model: event.model,
      entries: [],
      inputTokens: 0,
      outputTokens: 0,
      context: null,
      steps: 0,
      mark: null,
      reason: null,
      startedAt: Date.now(),
      endedAt: null,
    }];
    // Bounded the way main's own log is (it trims by whole runs at 4000 events);
    // a mirror that grew forever would be the one side of this that does. Safe
    // to drop from the front only because a run's identity is its session index
    // and not its position here, so what is left still names itself correctly.
    return opened.length > MAX_TURNS ? opened.slice(-MAX_TURNS) : opened;
  }

  const open = openTurn(turns);
  if (!open) return turns as AgentTurn[];

  switch (event.type) {
    case 'text':
    case 'thinking':
      return withEntries(turns, appendProse(open.entries, event.type, event.delta));

    // The row opens on the announcement and is completed by the call, so
    // arguments are watched being written rather than appearing whole.
    case 'tool_pending':
    case 'tool_call': {
      const id = event.type === 'tool_call' ? event.call.id : event.id;
      const name = event.type === 'tool_call' ? event.call.name : event.name;
      const input = event.type === 'tool_call' ? event.call.input : {};
      if (open.entries.some((e) => e.kind === 'tool' && e.id === id)) {
        return withEntries(turns, patchTool(open.entries, id, { input }));
      }
      return withEntries(turns, [...closeProse(open.entries), {
        kind: 'tool',
        id,
        name,
        input,
        effect: null,
        state: 'queued',
        summary: null,
        brief: null,
        image: null,
        argText: '',
        reason: null,
      }]);
    }

    case 'tool_args':
      return withEntries(turns, open.entries.map((e) =>
        (e.kind === 'tool' && e.id === event.id ? { ...e, argText: e.argText + event.delta } : e)));

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
        return {
          ...e, state, summary: event.summary, brief: briefResult(event.summary), image: event.image ?? null,
        };
      }));

    case 'usage':
      return patchLast(turns, {
        inputTokens: open.inputTokens + event.inputTokens,
        outputTokens: open.outputTokens + event.outputTokens,
      });

    // A level, not a cost: the newest reading REPLACES the last one, where the
    // token counts beside it accumulate.
    case 'context':
      return patchLast(turns, { context: { used: event.used, window: event.window } });

    case 'compacted':
      return withEntries(turns, [...closeProse(open.entries), { kind: 'compacted', runs: event.runs }]);

    case 'error':
      return withEntries(turns, [...closeProse(open.entries), { kind: 'error', message: event.message }]);

    case 'turn_end':
      return patchLast(turns, {
        reason: event.reason,
        steps: event.steps,
        mark: event.mark,
        endedAt: Date.now(),
        // Nothing will report on these now. Neither failed nor succeeded.
        entries: closeProse(open.entries).map((e) =>
          (e.kind === 'tool' && !TERMINAL.has(e.state) ? { ...e, state: 'stopped' as const } : e)),
      });

    // The turn's outcome arrives as turn_end's reason; the raw stop is the
    // provider's business.
    case 'stop':
      return turns as AgentTurn[];
  }
}

/**
 * The most recent reading the conversation produced, or null before there is
 * one (a conversation that has not had an answer yet has no context to be full
 * of).
 *
 * Searched backwards rather than read off the last run, because a run that has
 * only just started carries none — and a gauge that blanked at the top of every
 * turn would go missing exactly while the thing it measures is growing fastest.
 */
export function latestContext(turns: readonly AgentTurn[]): { used: number; window: number } | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].context) return turns[i].context;
  }
  return null;
}

/**
 * A tool's result as the ONE cell beside its row: the "58" next to
 * `get_scene_tree`, not the tree. The full text stays in `summary`, one click
 * away — a row whose result column holds the first 20 characters of a JSON
 * blob tells you nothing and hides the count that would have.
 *
 * Three rules, because a fourth would be guessing at a catalog that keeps
 * growing: a list is its length, an object leads with its first named string
 * (`kind: "scene"` reads as "scene"), and anything else is its first line.
 */
export function briefResult(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  try {
    const value: unknown = JSON.parse(trimmed);
    if (Array.isArray(value)) return String(value.length);
    if (value && typeof value === 'object') {
      const first = Object.values(value).find((v) => typeof v === 'string' && v);
      if (typeof first === 'string') return clip(first);
      return clip(String(Object.keys(value).length));
    }
    return clip(String(value));
  } catch {
    /* not JSON — the tool answered in prose */
  }
  return clip(trimmed.split('\n')[0]);
}

const clip = (s: string): string => (s.length > 26 ? `${s.slice(0, 25)}…` : s);

/**
 * A conversation main still holds means this window is driving, whatever it
 * remembers — a renderer that reloaded mid-conversation would otherwise leave
 * the automation hook down under a session that is still alive.
 */
function adoptStatus(status: AgentStatus): void {
  useAgent.setState((s) => ({ status, driving: s.driving || status.conversation }));
  // The turn that was refusing sends has ended — release what was held for it.
  if (status.phase === 'idle') drainQueue();
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
  // The conversation can outlive the window: main holds the session, so a reload
  // used to come back to an empty drawer while the model still remembered
  // everything. Subscribed FIRST so nothing arriving meanwhile is missed; the
  // replay is the history in front of whatever did (runs are matched by id).
  void window.estella?.agent?.transcript?.().then((events) => {
    if (!events?.length) return;
    useAgent.setState((s) => {
      const replayed = events.reduce<AgentTurn[]>(applyAgentEvent, []);
      const known = new Set(replayed.map((t) => t.id));
      return { turns: [...replayed, ...s.turns.filter((t) => !known.has(t.id))] };
    });
  });
  // Which keys exist decides which provider runs when nothing is picked, so ask
  // once at boot rather than the first time a settings row happens to render.
  for (const p of agentProviders()) void refreshSecret(agentKeyId(p.id)).then(syncAgentEndpoint);
  const offSecrets = subscribeSecrets(syncAgentEndpoint);
  syncAgentEndpoint();
  return () => { off(); offSecrets(); };
}

export async function sendAgentMessage(
  text: string,
  images?: readonly Attachment[],
): Promise<void> {
  // The host REFUSES a send while a turn runs, so holding the message is this
  // side's job. Without it the composer's own promise ("this will be the next
  // message") was a lie that cost the person what they had typed: the box was
  // already cleared, and all they got back was a red banner.
  if (useAgent.getState().status.phase !== 'idle') {
    useAgent.setState((s) => ({ queued: [...s.queued, { text, images }] }));
    return;
  }
  // Before the IPC, not after: main drives this window through
  // `window.__estellaEditor`, which is published only while a driver is
  // authorized (engine/automationGate.ts) and this store is what says so for the
  // built-in agent. Waiting for main's status to come back would race the first
  // tool call of the turn we are starting.
  useAgent.setState({ driving: true });
  // Only what the model needs crosses the bridge: the thumbnail url and the
  // file's name are this side's business.
  const payload = images?.length
    ? images.map((a) => ({ mediaType: a.mediaType, data: a.data }))
    : undefined;
  const status = await window.estella?.agent?.send(text, payload);
  if (status) adoptStatus(status);
}

/** Send what was held while the last turn ran, oldest first. */
function drainQueue(): void {
  const [next, ...rest] = useAgent.getState().queued;
  if (next === undefined) return;
  useAgent.setState({ queued: rest });
  void sendAgentMessage(next.text, next.images);
}

/** Nothing queued survives the turn being stopped: stopping means stop. */
export const clearAgentQueue = (): void => useAgent.setState({ queued: [] });

/**
 * Ask a turn again, discarding it and everything after it — on both sides. The
 * store truncates first so the transcript never shows runs the session has
 * already forgotten.
 */
export async function retryAgentTurn(turnId: number, prompt?: string): Promise<void> {
  const turn = useAgent.getState().turns.find((t) => t.id === turnId);
  if (!turn) return;
  // Asking the same question again is a special case of asking a different one,
  // which is why the host has always taken the text rather than looking it up:
  // usually the reason to re-ask is that the question could have been better.
  const text = (prompt ?? turn.prompt).trim();
  if (!text) return;
  // By id, not by position: this window may not hold every run the session does.
  useAgent.setState((s) => ({ turns: s.turns.filter((t) => t.id < turnId), checkpointDone: null }));
  const status = await window.estella?.agent?.retry(turnId, text);
  if (status) adoptStatus(status);
}

export function stopAgentTurn(): void {
  clearAgentQueue();
  void window.estella?.agent?.stop();
}



/**
 * Answer a pending confirmation. The row moves on the click rather than on
 * main's echo — the person just decided, and a row that sits on "waiting for
 * you" afterwards reads as a click that did not land.
 */
export function confirmAgentCall(callId: string, answer: ConfirmAnswer, declined?: readonly number[]): void {
  useAgent.setState((s) => {
    const open = openTurn(s.turns);
    if (!open) return {};
    return {
      turns: patchLast(s.turns, {
        entries: patchTool(open.entries, callId, {
          state: answer === 'no' ? 'declined' : 'running',
          reason: null,
        }),
      }),
    };
  });
  void window.estella?.agent?.confirm(callId, answer, declined);
}

/**
 * Drop the conversation and start over, at the user's asking.
 *
 * Separate from {@link resetAgentSession} because that one is also how the
 * editor ends a session it has no choice about (a model switch), and a
 * confirmation there would either ask twice or ask the wrong question.
 */
export async function startNewConversation(): Promise<void> {
  if (useAgent.getState().turns.length > 0) {
    const ok = await confirm({
      title: t('agent.new.title'),
      body: t('agent.new.body'),
      confirmLabel: t('agent.new.confirm'),
    });
    if (!ok) return;
  }
  await resetAgentSession();
}

/** Drop the conversation — a new one starts with the next message. */
export async function resetAgentSession(): Promise<void> {
  useAgent.setState({ turns: [], driving: false, queued: [] });
  const status = await window.estella?.agent?.reset();
  if (status) useAgent.setState({ status });   // not adoptStatus: reset just ended it
}

/**
 * The entity ids a call's arguments name.
 *
 * Read off the catalog's own naming convention — `entity`, `id`, `ids` — rather
 * than a per-tool table, because a table of "which argument of which tool is an
 * entity" is a second definition of the catalog that would drift from it. The
 * convention misses a tool that names its argument something else, and that is
 * the right way to be wrong here: a badge that appears late is a smaller lie
 * than one that points at the wrong entity.
 */
export function entitiesInInput(input: Record<string, unknown>): number[] {
  const out: number[] = [];
  for (const key of ['entity', 'id', 'ids', 'entities']) {
    const value = input[key];
    if (typeof value === 'number') out.push(value);
    else if (Array.isArray(value)) out.push(...value.filter((v): v is number => typeof v === 'number'));
  }
  return out;
}

/**
 * What the conversation has changed and you have not acknowledged yet.
 *
 * Answering the checkpoint — Undo or Keep — clears the badges for that turn and
 * everything before it. The transcript still says what happened; the badge is
 * about what still wants your eye, and after Undo it did not happen at all.
 */
export function touchedEntities(
  turns: readonly AgentTurn[],
  acknowledgedUpTo: number | null,
): ReadonlySet<number> {
  const touched = new Set<number>();
  for (const turn of turns) {
    if (acknowledgedUpTo !== null && turn.id <= acknowledgedUpTo) continue;
    for (const entry of turn.entries) {
      // Only calls that ran and changed something: a queued or failed call
      // touched nothing, and a read never does.
      if (entry.kind !== 'tool' || entry.state !== 'ok' || entry.effect === 'read') continue;
      for (const id of entitiesInInput(entry.input)) touched.add(id);
    }
  }
  return touched;
}

/** Whether an agent conversation authorizes the automation hook (main.tsx). */
export const agentDriving = (): boolean => useAgent.getState().driving;
export const subscribeAgent = (fn: () => void): (() => void) => useAgent.subscribe(fn);

export type { ConfirmRequest, ConfirmReason };
