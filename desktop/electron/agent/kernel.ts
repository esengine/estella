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
  return tool.name === 'run_editor_command' || tool.name === 'play_probe'
    ? 'arbitrary_code'
    : 'irreversible';
}

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
  const { driver, session, emit, model } = deps;
  const mark = await driver('mark', []);
  // Read before pushUser opens it: this is the index that turn will occupy.
  emit({ type: 'turn_start', prompt: text, model, index: session.turnIndex });

  let reason: Extract<AgentEvent, { type: 'turn_end' }>['reason'] = 'end_turn';
  try {
    if (context) session.pushContext(context);
    session.pushUser(text);

    // Bounded so a model that keeps calling tools cannot spin forever. Reaching
    // it is reported as an ordinary end of turn — the work so far stands, and
    // the person can say "keep going".
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const calls: ToolCall[] = [];
      let refused = false;

      for await (const ev of session.step(signal)) {
        if (ev.type === 'tool_call') calls.push(ev.call);
        if (ev.type === 'stop' && ev.reason === 'refusal') refused = true;
        emit(ev);
      }
      if (refused) { reason = 'refusal'; break; }
      if (calls.length === 0) break;

      const outcomes: ToolOutcome[] = [];
      let wrote = false;
      for (const call of calls) {
        if (signal.aborted) break;
        const { outcome, mutated } = await execute(deps, call);
        outcomes.push(outcome);
        wrote ||= mutated;
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
    }
  } catch (e) {
    reason = signal.aborted ? 'aborted' : 'error';
    if (!signal.aborted) emit({ type: 'error', message: (e as Error)?.message ?? String(e) });
  }
  if (signal.aborted) reason = 'aborted';

  const steps = Number(await driver('stepsSince', [mark]).catch(() => 0)) || 0;
  emit({ type: 'turn_end', steps, mark, reason });
  return { mark, steps };
}

const MAX_ROUNDS = 48;

/** Run one call: gate it, dispatch it, and report both ways. */
async function execute(
  deps: KernelDeps,
  call: ToolCall,
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
  if (irreversible(tool)) {
    const request = { callId: call.id, tool: call.name, reason: confirmReason(tool), input: call.input };
    emit({ type: 'awaiting_confirm', request });
    if (!await confirm(request)) {
      const content = `the user declined to run ${call.name}. Do not retry it; `
        + 'continue with what you can do without it, or say what you need.';
      emit({ type: 'tool_end', id: call.id, ok: false, summary: 'declined' });
      return { outcome: { id: call.id, content, isError: false }, mutated: false };
    }
  }

  const result = await runTool(tool, driver, call.input, true) as {
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
