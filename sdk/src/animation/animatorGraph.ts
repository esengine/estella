// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    animatorGraph.ts
 * @brief   Immutable graph operations on an AnimatorControllerDef — the animation
 *          controller editor's model.
 *
 * Pure functions returning new definitions (never mutating), so the state-graph
 * editor drives them through AssetDocument.edit for free undo, mirroring
 * fsmGraph.ts. An `.esanimator` payload IS the runtime AnimatorControllerDef
 * (states carry optional x/y layout the interpreter ignores), so there is no
 * separate editor model to compile.
 */

import type {
  AnimatorControllerDef,
  AnimatorState,
  AnimatorTransition,
  AnimatorCondition,
  AnimatorParam,
  AnimatorParamType,
} from './Animator';

/** A flattened transition edge, for the graph canvas. */
export interface AnimatorEdge {
  /** Stable id `from->to#index`. */
  id: string;
  from: string;
  to: string;
  index: number;
  transition: AnimatorTransition;
}

/** Flatten every state's outgoing transitions into addressable edges. */
export function animatorEdges(def: AnimatorControllerDef): AnimatorEdge[] {
  const edges: AnimatorEdge[] = [];
  for (const s of def.states) {
    s.transitions.forEach((transition, index) => {
      edges.push({ id: `${s.name}->${transition.to}#${index}`, from: s.name, to: transition.to, index, transition });
    });
  }
  return edges;
}

/** A blank controller with one initial state and no parameters. */
export function emptyAnimatorController(): AnimatorControllerDef {
  return { parameters: [], states: [{ name: 'Idle', x: 80, y: 80, transitions: [] }], initialState: 'Idle' };
}

export function addState(def: AnimatorControllerDef, name: string, x = 0, y = 0): AnimatorControllerDef {
  if (def.states.some((s) => s.name === name)) return def;
  const state: AnimatorState = { name, x, y, transitions: [] };
  return {
    ...def,
    states: [...def.states, state],
    // The first state added to an empty machine becomes the initial one.
    initialState: def.states.length === 0 ? name : def.initialState,
  };
}

export function removeState(def: AnimatorControllerDef, name: string): AnimatorControllerDef {
  const states = def.states
    .filter((s) => s.name !== name)
    .map((s) => (s.transitions.some((t) => t.to === name) ? { ...s, transitions: s.transitions.filter((t) => t.to !== name) } : s));
  const initialState = def.initialState === name ? (states[0]?.name ?? '') : def.initialState;
  return { ...def, states, initialState };
}

export function moveState(def: AnimatorControllerDef, name: string, x: number, y: number): AnimatorControllerDef {
  return { ...def, states: def.states.map((s) => (s.name === name ? { ...s, x, y } : s)) };
}

/** Rename a state, rewiring `initialState` and every transition that targets it. */
export function renameState(def: AnimatorControllerDef, oldName: string, newName: string): AnimatorControllerDef {
  if (oldName === newName || !newName) return def;
  if (def.states.some((s) => s.name === newName)) return def;
  const rewire = (ts: AnimatorTransition[]) => ts.map((t) => (t.to === oldName ? { ...t, to: newName } : t));
  const states = def.states.map((s) => {
    const ns = s.name === oldName ? { ...s, name: newName } : s;
    return ns.transitions.some((t) => t.to === oldName) ? { ...ns, transitions: rewire(ns.transitions) } : ns;
  });
  return {
    ...def,
    states,
    initialState: def.initialState === oldName ? newName : def.initialState,
    ...(def.anyStateTransitions ? { anyStateTransitions: rewire(def.anyStateTransitions) } : {}),
  };
}

export function setInitial(def: AnimatorControllerDef, name: string): AnimatorControllerDef {
  return def.states.some((s) => s.name === name) ? { ...def, initialState: name } : def;
}

/** Set the state's motion to a single sprite clip (clears blend/spine/nested). */
export function setStateClip(def: AnimatorControllerDef, name: string, clip: string): AnimatorControllerDef {
  return {
    ...def,
    states: def.states.map((s) =>
      s.name === name
        ? { name: s.name, x: s.x, y: s.y, transitions: s.transitions, speed: s.speed, loop: s.loop, ...(clip ? { clip } : {}) }
        : s,
    ),
  };
}

export function setStateProps(def: AnimatorControllerDef, name: string, patch: { speed?: number; loop?: boolean }): AnimatorControllerDef {
  return { ...def, states: def.states.map((s) => (s.name === name ? { ...s, ...patch } : s)) };
}

export function addTransition(def: AnimatorControllerDef, from: string, to: string): AnimatorControllerDef {
  return {
    ...def,
    states: def.states.map((s) => (s.name === from ? { ...s, transitions: [...s.transitions, { to, conditions: [] }] } : s)),
  };
}

export function removeTransition(def: AnimatorControllerDef, from: string, index: number): AnimatorControllerDef {
  return {
    ...def,
    states: def.states.map((s) => (s.name === from ? { ...s, transitions: s.transitions.filter((_, i) => i !== index) } : s)),
  };
}

export function updateTransition(def: AnimatorControllerDef, from: string, index: number, patch: Partial<AnimatorTransition>): AnimatorControllerDef {
  return {
    ...def,
    states: def.states.map((s) => (s.name === from ? { ...s, transitions: s.transitions.map((t, i) => (i === index ? { ...t, ...patch } : t)) } : s)),
  };
}

/** Replace the whole condition list on a transition. */
export function setConditions(def: AnimatorControllerDef, from: string, index: number, conditions: AnimatorCondition[]): AnimatorControllerDef {
  return updateTransition(def, from, index, { conditions });
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
