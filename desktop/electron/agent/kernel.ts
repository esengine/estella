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
  AgentEvent, CatalogTool, KernelDeps, ToolCall, ToolOutcome,
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

/** Why `tool` needs saying out loud, phrased for the person who will read it. */
function confirmReason(tool: CatalogTool): string {
  return tool.name === 'run_editor_command' || tool.name === 'play_probe'
    ? 'runs code the agent wrote, so its effect is whatever that code does'
    : 'writes outside the scene, and Undo cannot take it back';
}

/** Short enough to render as one transcript row; the model gets the full text. */
function summarize(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 160 ? `${flat.slice(0, 157)}…` : flat;
}

/**
 * MCP wraps a result as content blocks because that is its wire format. The
 * provider wants text, and an image block wants to stay an image — flatten,
 * keeping the distinction the model actually acts on.
 */
function toOutcome(id: string, result: {
  content: Array<{ type: string; text?: string; data?: string }>;
  isError?: boolean;
}): ToolOutcome {
  const parts = result.content.map((c) => (c.type === 'image' ? '[image]' : c.text ?? ''));
  return { id, content: parts.join('\n') || 'ok', isError: result.isError === true };
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
  const { driver, session, emit } = deps;
  const mark = await driver('mark', []);
  emit({ type: 'turn_start' });

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
  emit({ type: 'turn_end', steps, reason });
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
  emit({ type: 'tool_end', id: call.id, ok: !outcome.isError, summary: summarize(outcome.content) });
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
