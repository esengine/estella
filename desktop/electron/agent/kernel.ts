// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    kernel.ts
 * @brief   One agent turn: ask the model, run what it asks for, feed the results
 *          back, until it stops asking. The editor policy lives here — the tool
 *          tiers, the undo checkpoint, and the verification reflex — so a
 *          provider stays a wire format and nothing more.
 *
 * Tool calls go through the SAME catalog and the SAME `runTool` dispatch the MCP
 * fronts use, against the same driver. A built-in agent that reached the editor
 * some other way would be a second definition of what an agent can do, and the
 * two would drift; there is one.
 */
import type {
  AgentEvent, CatalogTool, ConfirmReason, KernelDeps, ToolCall, ToolOutcome, UserImage,
} from './types';
import {
  criteriaProblem, evaluate, failureReport, markBaseline,
  type Acceptance, type Criterion, type DeclaredCriterion,
} from './acceptance';
// Plain .mjs, shared with the MCP fronts — esbuild bundles it into main.
// @ts-expect-error untyped shared module
import { TOOLS, runTool, mutates, irreversible, journaled } from '../../shared/toolCatalog.mjs';

// `driverOnly` tools are doors for an EXTERNAL driver (a harness running the
// editor's agent as a subject). The agent itself must not see them: a tool that
// messages the agent, handed to the agent, is a loop with a bill attached.
const catalog = (TOOLS as CatalogTool[]).filter((t) => !(t as { driverOnly?: boolean }).driverOnly);
const byName = new Map(catalog.map((t) => [t.name, t]));

/**
 * The tools an in-editor agent may call: the built-in catalog, plus whatever
 * loaded plugins contributed.
 *
 * Everything built-in is offered except the driver-only doors (see `catalog`).
 * The coarse ESTELLA_MCP_ALLOW_WRITES door
 * exists because a REMOTE client has nobody to ask, and this one has the user
 * right there (see the confirm gate below).
 *
 * Contributed tools are dispatched through ONE generic door on the editor
 * surface rather than each getting a method of its own — a plugin's tool runs
 * in the renderer where the plugin lives, and adding a transport per plugin
 * would be a second way for an agent to reach the editor.
 *
 * Snapshotted per SESSION, not per turn: the tool list renders first in the
 * prompt prefix, so a list that changed mid-conversation would invalidate every
 * cached byte after it. A plugin loaded while a conversation is open joins the
 * next one.
 */
export function agentTools(contributed: readonly ContributedTool[] = []): readonly CatalogTool[] {
  if (contributed.length === 0) return catalog;
  const out = [...catalog];
  const taken = new Set(catalog.map((t) => t.name));
  for (const tool of contributed) {
    // Refused rather than renamed. A tool the model calls by a name the plugin
    // did not choose is a tool whose own docs are wrong, and shadowing a
    // built-in would let a plugin quietly redefine `delete_entity`.
    if (taken.has(tool.name)) continue;
    taken.add(tool.name);
    out.push({
      name: tool.name,
      description: tool.description,
      schema: tool.schema,
      effect: tool.effect,
      root: 'editor',
      method: PLUGIN_TOOL_METHOD,
      args: (input: unknown) => [tool.name, input],
    } as unknown as CatalogTool);
  }
  return out;
}

/** One generic door on `window.__estellaEditor` for every contributed tool. */
const PLUGIN_TOOL_METHOD = 'runPluginTool';

/** The tool the kernel answers itself — it declares what the TURN has to hold,
 *  which is loop state and reaches no editor door. See acceptance.ts. */
const ACCEPTANCE_TOOL = 'done_when';

/** What the turn has claimed and whether it has written yet. Held by runTurn
 *  and threaded down, because both facts belong to the turn and not to a call. */
interface TurnState {
  criteria: DeclaredCriterion[];
  wroteAnything: boolean;
}

/**
 * Answer {@link ACCEPTANCE_TOOL}: keep the claims, or refuse and say which rule.
 *
 * Refused after the first write on purpose. Criteria written once the work
 * exists are shaped by whatever got built, which is the failure mode the whole
 * mechanism is there to close.
 */
