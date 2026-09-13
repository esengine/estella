// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    animatorGraph.ts
 * @brief   Immutable graph operations on an AnimatorControllerDef — the
 *          animation controller editor's model.
 *
 * The structural graph algorithms live in the shared `stateGraph` core; this
 * module binds them to the `.esanimator` shape (`initialState`, required
 * transition lists, `{to, conditions}` transitions) and adds the animator-only
 * ops (motion/props on a state, condition editing, parameters, and the
 * any-state transition rewiring on rename). An `.esanimator` payload IS the
 * runtime AnimatorControllerDef, so there is no separate editor model.
 */

import { ANIMATOR_FORMAT_VERSION } from './Animator';
import { animatorLayer } from './Animator';
import type {
    AnimatorControllerDef,
    AnimatorLayer,
    AnimatorScope,
    AnimatorState,
    AnimatorTransition,
    AnimatorCondition,
    AnimatorParam,
    AnimatorParamType,
} from './Animator';
import type { AnimatorMotion } from './motion';
import {
    type GraphSpec, type GraphEdge,
    graphEdges, addGraphState, removeGraphState, moveGraphState, renameGraphState,
    setGraphInitial, addGraphTransition, removeGraphTransition, updateGraphTransition,
} from '../stateGraph';

/** A flattened transition edge, for the graph canvas. */
export type AnimatorEdge = GraphEdge<AnimatorTransition>;

type AnimatorSpec = GraphSpec<AnimatorControllerDef, AnimatorState, AnimatorTransition>;

/** A controller with layer `index` patched; the base layer is the def itself. */
function withLayer(
    def: AnimatorControllerDef, index: number, patch: Partial<AnimatorLayer>,
): AnimatorControllerDef {
    if (index === 0) return { ...def, ...patch };
    const layers = (def.layers ?? []).map((l, i) => (i === index - 1 ? { ...l, ...patch } : l));
    return { ...def, layers };
}

/** Layer `index` as a scope, or an empty one for an index that is not there. */
function scopeAt(def: AnimatorControllerDef, index: number): AnimatorScope {
    return animatorLayer(def, index) ?? EMPTY_SCOPE;
}

const EMPTY_SCOPE: AnimatorScope = { states: [], initialState: '' };

/**
 * Every graph op is the same op on a different layer, so the layer is the only
 * thing that varies here — which is what keeps adding layers from multiplying
 * the editor's vocabulary. Memoized because a spec is identity-free and the ops
 * are called per keystroke.
 */
const specs = new Map<number, AnimatorSpec>();

function specFor(index: number): AnimatorSpec {
    let found = specs.get(index);
    if (found) return found;
    found = {
        states: def => scopeAt(def, index).states,
        withStates: (def, states) => withLayer(def, index, { states }),
        initial: def => scopeAt(def, index).initialState,
        withInitial: (def, initialState) => withLayer(def, index, { initialState }),
        transitions: state => state.transitions,
        withTransitions: (state, transitions) => ({ ...state, transitions }),
        makeState: (name, x, y) => ({ name, x, y, transitions: [] }),
        makeTransition: to => ({ to, conditions: [] }),
    };
    specs.set(index, found);
    return found;
}

/** Flatten every state's outgoing transitions into addressable edges. */
export function animatorEdges(def: AnimatorControllerDef, layer = 0): AnimatorEdge[] {
    return graphEdges(specFor(layer), def);
}

/** A blank controller with one initial state and no parameters. */
export function emptyAnimatorController(): AnimatorControllerDef {
    return {
        version: ANIMATOR_FORMAT_VERSION,
        parameters: [],
        states: [{ name: 'Idle', x: 80, y: 80, transitions: [] }],
        initialState: 'Idle',
    };
}

export function addState(def: AnimatorControllerDef, name: string, x = 0, y = 0, layer = 0): AnimatorControllerDef {
    return addGraphState(specFor(layer), def, name, x, y);
}

export function removeState(def: AnimatorControllerDef, name: string, layer = 0): AnimatorControllerDef {
    return removeGraphState(specFor(layer), def, name);
}

export function moveState(def: AnimatorControllerDef, name: string, x: number, y: number, layer = 0): AnimatorControllerDef {
    return moveGraphState(specFor(layer), def, name, x, y);
}

/**
 * Rename a state. On top of the shared rewiring (initial + per-state transition
 * targets) an animator also has any-state transitions to repoint.
 */
export function renameState(
    def: AnimatorControllerDef, oldName: string, newName: string, layer = 0,
): AnimatorControllerDef {
    const next = renameGraphState(specFor(layer), def, oldName, newName);
    const anyState = scopeAt(def, layer).anyStateTransitions;
    if (next === def || !anyState) return next;
    return withLayer(next, layer, {
        anyStateTransitions: anyState.map(t => (t.to === oldName ? { ...t, to: newName } : t)),
    });
}

export function setInitial(def: AnimatorControllerDef, name: string, layer = 0): AnimatorControllerDef {
    return setGraphInitial(specFor(layer), def, name);
}

/**
 * What a state plays, of any kind. Rebuilt rather than merged: a state names ONE
 * motion, so the fields spelling every other way of naming one have to go, or a
 * state would carry two and the reader would have to rank them.
 */
