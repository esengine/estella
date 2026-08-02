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
  AgentEvent, CatalogTool, ConfirmReason, KernelDeps, ToolCall, ToolOutcome,
} from './types';
// Plain .mjs, shared with the MCP fronts — esbuild bundles it into main.
// @ts-expect-error untyped shared module
import { TOOLS, runTool, mutates, irreversible } from '../../shared/toolCatalog.mjs';

const catalog = TOOLS as CatalogTool[];
const byName = new Map(catalog.map((t) => [t.name, t]));

/** The tools an in-editor agent may call. Everything: the coarse
 *  ESTELLA_MCP_ALLOW_WRITES door exists because a REMOTE client has nobody to
 *  ask, and this one has the user right there (see the confirm gate below). */
export const agentTools = (): readonly CatalogTool[] => catalog;

/** Why `tool` needs saying out loud. A code — the editor renders the sentence,
 *  because it is the side that knows the reader's language. */
function confirmReason(tool: CatalogTool): ConfirmReason {
  if (tool.name === BULK_EDIT_TOOL) return 'bulk_edit';
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
 * The turn is bracketed by an undo checkpoint rather than a transaction: a
 * transaction held across model latency would lock the editor for seconds and
 * leave a dangling one on a crash, while a checkpoint lets each tool call stay
 * its own ordinary undo step AND the whole turn revert in one gesture
 * (EditorHistory.mark).
 *
 * @returns the checkpoint, so the caller can offer that revert.
 */
export async function runTurn(
  deps: KernelDeps,
  text: string,
  context: string | null,
  signal: AbortSignal,
): Promise<{ mark: unknown; steps: number }> {
  const { driver, session, emit, model, acceptsImages } = deps;
  const mark = await driver('mark', []);
  // Read before pushUser opens it: this is the index that turn will occupy.
  emit({ type: 'turn_start', prompt: text, model, index: session.turnIndex });

  let reason: Extract<AgentEvent, { type: 'turn_end' }>['reason'] = 'end_turn';
  // Tools the person has waved through for the REST OF THIS RUN. Not persisted:
  // an "always" that outlives the run is a permission switch nobody remembers
  // flipping, which is the thing the gate exists to prevent.
  const allowed = new Set<string>();
  // Undo steps this turn is responsible for, so a jump beyond it is the person.
  let ours = 0;
  try {
    if (context) session.pushContext(context);
    if (!acceptsImages) {
      session.pushContext(
        'This endpoint cannot carry images, so capture_viewport and the other screenshot '
        + 'tools will not let you SEE anything — their frames cannot reach you. Verify with '
        + 'get_diagnostics and by reading fields back instead of by looking.',
      );
    }
    session.pushUser(text);

    // Bounded so a model that keeps calling tools cannot spin forever.
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

      const calls: ToolCall[] = [];
      let refused = false;

      for await (const ev of session.step(signal)) {
        if (ev.type === 'tool_call') calls.push(ev.call);
        if (ev.type === 'stop' && ev.reason === 'refusal') refused = true;
        emit(ev);
      }
      if (refused) { reason = 'refusal'; break; }
      if (calls.length === 0) break;

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
          ? await Promise.all(calls.slice(i, end).map((c) => execute(deps, c, allowed)))
          : [await execute(deps, calls[i], allowed)];
        for (const done of batch) {
          outcomes.push(done.outcome);
          wrote ||= done.mutated;
        }
        i += batch.length;
      }
      if (signal.aborted) break;

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

  const steps = await undoSteps(deps, mark);
  emit({ type: 'turn_end', steps, mark, reason });
  return { mark, steps };
}

const MAX_ROUNDS = 48;

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

/** Run one call: gate it, dispatch it, and report both ways. */
async function execute(
  deps: KernelDeps,
  call: ToolCall,
  allowed: Set<string>,
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

  // The one gate. `read` and `undoable` run unasked — the turn's checkpoint is
  // the approval, and a prompt per setField would make the agent unusable.
  // `irreversible` is where undo stops being an answer, so it is where the
  // person has to be.
  // Already waved through for the rest of this run — see ConfirmAnswer.
  const gated = irreversible(tool) || call.name === BULK_EDIT_TOOL;
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

  const result = await runTool(tool, driver, input, true) as {
    content: Array<{ type: string; text?: string; data?: string }>;
    isError?: boolean;
  };
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
