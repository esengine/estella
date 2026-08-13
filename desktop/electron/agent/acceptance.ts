// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    acceptance.ts
 * @brief   Whether the work HELD — asked of the project, not of the model that
 *          did it.
 *
 * The turn already reported how it stopped. Nothing reported whether it worked,
 * so the only answer anyone had was the model's own closing paragraph, written
 * by the same reasoning that produced the work. This asks something else.
 *
 * It is `tools/releaseGate.mjs` one level down, deliberately: that file settled
 * how this repo states a claim, and the doctrine is worth exactly as much for a
 * turn as for a release. A criterion NAMES the thing that settles it. One only a
 * person can settle is allowed, as `manual`, saying why a machine cannot. A
 * criterion with neither is refused rather than recorded as passing.
 */
import type { KernelDeps } from './types';
import type { AcceptanceCriterion } from '../../src/project/format';

/**
 * One claim, and the thing that settles it. The project's standing claims are
 * the same shape (see {@link AcceptanceCriterion}) — one vocabulary, two owners.
 */
export type Criterion = AcceptanceCriterion;

/**
 * A criterion as the TURN declared it, plus what asking it at that moment
 * answered. `heldBefore` is a claim that was already true before any work: it
 * still gets checked, and it can still break, but it cannot be the thing that
 * says the work happened.
 */
export interface DeclaredCriterion extends Criterion {
  heldBefore?: boolean;
}

/**
 * Who the claim belongs to, which is what decides whether it can PASS a turn.
 *
 * Only `turn` can: the editor's checks and the project's standing claims say
 * the game is not broken, and a game that is not broken is not a turn that did
 * something. Both of the others can still fail one.
 */
export type CriterionOwner = 'editor' | 'project' | 'turn';

/**
 * A criterion and what became of it. It carries the claim WHOLE — the probe
 * included — because a reader wants to know what was actually checked, and
 * because keeping one means writing it into the project as it stands.
 * `unsettled` is neither pass nor fail: nothing was in a position to answer it.
 */
export interface CriterionResult extends DeclaredCriterion {
  /** A person answered this one. Only ever true on a `manual` claim, which is
   *  the only kind waiting for them. */
  settled?: boolean;
  state: 'held' | 'broke' | 'unsettled';
  /** What it answered, or why nothing could answer it. */
  detail?: string;
  owner: CriterionOwner;
  /**
   * Which of the editor's own checks this is. A CODE, not a sentence, for the
   * reason ConfirmReason is: the editor renders the words, because it is the
   * side that knows the reader's language. `says` stays the English the MODEL
   * reads. Absent on anything a person or a turn wrote.
   */
  check?: EditorCheck;
}

export type EditorCheck = 'diagnostics' | 'scripts';

/**
 * `failed` — something the turn claimed, or the editor itself, did not hold.
 * `passed` — every claim that could be settled held, and at least one was.
 * `unverified` — nothing settled anything: none were declared, or the ones
 * declared all need a person or a running game there was not.
 */
export type Verdict = 'passed' | 'failed' | 'unverified';

export interface Acceptance {
  verdict: Verdict;
  results: readonly CriterionResult[];
}

/** How many claims one turn may make. Enough for a feature, few enough that a
 *  list of them is still something a person reads. */
export const MAX_CRITERIA = 12;

/**
 * Reject a declaration that cannot mean anything, naming the rule it broke.
 * Null when it is well-formed.
 */
export function criteriaProblem(criteria: unknown): string | null {
  if (!Array.isArray(criteria) || criteria.length === 0) {
    return 'give at least one criterion, as `criteria: [{ says, probe }]`';
  }
  if (criteria.length > MAX_CRITERIA) {
    return `at most ${MAX_CRITERIA} criteria — pick the ones that would actually be checked`;
  }
  for (const c of criteria as Criterion[]) {
    if (!c || typeof c.says !== 'string' || c.says.trim() === '') {
      return 'every criterion needs `says`: what is claimed, in the words the user would use';
    }
    const settled = [c.probe, c.manual].filter((v) => typeof v === 'string' && v.trim() !== '');
    if (settled.length === 0) {
      return `"${c.says}" names nothing that settles it. Give \`probe\` — an expression `
        + 'evaluated in the running game that is true when the claim holds — or `manual`, '
        + 'saying why only a person can judge it. A claim nothing can check is not a claim.';
    }
    if (settled.length > 1) {
      return `"${c.says}" gives both \`probe\` and \`manual\`; one criterion, one thing that settles it`;
    }
  }
  return null;
}

/**
 * Run every claim over the work and say what became of it: the editor's own
 * checks, the project's standing claims, and the ones this turn declared.
 */
export async function evaluate(
  deps: KernelDeps,
  criteria: readonly DeclaredCriterion[],
): Promise<Acceptance> {
  const standing = deps.standing?.() ?? [];
  const results: CriterionResult[] = [
    ...await editorChecks(deps),
    ...await declaredChecks(deps, standing, 'project'),
    ...await declaredChecks(deps, criteria, 'turn'),
  ];
  return { verdict: verdictOf(results), results };
}

/**
 * The verdict a set of results comes to: `passed` needs a claim of the turn's
 * OWN that held and was not already holding, and nothing of the turn's left
 * hanging. Exported because a claim only a person can settle is settled later,
 * in the window, and a second reading of the rule there is a second answer.
 */
export function verdictOf(results: readonly CriterionResult[]): Verdict {
  const claims = results.filter((r) => r.owner === 'turn');
  if (results.some((r) => r.state === 'broke')) return 'failed';
  if (claims.some((r) => r.state === 'unsettled')) return 'unverified';
  return claims.some((r) => r.state === 'held' && !r.heldBefore) ? 'passed' : 'unverified';
}