async function declare(
  deps: KernelDeps,
  call: ToolCall,
  turn: TurnState,
): Promise<{ outcome: ToolOutcome; mutated: boolean }> {
  const emit = deps.emit;
  const refuse = (content: string) => {
    emit({ type: 'tool_end', id: call.id, ok: false, summary: content });
    return { outcome: { id: call.id, content, isError: true }, mutated: false };
  };
  if (turn.wroteAnything) {
    return refuse(
      'too late — this turn has already changed something, and criteria written after the work '
      + 'are shaped by the work. Say in your answer what you would have claimed, and declare it '
      + 'first next time.',
    );
  }
  const problem = criteriaProblem((call.input as { criteria?: unknown }).criteria);
  if (problem) return refuse(problem);

  turn.criteria = await markBaseline(deps, (call.input as { criteria: Criterion[] }).criteria);
  // Said now, while there is still time to claim something else: a criterion
  // that answers true against the untouched project is a guard on what already
  // works, and cannot be what shows this turn did anything.
  const already = turn.criteria.filter((c) => c.heldBefore);
  const summary = `${turn.criteria.length} criteria — checked at the end of this turn`
    + (already.length === 0 ? '' : `. ${already.length} of them ALREADY HOLD, with none of the `
      + `work done: ${already.map((c) => `"${c.says}"`).join(', ')}. Those cannot show this turn `
      + 'achieved anything — declare at least one that is false right now and true once you are done.');
  emit({ type: 'tool_end', id: call.id, ok: true, summary });
  return { outcome: { id: call.id, content: summary, isError: false }, mutated: false };
}

/** What the window says a plugin contributed. The handler stays over there. */
export interface ContributedTool {
  name: string;
  description: string;
  schema: unknown;
  effect: 'read' | 'ephemeral' | 'undoable' | 'journaled' | 'irreversible';
}

/** Why `tool` needs saying out loud. A code — the editor renders the sentence,
 *  because it is the side that knows the reader's language. */
function confirmReason(tool: CatalogTool): ConfirmReason {
  if (tool.name === BULK_EDIT_TOOL) return 'bulk_edit';
  // A journaled tool only reaches the gate when nothing is holding its bytes,
  // and that — not the tool — is what the person is being asked about.
  if (journaled(tool)) return 'unjournaled';
  return tool.name === 'run_editor_command' || tool.name === 'play_probe'
    ? 'arbitrary_code'
    : 'irreversible';
}

/**
 * The one undoable tool that still stops to ask.
 *
 * Not for safety — it is one undo step. For SIZE: it authors a subtree in a
 * single call, and a hundred-node edit is worth seeing before it lands rather
 * than reading back afterwards. The window renders the preview, since that takes
 * the scene. "Allow for this run" turns it off for the rest of the run, which is
 * what keeps a long build from becoming a hundred prompts.
 */
const BULK_EDIT_TOOL = 'apply_scene_ops';

/**
 * The result as the transcript's disclosure shows it: bounded so a tool that
 * returns a megabyte cannot cost the renderer that much, but NOT flattened —
 * the shape of a scene tree or a diagnostics list is most of what makes it
 * readable, and squeezing it onto one line threw that away. The one-line
 * version beside the row is a rendering decision, made in the editor
 * (AgentStore's briefResult).
 */
function summarize(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 4000 ? `${trimmed.slice(0, 3997)}…` : trimmed;
}

/**
 * The result as the MODEL receives it.
 *
 * A tool that answers with the whole scene can spend a conversation's context in
 * one call, and the turn that follows fails for a reason no one can see from the
 * transcript. Cut it, and SAY it was cut — a model handed a silently truncated
 * list believes it saw everything and reasons from a scene that ends at entity
 * 400. Most tools take a filter, so the useful thing to say is "ask for less".
 */
function budgeted(text: string): string {
  if (text.length <= MAX_TOOL_RESULT) return text;
  const kept = text.slice(0, MAX_TOOL_RESULT);
  return `${kept}\n\n[Truncated: this result was ${text.length} characters and only the first `
    + `${MAX_TOOL_RESULT} were kept. You have NOT seen all of it. Narrow the request — most `
    + 'tools take a filter or an id — rather than reasoning from what is above as if complete.]';
}

/** Room for a large-but-reasonable answer (a few hundred entities), well under
 *  the smallest context window we assume (agentIds.DEFAULT_CONTEXT_WINDOW). */
