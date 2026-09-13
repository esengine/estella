// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Locks the .esanimator graph ops after they were refactored onto the shared
// `stateGraph` core — the structural algorithms are shared with fsmGraph, but
// the animator keeps required transition lists, `{to, conditions}` payloads,
// parameters, and any-state transition rewiring on rename.
import { describe, it, expect } from 'vitest';
import {
    emptyAnimatorController, animatorEdges,
    addState, removeState, moveState, renameState, setInitial,
    addTransition, removeTransition, updateTransition, setConditions,
    addParam, removeParam, updateParam,
    addLayer as addAnimatorLayer, removeLayer as removeAnimatorLayer,
    updateLayer as updateAnimatorLayer, moveLayer as moveAnimatorLayer,
} from '../src/animation/animatorGraph';
import { animatorLayerCount, ANIMATOR_FORMAT_VERSION } from '../src/animation/Animator';
import type { AnimatorControllerDef } from '../src/animation/Animator';

describe('animatorGraph', () => {
    it('creates a blank controller with one initial state and no params', () => {
        const def = emptyAnimatorController();
        expect(def.initialState).toBe('Idle');
        expect(def.states).toEqual([{ name: 'Idle', x: 80, y: 80, transitions: [] }]);
        expect(def.parameters).toEqual([]);
    });

    it('adds states immutably; first state of an empty graph becomes initial', () => {
        const empty: AnimatorControllerDef = { parameters: [], states: [], initialState: '' };
        const one = addState(empty, 'Run', 10, 20);
        expect(one).not.toBe(empty);
        expect(one.initialState).toBe('Run');
        expect(one.states[0]).toEqual({ name: 'Run', x: 10, y: 20, transitions: [] });
        // duplicate is ignored
        expect(addState(one, 'Run')).toBe(one);
    });

    it('removes a state and prunes transitions that target it, reassigning initial', () => {
        let def = emptyAnimatorController();
        def = addState(def, 'Run');
        def = addTransition(def, 'Run', 'Idle');
        def = removeState(def, 'Idle');
        expect(def.states.map(s => s.name)).toEqual(['Run']);
        expect(def.states[0].transitions).toEqual([]);
        expect(def.initialState).toBe('Run');
    });

    it('creates transitions with an empty condition list and updates them', () => {
        let def = emptyAnimatorController();
        def = addState(def, 'Run');
        def = addTransition(def, 'Idle', 'Run');
        expect(def.states[0].transitions).toEqual([{ to: 'Run', conditions: [] }]);
        def = setConditions(def, 'Idle', 0, [{ param: 'Speed', op: 'gt', value: 0.1 }]);
        expect(def.states[0].transitions[0].conditions).toHaveLength(1);
        def = updateTransition(def, 'Idle', 0, { hasExitTime: true });
        expect(def.states[0].transitions[0].hasExitTime).toBe(true);
        def = removeTransition(def, 'Idle', 0);
        expect(def.states[0].transitions).toEqual([]);
    });

    it('renames a state, rewiring initial, state transitions AND any-state transitions', () => {
        let def = emptyAnimatorController();
        def = addState(def, 'Run');
        def = addTransition(def, 'Run', 'Idle');
        def = { ...def, anyStateTransitions: [{ to: 'Idle', conditions: [] }] };
        def = renameState(def, 'Idle', 'Base');
        expect(def.initialState).toBe('Base');
        expect(def.states.find(s => s.name === 'Run')!.transitions[0].to).toBe('Base');
        expect(def.anyStateTransitions![0].to).toBe('Base');
    });

    it('moves a state and sets initial only to an existing state', () => {
        let def = addState(emptyAnimatorController(), 'Run', 0, 0);
        def = moveState(def, 'Run', 40, 50);
        expect(def.states.find(s => s.name === 'Run')).toMatchObject({ x: 40, y: 50 });
        expect(setInitial(def, 'Nope')).toBe(def);
        expect(setInitial(def, 'Run').initialState).toBe('Run');
    });

    it('manages parameters', () => {
        let def = emptyAnimatorController();
        def = addParam(def, 'Speed', 'float');
        expect(def.parameters).toEqual([{ name: 'Speed', type: 'float' }]);
        expect(addParam(def, 'Speed', 'int')).toBe(def); // duplicate ignored
        def = updateParam(def, 'Speed', { type: 'int' });
        expect(def.parameters[0].type).toBe('int');
        def = removeParam(def, 'Speed');
        expect(def.parameters).toEqual([]);
    });

    it('flattens transitions into addressable edges', () => {
        let def = emptyAnimatorController();
        def = addState(def, 'Run');
        def = addTransition(def, 'Idle', 'Run');
        const edges = animatorEdges(def);
        expect(edges).toHaveLength(1);
        expect(edges[0]).toMatchObject({ id: 'Idle->Run#0', from: 'Idle', to: 'Run', index: 0 });
    });
});

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

