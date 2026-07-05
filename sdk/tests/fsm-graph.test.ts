// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import {
    emptyFsm,
    addState,
    removeState,
    moveState,
    renameState,
    setStateHook,
    setInitial,
    addTransition,
    removeTransition,
    updateTransition,
    fsmEdges,
} from '../src/ai/fsm/fsmGraph';
import type { FsmDefinition } from '../src/ai/fsm/types';

describe('fsmGraph', () => {
    it('creates a blank machine with one initial state', () => {
        const def = emptyFsm();
        expect(def.initial).toBe('Idle');
        expect(def.states).toHaveLength(1);
    });

    it('adds states without mutating the input and ignores duplicates', () => {
        const a = emptyFsm();
        const b = addState(a, 'Chase', 200, 40);
        expect(a.states).toHaveLength(1); // input untouched
        expect(b.states.map(s => s.name)).toEqual(['Idle', 'Chase']);
        expect(addState(b, 'Chase')).toBe(b); // duplicate → same ref
    });

    it('first state added to an empty machine becomes initial', () => {
        const empty: FsmDefinition = { initial: '', states: [] };
        const def = addState(empty, 'Boot');
        expect(def.initial).toBe('Boot');
    });

    it('removes a state and prunes transitions that target it', () => {
        let def = emptyFsm();
        def = addState(def, 'Chase');
        def = addTransition(def, 'Idle', 'Chase');
        def = addTransition(def, 'Chase', 'Idle');
        def = removeState(def, 'Chase');
        expect(def.states.map(s => s.name)).toEqual(['Idle']);
        // Idle's transition to the removed Chase is gone.
        expect(fsmEdges(def)).toHaveLength(0);
    });

    it('reassigns initial when the initial state is removed', () => {
        let def = emptyFsm();
        def = addState(def, 'Chase');
        def = removeState(def, 'Idle');
        expect(def.initial).toBe('Chase');
    });

    it('moves a state to new coordinates', () => {
        const def = moveState(emptyFsm(), 'Idle', 300, 150);
        expect(def.states[0]).toMatchObject({ x: 300, y: 150 });
    });

    it('renames a state, rewiring initial and transition targets', () => {
        let def = emptyFsm();
        def = addState(def, 'Chase');
        def = addTransition(def, 'Chase', 'Idle');
        def = renameState(def, 'Idle', 'Patrol');
        expect(def.initial).toBe('Patrol');
        expect(fsmEdges(def)[0].to).toBe('Patrol');
        expect(renameState(def, 'Patrol', 'Chase')).toBe(def); // dup target → no-op
    });

    it('sets and clears state action hooks', () => {
        let def = setStateHook(emptyFsm(), 'Idle', 'onUpdate', 'wander');
        expect(def.states[0].onUpdate).toBe('wander');
        def = setStateHook(def, 'Idle', 'onUpdate', '');
        expect(def.states[0].onUpdate).toBeUndefined();
    });

    it('sets initial only to an existing state', () => {
        let def = emptyFsm();
        def = addState(def, 'Chase');
        expect(setInitial(def, 'Chase').initial).toBe('Chase');
        expect(setInitial(def, 'Ghost')).toBe(def); // unknown → no-op
    });

    it('adds, updates and removes transitions', () => {
        let def = emptyFsm();
        def = addState(def, 'Chase');
        def = addTransition(def, 'Idle', 'Chase');
        expect(fsmEdges(def)).toHaveLength(1);

        def = updateTransition(def, 'Idle', 0, { guard: { key: 'seesPlayer', op: 'truthy' } });
        expect(fsmEdges(def)[0].transition.guard).toEqual({ key: 'seesPlayer', op: 'truthy' });

        def = removeTransition(def, 'Idle', 0);
        expect(fsmEdges(def)).toHaveLength(0);
    });

    it('flattens transitions into addressable edges', () => {
        let def = emptyFsm();
        def = addState(def, 'Chase');
        def = addTransition(def, 'Idle', 'Chase');
        def = addTransition(def, 'Idle', 'Idle');
        const edges = fsmEdges(def);
        expect(edges.map(e => e.id)).toEqual(['Idle->Chase#0', 'Idle->Idle#1']);
    });
});