const MAX_TOOL_RESULT = 24_000;

/**
 * MCP wraps a result as content blocks because that is its wire format. Text
 * flattens; an image stays an image — a tool whose whole purpose is letting the
 * model SEE is not served by being handed the word "[image]".
 */
function toOutcome(id: string, result: {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}): ToolOutcome {
  const image = result.content.find((c) => c.type === 'image' && c.data);
  const text = result.content.filter((c) => c.type !== 'image').map((c) => c.text ?? '').join('\n');
  return {
    id,
    content: budgeted(text) || (image ? 'screenshot attached' : 'ok'),
    isError: result.isError === true,
    ...(image ? { image: { data: image.data!, mediaType: image.mimeType ?? 'image/png' } } : {}),
  };
}

/**
 * Run one turn to completion.
 *
 * Bracketed by a CHECKPOINT over both halves it can change: an EditorHistory
 * mark for the document, a fileJournal transaction for the disk. Neither is a
 * lock — one held across model latency would freeze the editor. Each call stays
 * its own undo step; the pair is what brings the whole turn back at once.
 *
 * @returns both, so the caller can offer that revert.
 */
export async function runTurn(
  deps: KernelDeps,
  text: string,
  context: string | null,
  signal: AbortSignal,
  images?: readonly UserImage[],
): Promise<{ mark: unknown; endMark: unknown; steps: number; tx: string | null; acceptance: Acceptance }> {
  const { driver, session, emit, model, acceptsImages } = deps;
  const mark = await driver('mark', []);
  // Opened before the first call and closed once, in the finally below: a
  // transaction that leaked past the turn would keep capturing the user's own
  // edits into a checkpoint labelled with the model's prompt.
  const tx = deps.journal?.begin() ?? null;
  // Read before pushUser opens it: this is the index that turn will occupy.
  emit({ type: 'turn_start', prompt: text, model, index: session.turnIndex });

  let reason: Extract<AgentEvent, { type: 'turn_end' }>['reason'] = 'end_turn';
  // Tools the person has waved through for the REST OF THIS RUN. Not persisted:
  // an "always" that outlives the run is a permission switch nobody remembers
  // flipping, which is the thing the gate exists to prevent.
  const allowed = new Set<string>();
  // Undo steps this turn is responsible for, so a jump beyond it is the person.
  let ours = 0;
  // The last evaluation, which is the one the verdict comes from. Out here
  // because turn_end reports it however the turn ended.
  let accepted: Acceptance | null = null;
  try {
    if (context) session.pushContext(context);
    if (!acceptsImages) {
      session.pushContext(
        'This endpoint cannot carry images: a PNG from screenshot or capture_viewport cannot '
        + "reach you. `screenshot` with `format: 'grid'` can — it answers with the same picture "
        + 'as a coarse colour grid in text, cropped to the running game. That is your eyes; use '
        + 'it for the questions no field-read can answer (did anything draw, is it on camera, '
        + 'what colour did it come out, did the picture change after that input).',
      );
    }
    session.pushUser(text, images);

    // Bounded so a model that keeps calling tools cannot spin forever.
    // Turn-level, not round-level: "did this turn build anything" and "did it
    // ever look" are questions about the whole turn.
    let builtSomething = false;
    let sawPixels = false;
    let askedToLook = false;
    // Counted across the CONVERSATION when the host holds the map: a fresh one
    // per turn hands a stuck model three more attempts every `Carry on`.
    const failing = deps.failing ?? new Map<string, number>();
    const stuck: string[] = [];
    const turn: TurnState = { criteria: [], wroteAnything: false };
    let toldFailures = false;
    let round = 0;
    for (; round < MAX_ROUNDS; round++) {
      // The editor is not frozen while a turn runs: the person can drag an
      // entity while the model is thinking. Whatever the agent read before that
      // is now possibly stale, and it has no way to notice — an edit made from
      // the old reading silently overwrites the one just made by hand. Steps
      // that appeared since our own work is enough to say SO; what changed is
      // the scene's to answer, and telling it to re-read beats guessing.
      if (round > 0) {
        const now = await undoSteps(deps, mark);
        if (now > ours) {
          session.pushContext(
            `While you were working, the user edited the scene themselves (${now - ours} undo `
            + 'steps beyond your own). Anything you read before now may be out of date — '
            + 're-read what you are about to change rather than acting on it.',
          );
          ours = now;
        }
      }

      // Running out of room is something the model can act on, but only if it
      // learns before the last round rather than at it.
      if (round === MAX_ROUNDS - ROUNDS_WARNING) {
        session.pushContext(
          `You have ${ROUNDS_WARNING} tool rounds left in this turn before it is cut off. `
          + 'Land what you have: finish the step you are on, leave the project in a working '
          + 'state, and tell the user where things stand and what is left.',
        );
      }

      const calls: ToolCall[] = [];
      let refused = false;

      // A dropped connection costs the ROUND, not the turn. The provider layer
      // appends to the conversation only once a stream completes, so a stream
      // that died left the session as it found it and asking again sends the
      // same messages. Without this, an hour of work ends on a socket the
      // gateway closed — twice in three dogfood runs, both times mid-build,
      // with the reason buried in a transcript nobody reads until after.
      for (let attempt = 0; ; attempt++) {
        calls.length = 0;
        try {
          for await (const ev of session.step(signal)) {
            if (ev.type === 'tool_call') calls.push(ev.call);
            if (ev.type === 'stop' && ev.reason === 'refusal') refused = true;
            emit(ev);
          }
          break;
        } catch (e) {
          const retryable = (e as { retryable?: boolean })?.retryable === true;
          if (signal.aborted || !retryable || attempt >= STEP_RETRIES) throw e;
          emit({
            type: 'error',
            message: `${(e as Error).message} — retrying (${attempt + 1}/${STEP_RETRIES}).`,
          });
          await new Promise((r) => { setTimeout(r, 1000 * (attempt + 1)); });
        }
      }
      if (refused) { reason = 'refusal'; break; }
      // No calls means it is about to answer. If it built something and never
      // once looked at it, that answer is a report on work nobody has seen —
      // which is how a board half off camera gets delivered as a finished game,
      // with every write compiling and every diagnostic clean. Asked ONCE per
      // turn: a second ask would be an argument, and the model may have a reason.
      if (calls.length === 0) {
        if (builtSomething && !sawPixels && !askedToLook) {
          askedToLook = true;
          // What to ask for depends on what this model can perceive. Told to
          // "capture_viewport" a model that cannot receive images did the only
          // sensible thing with the request — it re-read its own source — and
          // reported a game whose ball never launched. A screenshot it cannot
          // see is not verification; running the thing and reading values back
          // is, and that door is open to every model.
          session.pushContext(
            acceptsImages
              ? 'You changed the scene this turn and have not looked at it once. Diagnostics only '
                + 'cover what the editor can name — whether the content is ON CAMERA, whether it '
                + 'reads, whether it is where you meant, are all things only the picture answers. '
                + 'capture_viewport now; if it is something that has to be PLAYED, set_play, '
                + 'drive it with play_input and screenshot that. Then fix what you see, or report.'
              : 'You changed the scene this turn and never ran it. RUN it: set_play, then '
                + 'find_entities / inspect_entity to read the state back (inspect_entity gives one '
                + 'entity whole, every component with its live data), play_input to drive the '
                + 'controls a player would use, step to advance the frames, and inspect_entity '
                + 'again to prove they did something. '
                + "You cannot receive images, but `screenshot` with `format: 'grid'` gives you the "
                + 'picture as text — take one, because whether anything DREW is not a question the '
                + 'component values answer. get_logs shows what the running game complained about. '
                + 'Reading your own source again is not this: it is the thing that already '
                + 'convinced you it works.',
          );
          continue;
        }
        // A turn that changed nothing and claimed nothing has no work to
        // accept, and asking the editor about a project it did not touch buys a
        // verdict about someone else's state.
        if (builtSomething || turn.criteria.length > 0) {
          // Taken HERE rather than after the loop, so a turn that broke its own
          // criteria gets one chance to fix them — the same shape as the
          // diagnostics feed. Told once, and the reading it ends on is reported.
          accepted = await evaluate(deps, turn.criteria);
          const failures = failureReport(accepted);
          if (failures && !toldFailures) {
            toldFailures = true;
            session.pushContext(failures);
            continue;
          }
        }
        break;
      }

      // Reads have no side effects and no order among themselves, so a run of
      // them goes out together — three lookups become one wait instead of three.
      // Order is still respected ACROSS the boundary: a read the model asked for
      // after a write means "tell me what that did", and answering it from
      // before the write would be a lie it then reasons from.
      const outcomes: ToolOutcome[] = [];
      let wrote = false;
      for (let i = 0; i < calls.length && !signal.aborted;) {
        let end = i;
        while (end < calls.length && isRead(calls[end])) end++;
        const batch = end - i > 1
          ? await Promise.all(calls.slice(i, end).map((c) => execute(deps, c, allowed, signal, tx !== null, turn)))
          : [await execute(deps, calls[i], allowed, signal, tx !== null, turn)];
        const slice = calls.slice(i, i + batch.length);
        for (const done of batch) {
          outcomes.push(done.outcome);
          wrote ||= done.mutated;
        }
        // A look counts only AFTER the write it checks. "Did you look at some
        // point" is satisfied by the prompt's own "look before you edit", which
        // switched the reflex off for every round that followed.
        if (batch.some((d) => d.mutated)) sawPixels = false;
        for (let k = 0; k < slice.length; k++) {
          if (LOOKING_TOOLS.has(slice[k].name)) sawPixels = true;
          if (batch[k].outcome.isError) stuckOn(failing, slice[k], stuck);
        }
        builtSomething ||= wrote;
        turn.wroteAnything ||= wrote;
        i += batch.length;
      }
      if (signal.aborted) break;

      // Told once per signature, and only after it has failed enough times to
      // be a pattern: the round cap is a spend limit, and a model re-issuing a
      // call that keeps failing reaches it without ever being told why.
      if (stuck.length) {
        session.pushContext(
          `${stuck.join(' and ')} has now failed ${REPEAT_LIMIT} times with the same arguments. `
          + 'Repeating it will keep failing. Read the error, then do something different — a '
          + 'different tool, different arguments, or tell the user what you need and why.',
        );
        stuck.length = 0;
      }

      // The verification reflex. get_diagnostics is what the editor itself
      // flags in the Details panel, and its own description calls an empty list
      // the done signal — so after a batch of edits the agent is TOLD what it
      // broke rather than left to remember to look. Context, not a tool result:
      // a tool result has to answer a call the model made.
      if (wrote) {
        const issues = await diagnostics(deps);
        if (issues) session.pushContext(issues);
      }
      session.pushToolResults(outcomes);
      // Everything on the stack now is this turn's own doing.
      ours = await undoSteps(deps, mark);
    }
    // The budget ran out rather than the model stopping asking, so the work is
    // unfinished. Said out loud: reported as an ordinary end of turn, a run cut
    // off mid-task looks exactly like one that finished, and the sentence that
    // would have told you otherwise is the one it never got to write.
    if (round === MAX_ROUNDS) reason = 'max_rounds';
  } catch (e) {
    reason = signal.aborted ? 'aborted' : 'error';
    if (!signal.aborted) emit({ type: 'error', message: (e as Error)?.message ?? String(e) });
  }
  if (signal.aborted) reason = 'aborted';

  // Closed before the tally is read, so nothing the editor does while rendering
  // the result lands in the turn's own transaction.
  deps.journal?.end();
  const steps = await undoSteps(deps, mark);
  // Where the turn's OWN work ends. Without it a run is bounded only by the next
  // one, so the newest run claims every edit the person makes after it.
  const endMark = await driver('mark', []).catch(() => null);
  const files = tx ? deps.journal?.changes(tx) ?? [] : [];
  // Nothing of a cut-off turn's OWN is due, but "did it leave the project
  // standing" is. Handed no criteria, this can only fail or leave unverified.
  // Not after a Stop — the user asked for the turn to be over now.
  const cutOff = reason === 'max_rounds' || reason === 'error';
  if (!accepted && cutOff && (steps > 0 || files.length > 0)) {
    accepted = await evaluate(deps, []).catch(() => null);
  }
  const acceptance: Acceptance = accepted ?? { verdict: 'unverified', results: [] };
  emit({ type: 'turn_end', steps, mark, endMark, tx, files, reason, acceptance });
  return { mark, endMark, steps, tx, acceptance };
}