async function editorChecks(deps: KernelDeps): Promise<CriterionResult[]> {
  const out: CriterionResult[] = [];

  try {
    const issues = await deps.driver('getDiagnostics', []) as Array<{
      entityName: string; problem: string; detail: string;
    }>;
    const errors = issues.filter((i) => i.problem !== 'notice');
    out.push(errors.length === 0
      ? { says: 'the editor flags nothing in the scene', state: 'held', owner: 'editor', check: 'diagnostics' }
      : {
        says: 'the editor flags nothing in the scene',
        state: 'broke',
        owner: 'editor',
        check: 'diagnostics',
        detail: errors.slice(0, 6).map((i) => `${i.entityName}: ${i.detail}`).join('; '),
      });
  } catch {
    // No scene open, or an editor mid-reload. Not something to fail a turn over.
  }

  try {
    const res = await deps.driver.op('check_scripts', {}) as {
      diagnostics?: Array<{ file: string; line: number; message: string; category?: string }>;
    };
    const errors = (res?.diagnostics ?? []).filter((d) => d.category !== 'warning');
    out.push(errors.length === 0
      ? { says: "the project's scripts compile", state: 'held', owner: 'editor', check: 'scripts' }
      : {
        says: "the project's scripts compile",
        state: 'broke',
        owner: 'editor',
        check: 'scripts',
        detail: errors.slice(0, 6).map((d) => `${d.file}:${d.line} ${d.message}`).join('; '),
      });
  } catch {
    // A project with no scripts, or no project at all.
  }
  return out;
}

async function declaredChecks(
  deps: KernelDeps,
  criteria: readonly DeclaredCriterion[],
  owner: CriterionOwner,
): Promise<CriterionResult[]> {
  if (criteria.length === 0) return [];
  const probes = criteria.filter((c) => c.probe);
  // Asked once for the whole set rather than per probe, and asked BEFORE
  // running any: a probe against a realm that is not up answers with an error
  // about the realm, which reads as the claim having broken.
  const playing = probes.length > 0 && await isPlaying(deps);

  const out: CriterionResult[] = [];
  for (const c of criteria) {
    if (c.manual) {
      out.push({ ...c, state: 'unsettled', owner, detail: `only a person can settle this: ${c.manual}` });
      continue;
    }
    if (!playing) {
      out.push({ ...c, state: 'unsettled', owner, detail: 'the game was not running, so nothing could answer this' });
      continue;
    }
    out.push(await runProbe(deps, c, owner));
  }
  return out;
}

/**
 * Ask the criteria BEFORE the work and mark the ones that already hold: one
 * that answers true against the untouched project is a guard, not evidence.
 * Declaring is always pre-write (the tool refuses it after), so this is the one
 * moment it can be asked. Nothing is claimed when the game is not up.
 */
export async function markBaseline(
  deps: KernelDeps,
  criteria: readonly Criterion[],
): Promise<DeclaredCriterion[]> {
  const probes = criteria.filter((c) => c.probe);
  if (probes.length === 0 || !await isPlaying(deps)) return criteria.map((c) => ({ ...c }));
  const out: DeclaredCriterion[] = [];
  for (const c of criteria) {
    if (!c.probe) { out.push({ ...c }); continue; }
    const asked = await runProbe(deps, c, 'turn');
    out.push(asked.state === 'held' ? { ...c, heldBefore: true } : { ...c });
  }
  return out;
}

async function isPlaying(deps: KernelDeps): Promise<boolean> {
  try {
    const state = await deps.driver('playState', [], 'editor') as { playing?: boolean; ready?: boolean };
    return state?.playing === true && state?.ready !== false;
  } catch {
    return false;
  }
}

/**
 * A probe answers with a VALUE, and anything but a truthy one is the claim not
 * holding. The value is reported either way — "it broke" that cannot say what it
 * got is a verdict nobody can act on.
 */
async function runProbe(
  deps: KernelDeps,
  c: Criterion,
  owner: CriterionOwner,
): Promise<CriterionResult> {
  try {
    const value = await deps.driver.op('play_probe', { code: c.probe });
    const answered = unwrap(value);
    return answered
      ? { ...c, state: 'held', owner }
      : { ...c, state: 'broke', owner, detail: `the probe answered ${brief(answered ?? value)}` };
  } catch (e) {
    return { ...c, state: 'broke', owner, detail: (e as Error)?.message ?? String(e) };
  }
}

/** The op answers in MCP's content-block wrapper; the value is inside it. */
function unwrap(value: unknown): unknown {
  const content = (value as { content?: Array<{ text?: string }> })?.content;
  if (!Array.isArray(content)) return value;
  const text = content.map((c) => c.text ?? '').join('').trim();
  try {
    return JSON.parse(text);
  } catch {
    // A probe that answered with a bare word — `true`, `undefined`, a message.
    return text === 'true' ? true : text === '' || text === 'false' || text === 'undefined' ? false : text;
  }
}

function brief(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
  return text.length > 200 ? `${text.slice(0, 197)}…` : text;
}

/** The failures, as the model is told them so it can fix them. Null when there
 *  is nothing to fix. */
export function failureReport(acceptance: Acceptance): string | null {
  const broke = acceptance.results.filter((r) => r.state === 'broke');
  if (broke.length === 0) return null;
  const lines = broke.map((r) => `- ${r.says}${r.detail ? ` — ${r.detail}` : ''}`);
  return `${broke.length} of the things this work has to do are not holding:\n${lines.join('\n')}\n`
    + 'Fix them and check again. If one of them is wrong about what was asked for, say so rather '
    + 'than reporting the work as done.';
}
