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
 * or the parameter a blend selects on, in ANY of the graph's layers.
 *
 * A layer's mask is held to the same shape of claim. A mask names the part of
 * the rig the layer may write, by the childPath a clip uses to name the joint it
 * animates — so a mask admitting no track of the layer's own clips is a layer
 * that poses nothing, which reads in the editor exactly like one that works.
 *
 *   node tools/check-animator-parameters.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
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

/** Every machine in a controller: the base layer, then the layers over it. */
function scopesOf(def) {
    return [def, ...(def.layers ?? [])];
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
    const used = new Set();
    for (const scope of scopesOf(def)) consumers(scope, used);
    for (const param of def.parameters ?? []) {
        if (!written.has(param.name) || used.has(param.name)) continue;
        problems.push(`${file}: "${param.name}" is written by the engine every step and read by `
            + 'no transition or blend here — a dead knob, not a feature waiting for one');
    }
    problems.push(...deadMasks(file, def));
}

/** The childPaths every clip a scope plays writes to, read off the clips. */
function reachedPaths(file, scope) {
    const dir = path.dirname(path.join(ROOT, file));
    const paths = new Set();
    const clips = new Set();
    const gather = (motion) => {
        if (!motion || typeof motion !== 'object') return;
        if (typeof motion.clip === 'string') clips.add(motion.clip);
        for (const stop of motion.thresholds ?? []) gather(stop.motion);
        for (const point of motion.points ?? []) gather(point.motion);
    };
    for (const state of scope.states ?? []) {
        gather(state.motion);
        if (state.stateMachine) for (const p of reachedPaths(file, state.stateMachine)) paths.add(p);
    }
    for (const clip of clips) {
        const at = path.join(dir, clip);
        if (!clip.endsWith('.estimeline') || !existsSync(at)) continue;
        try {
            for (const track of JSON.parse(readFileSync(at, 'utf8')).tracks ?? []) {
                if (typeof track.childPath === 'string') paths.add(track.childPath);
            }
        } catch { /* a clip this reader cannot parse is another gate's finding */ }
    }
    return paths;
}

/** A mask admitting no track of its own layer's clips poses nothing. */
function deadMasks(file, def) {
    const found = [];
    for (const layer of def.layers ?? []) {
        const mask = layer.mask;
        if (!mask) continue;
        const reached = reachedPaths(file, layer);
        // Nothing to compare against: the layer's clips are not on disk beside
        // it, which this reader cannot tell from a layer with no clips at all.
        if (reached.size === 0) continue;
        for (const masked of mask.paths ?? []) {
            const admits = [...reached].some(
                (p) => p === masked || masked === '' || p.startsWith(`${masked}/`),
            );
            if (!admits) {
                found.push(`${file}: layer "${layer.name}" masks to "${masked}", which admits no `
                    + `track of its own clips (${[...reached].map((p) => p || '<root>').join(', ')}) `
                    + '— the layer poses nothing, and looks in the editor exactly like one that does');
            }
        }
    }
    return found;
}

for (const p of problems) console.log(`✗ ${p}`);
console.log(problems.length === 0
    ? `check-animator-parameters: ${graphs.length} graph(s) — every engine-written parameter has a consumer, `
    + 'and every layer mask admits a track its own clips write'
    : `check-animator-parameters: ${problems.length} finding(s)`);
process.exit(problems.length === 0 ? 0 : 1);