/**
 * The backstop against a turn that never ends — a model retrying a call that
 * always fails would otherwise spend a balance before anyone noticed.
 *
 * Held high because the failure it prevents is rare and the one it CAUSES is
 * not: building a small game takes some seventy tool calls, and at 48 both
 * dogfood runs were cut off mid-build. A turn that stops here has spent real
 * money to deliver half a thing.
 */
const MAX_ROUNDS = 128;
/** Extra attempts for a round whose CONNECTION failed. Small: a provider that is
 *  down stays down, and the point is only to survive a dropped socket. */
const STEP_RETRIES = 2;

/**
 * How many rounds from the cap the model is told it is running out.
 *
 * The cap on its own truncates: the round where it would have said "the board is
 * built, here is how to play it" is the round it never gets. Warned, it can land
 * the work it has — which is the difference between an unfinished turn and an
 * unfinished turn nobody explained.
 */
const ROUNDS_WARNING = 8;

/**
 * Failures of the SAME call with the SAME arguments before it is called a loop.
 *
 * Three, because two is a retry — a tool that failed on a race, a scene that had
 * not finished loading — and telling a model off for retrying once is noise it
 * learns to skip past.
 */
const REPEAT_LIMIT = 3;

/** Count one failure, and name the tool on the attempt that makes it a pattern.
 *  Only that attempt: a fourth telling is an argument, not information. */
