// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-animator-parameters.mjs — a parameter gameplay writes is one the
 *        graph answers.
 *
 * `grounded` was published every fixed step, asserted by two unit tests, and
 * read by no transition in any shipped graph: a character left the ground and
 * went on looking exactly the same. Producer, tests and declaration all green,
 * player behaviour unchanged.
 *
 * The claim is narrow on purpose. Not "every declared parameter must be used" —
 * a graph may carry a knob for a game that has not been written yet — but: a
 * parameter the ENGINE writes on a game's behalf must reach at least one
 * consumer in the graph that declares it. A consumer is a transition condition
 * or the parameter a blend selects on.
 *
 *   node tools/check-animator-parameters.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTrackedSources } from './lib/sourceRoots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Names gameplay code hands the animator, read from the constants that spell
 *  them so a renamed parameter cannot quietly leave this list behind. */
function writtenByGameplay() {
    const src = readFileSync(path.join(ROOT, 'sdk/src/gameplay/ThirdPersonController.ts'), 'utf8');
    return [...src.matchAll(/^export const TPC_\w+ = '([^']+)';/gm)].map((m) => m[1]);
}

/** Every parameter a state, transition or blend in `scope` reads. */
function consumers(scope, into = new Set()) {
    for (const t of scope.anyStateTransitions ?? []) {
        for (const c of t.conditions ?? []) into.add(c.param);
    }
    for (const state of scope.states ?? []) {
        for (const t of state.transitions ?? []) {
            for (const c of t.conditions ?? []) into.add(c.param);
        }
        // A blend selects on one, which is a use as real as a condition.
        for (const motion of [state.motion, state.blend].filter(Boolean)) {
            collectMotion(motion, into);
        }
        if (state.stateMachine) consumers(state.stateMachine, into);
    }
    return into;
}

function collectMotion(motion, into) {
    if (!motion || typeof motion !== 'object') return;
    if (typeof motion.parameter === 'string') into.add(motion.parameter);
    for (const stop of motion.thresholds ?? []) collectMotion(stop.motion, into);
}

const written = new Set(writtenByGameplay());
const { files } = listTrackedSources(['examples', 'templates', 'fixtures', 'sdk/src']);
const graphs = files.filter((f) => f.endsWith('.esanimator'));

const problems = [];
for (const file of graphs) {
    let def;
    try {
        def = JSON.parse(readFileSync(path.join(ROOT, file), 'utf8'));
    } catch (e) {
        problems.push(`${file} is not readable as a graph — ${e.message}`);
        continue;
    }
    const used = consumers(def);
    for (const param of def.parameters ?? []) {
        if (!written.has(param.name) || used.has(param.name)) continue;
        problems.push(`${file}: "${param.name}" is written by the engine every step and read by `
            + 'no transition or blend here — a dead knob, not a feature waiting for one');
    }
}

for (const p of problems) console.log(`✗ ${p}`);
console.log(problems.length === 0
    ? `check-animator-parameters: ${graphs.length} graph(s) — every engine-written parameter has a consumer`
    : `check-animator-parameters: ${problems.length} finding(s)`);
process.exit(problems.length === 0 ? 0 : 1);