describe('editing a controller with layers', () => {
    const base = (): AnimatorControllerDef => ({
        version: ANIMATOR_FORMAT_VERSION,
        parameters: [],
        states: [{ name: 'Idle', transitions: [] }],
        initialState: 'Idle',
    });

    it('adds a layer with a machine of its own', () => {
        const def = addAnimatorLayer(base(), 'arms');
        expect(animatorLayerCount(def)).toBe(2);
        expect(def.layers![0]!.states).toHaveLength(1);
        expect(def.layers![0]!.initialState).toBe('Idle');
    });

    it('refuses a second layer by the same name', () => {
        const once = addAnimatorLayer(base(), 'arms');
        expect(addAnimatorLayer(once, 'arms')).toBe(once);
    });

    it('edits the layer the op was given and no other', () => {
        // The base and the layer both hold a state called Idle. An op that
        // reached the wrong one would still "work", which is why this asserts on
        // both sides rather than on the one it edited.
        let def = addAnimatorLayer(base(), 'arms');
        def = addState(def, 'Wave', 0, 0, 1);
        expect(def.layers![0]!.states.map(s => s.name)).toEqual(['Idle', 'Wave']);
        expect(def.states.map(s => s.name)).toEqual(['Idle']);

        def = addState(def, 'Run', 0, 0);
        expect(def.states.map(s => s.name)).toEqual(['Idle', 'Run']);
        expect(def.layers![0]!.states.map(s => s.name)).toEqual(['Idle', 'Wave']);
    });

    it('renames within one layer, rewiring that layer’s any-state edges', () => {
        let def = addAnimatorLayer(base(), 'arms');
        def = updateAnimatorLayer(def, 1, {});
        def = { ...def, layers: [{ ...def.layers![0]!, anyStateTransitions: [{ to: 'Idle', conditions: [] }] }] };
        def = renameState(def, 'Idle', 'Calm', 1);

        expect(def.layers![0]!.initialState).toBe('Calm');
        expect(def.layers![0]!.anyStateTransitions![0]!.to).toBe('Calm');
        expect(def.initialState).toBe('Idle');
    });

    it('sets what a layer IS, and refuses to on the base', () => {
        let def = addAnimatorLayer(base(), 'arms');
        def = updateAnimatorLayer(def, 1, { weight: 0.4, blend: 'additive', mask: { paths: ['chest'] } });
        expect(def.layers![0]!.weight).toBe(0.4);
        expect(def.layers![0]!.blend).toBe('additive');
        expect(def.layers![0]!.mask!.paths).toEqual(['chest']);

        // The base layer has no weight to set — it is what the others modify.
        expect(updateAnimatorLayer(def, 0, { weight: 0.5 })).toBe(def);
        expect(removeAnimatorLayer(def, 0)).toBe(def);
    });

    it('reorders layers, order being what a stack means', () => {
        let def = addAnimatorLayer(addAnimatorLayer(base(), 'arms'), 'aim');
        expect(def.layers!.map(l => l.name)).toEqual(['arms', 'aim']);
        def = moveAnimatorLayer(def, 2, 1);
        expect(def.layers!.map(l => l.name)).toEqual(['aim', 'arms']);
    });

    it('removes a layer without disturbing the base', () => {
        let def = addAnimatorLayer(base(), 'arms');
        def = removeAnimatorLayer(def, 1);
        expect(animatorLayerCount(def)).toBe(1);
        expect(def.states.map(s => s.name)).toEqual(['Idle']);
    });
});