function stuckOn(failing: Map<string, number>, call: ToolCall, stuck: string[]): void {
  const signature = `${call.name}:${JSON.stringify(call.input)}`;
  const n = (failing.get(signature) ?? 0) + 1;
  failing.set(signature, n);
  if (n === REPEAT_LIMIT) stuck.push(call.name);
}

/** Undo steps recorded since `mark`, or 0 when the editor cannot say. */
async function undoSteps(deps: KernelDeps, mark: unknown): Promise<number> {
  return Number(await deps.driver('stepsSince', [mark]).catch(() => 0)) || 0;
}

/**
 * The batch minus the lines the person struck out, or null when nothing is left.
 *
 * Only the ops array is rewritten; the dependency pruning that makes the
 * remainder runnable lives with the preview that produced the indices
 * (engine/sceneOpsPreview), so main is not a second opinion on what depends on
 * what. A batch given by `opsPath` is not previewable and is left alone.
 */
function keptOps(input: Record<string, unknown>, declined: readonly number[]): Record<string, unknown> | null {
  const ops = input.ops;
  if (!Array.isArray(ops)) return input;
  const drop = new Set(declined);
  const kept = ops.filter((_, i) => !drop.has(i));
  return kept.length === 0 ? null : { ...input, ops: kept };
}