function withMotion(s: AnimatorState, motion: Partial<AnimatorState>): AnimatorState {
    return {
        name: s.name, x: s.x, y: s.y,
        transitions: s.transitions, speed: s.speed, loop: s.loop,
        ...motion,
    };
}

/** Set the state's motion to a single sprite clip (clears any other motion). */
export function setStateClip(
    def: AnimatorControllerDef, name: string, clip: string, layer = 0,
): AnimatorControllerDef {
    return withLayer(def, layer, {
        states: scopeAt(def, layer).states.map((s) =>
            s.name === name ? withMotion(s, clip ? { clip } : {}) : s),
    });
}

/**
 * Point the state at a motion of any registered kind — a timeline, a blend over
 * either. Null clears it, leaving a state that plays nothing.
 */
export function setStateMotion(
    def: AnimatorControllerDef, name: string, motion: AnimatorMotion | null, layer = 0,
): AnimatorControllerDef {
    return withLayer(def, layer, {
        states: scopeAt(def, layer).states.map((s) =>
            s.name === name ? withMotion(s, motion ? { motion } : {}) : s),
    });
}

export function setStateProps(
    def: AnimatorControllerDef, name: string,
    patch: { speed?: number; loop?: boolean; rootMotion?: boolean }, layer = 0,
): AnimatorControllerDef {
    return withLayer(def, layer, {
        states: scopeAt(def, layer).states.map((s) => (s.name === name ? { ...s, ...patch } : s)),
    });
}

export function addTransition(def: AnimatorControllerDef, from: string, to: string, layer = 0): AnimatorControllerDef {
    return addGraphTransition(specFor(layer), def, from, to);
}

export function removeTransition(def: AnimatorControllerDef, from: string, index: number, layer = 0): AnimatorControllerDef {
    return removeGraphTransition(specFor(layer), def, from, index);
}

export function updateTransition(
    def: AnimatorControllerDef,
    from: string,
    index: number,
    patch: Partial<AnimatorTransition>,
    layer = 0,
): AnimatorControllerDef {
    return updateGraphTransition(specFor(layer), def, from, index, patch);
}

/** Replace the whole condition list on a transition. */
export function setConditions(
    def: AnimatorControllerDef, from: string, index: number,
    conditions: AnimatorCondition[], layer = 0,
): AnimatorControllerDef {
    return updateTransition(def, from, index, { conditions }, layer);
}

// — Parameters —

export function addParam(def: AnimatorControllerDef, name: string, type: AnimatorParamType): AnimatorControllerDef {
    if (!name || def.parameters.some((p) => p.name === name)) return def;
    return { ...def, parameters: [...def.parameters, { name, type }] };
}

export function removeParam(def: AnimatorControllerDef, name: string): AnimatorControllerDef {
    return { ...def, parameters: def.parameters.filter((p) => p.name !== name) };
}

export function updateParam(def: AnimatorControllerDef, name: string, patch: Partial<AnimatorParam>): AnimatorControllerDef {
    return { ...def, parameters: def.parameters.map((p) => (p.name === name ? { ...p, ...patch } : p)) };
}

// — Layers —

/**
 * A new layer over the ones already there, with one state of its own. Added at
 * the top because that is what "over" means and it is where an author who just
 * asked for a layer expects to find it.
 */
export function addLayer(def: AnimatorControllerDef, name: string): AnimatorControllerDef {
    if (!name || (def.layers ?? []).some(l => l.name === name)) return def;
    const layer: AnimatorLayer = {
        name,
        states: [{ name: 'Idle', x: 80, y: 80, transitions: [] }],
        initialState: 'Idle',
    };
    return { ...def, layers: [...(def.layers ?? []), layer] };
}

/** Drop layer `index`. The base layer is not one of these and cannot be removed:
 *  a controller with no base is a controller that poses nothing. */
export function removeLayer(def: AnimatorControllerDef, index: number): AnimatorControllerDef {
    if (index <= 0 || !def.layers?.[index - 1]) return def;
    return { ...def, layers: def.layers.filter((_, i) => i !== index - 1) };
}

/** Patch what layer `index` is, as opposed to what its machine does. Refuses the
 *  base layer, which has no weight, blend or mask to set. */
export function updateLayer(
    def: AnimatorControllerDef, index: number,
    patch: Pick<Partial<AnimatorLayer>, 'name' | 'weight' | 'blend' | 'mask'>,
): AnimatorControllerDef {
    if (index <= 0 || !def.layers?.[index - 1]) return def;
    return withLayer(def, index, patch);
}

/**
 * Move layer `index` to `to`, both counted with the base layer at 0. Order is
 * what a stack means, so this is an edit like any other rather than a view
 * setting — and the base layer neither moves nor is displaced.
 */
export function moveLayer(
    def: AnimatorControllerDef, index: number, to: number,
): AnimatorControllerDef {
    const layers = def.layers;
    if (!layers || index <= 0 || to <= 0) return def;
    const from = index - 1;
    const dest = Math.min(to - 1, layers.length - 1);
    if (from === dest || !layers[from]) return def;
    const next = layers.slice();
    next.splice(dest, 0, next.splice(from, 1)[0]!);
    return { ...def, layers: next };
}