/** True when a call cannot change anything, so it may run alongside others. */
function isRead(call: ToolCall): boolean {
  const tool = byName.get(call.name);
  return !!tool && (tool.effect ?? 'read') === 'read';
}

/** Marks a dispatch the person stopped waiting for. */
const ABANDONED = Symbol('abandoned');

/**
 * `work`, or {@link ABANDONED} the moment `signal` aborts — whichever comes first.
 *
 * Stop used to be honoured only BETWEEN tool calls, so pressing it during a slow
 * one did nothing until that one returned, which reads as a dead button. The
 * dispatch itself cannot be cancelled: it is executing inside the editor window
 * and will finish, and if it was a write that write will land. What ends
 * promptly is the TURN — no further calls, no further model round trips — which
 * is what the person is asking for. The transcript says which of the two
 * happened rather than implying the work was undone.
 */
async function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T | typeof ABANDONED> {
  if (signal.aborted) return ABANDONED;
  let onAbort!: () => void;
  const stopped = new Promise<typeof ABANDONED>((resolve) => {
    onAbort = () => resolve(ABANDONED);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([work, stopped]);
  } finally {
    // A turn runs up to MAX_ROUNDS batches of calls; leaving one listener per
    // call on a signal that lives as long as the turn is a slow leak.
    signal.removeEventListener('abort', onAbort);
  }
}

/** Run one call: gate it, dispatch it, and report both ways. */
async function execute(
  deps: KernelDeps,
  call: ToolCall,
  allowed: Set<string>,
  signal: AbortSignal,
  journalling: boolean,
  turn: TurnState,
): Promise<{ outcome: ToolOutcome; mutated: boolean }> {
  const { emit, driver, confirm } = deps;
  const tool = byName.get(call.name);
  if (!tool) {
    return {
      outcome: { id: call.id, content: `no such tool: ${call.name}`, isError: true },
      mutated: false,
    };
  }

  const effect = tool.effect ?? 'read';
  emit({ type: 'tool_start', call, effect });
  if (call.name === ACCEPTANCE_TOOL) return declare(deps, call, turn);

  // The one gate. Everything the turn's checkpoint covers runs unasked. The flag
  // is why the tier is not enough: journaled with NO transaction open is
  // irreversible wearing a gentler tier.
  const gated = irreversible(tool)
    || call.name === BULK_EDIT_TOOL
    || (journaled(tool) && !journalling);
  let input = call.input;
  if (gated && !allowed.has(call.name)) {
    const request = { callId: call.id, tool: call.name, reason: confirmReason(tool), input: call.input };
    emit({ type: 'awaiting_confirm', request });
    const { answer, declined } = await confirm(request);
    if (answer === 'no') {
      const content = `the user declined to run ${call.name}. Do not retry it; `
        + 'continue with what you can do without it, or say what you need.';
      emit({ type: 'tool_end', id: call.id, ok: false, summary: 'declined' });
      return { outcome: { id: call.id, content, isError: false }, mutated: false };
    }
    if (answer === 'turn') allowed.add(call.name);
    if (declined?.length) {
      const kept = keptOps(call.input, declined);
      if (kept === null) {
        // Everything was struck out — running an empty batch would report
        // success for work nobody accepted.
        emit({ type: 'tool_end', id: call.id, ok: false, summary: 'declined' });
        return {
          outcome: {
            id: call.id,
            content: `the user struck out every operation of ${call.name}. Do not retry it as-is; `
              + 'ask what they wanted different.',
            isError: false,
          },
          mutated: false,
        };
      }
      input = kept;
    }
  }

  const raced = await untilAborted(runTool(tool, driver, input, true) as Promise<{
    content: Array<{ type: string; text?: string; data?: string }>;
    isError?: boolean;
  }>, signal);
  if (raced === ABANDONED) {
    // Said plainly, because "stopped" and "did not happen" are different: the
    // call is still running in the editor and a write will still land.
    emit({ type: 'tool_end', id: call.id, ok: false, summary: 'stopped — this call was already running and may still complete' });
    return {
      outcome: { id: call.id, content: `stopped by the user while ${call.name} was running`, isError: false },
      mutated: false,
    };
  }
  const result = raced;
  const outcome = toOutcome(call.id, result);
  emit({
    type: 'tool_end',
    id: call.id,
    ok: !outcome.isError,
    summary: summarize(outcome.content),
    ...(outcome.image ? { image: `data:${outcome.image.mediaType};base64,${outcome.image.data}` } : {}),
  });
  // A failed call changed nothing worth re-verifying.
  return { outcome, mutated: mutates(tool) && !outcome.isError };
}

/**
 * The tools that check work against something other than the code that produced
 * it: pixels for a model that can see them, and the running game for every model.
 * No diagnostic answers "does it actually do the thing".
 */
const LOOKING_TOOLS = new Set([
  'capture_viewport', 'screenshot', 'set_play', 'play_probe', 'play_input',
  'find_entities', 'inspect_entity', 'list_resources', 'get_systems',
]);

/** The scene's outstanding validation issues as one line of context, or null
 *  when there are none (silence is the "still clean" signal). */
async function diagnostics(deps: KernelDeps): Promise<string | null> {
  try {
    const issues = await deps.driver('getDiagnostics', []) as Array<{
      entityName: string; component: string; field?: string; problem: string; detail: string;
    }>;
    const errors = issues.filter((i) => i.problem !== 'notice');
    if (errors.length === 0) return null;
    const lines = errors.slice(0, 12).map((i) => `- ${i.entityName}: ${i.detail}`);
    const more = errors.length > lines.length ? `\n- …and ${errors.length - lines.length} more` : '';
    return `The editor flags ${errors.length} problem(s) with the scene after those edits:\n`
      + `${lines.join('\n')}${more}\nFix them before reporting the work as done.`;
  } catch {
    // A host without a scene open (or mid-reload) is not a turn-ending problem.
    return null;
  }
}
