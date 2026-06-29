// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { defineComponent, clearUserComponents, getComponent } from '../src/component';
import { AppContext, getDefaultContext, setDefaultContext } from '../src/context';

// RC10 P3 prerequisite: user component _id is interned by name (stable, module-global)
// so a re-imported project bundle resolves to the live World's existing component
// storage (which the World keys by _id) instead of minting a fresh identity that would
// silently miss every existing entity. See docs/REARCH_HOT_RELOAD.md §3.
describe('stable component _id by name (RC10 P3 prereq)', () => {
    const original = getDefaultContext();
    beforeEach(() => clearUserComponents());
    afterEach(() => {
        setDefaultContext(original);
        clearUserComponents();
    });

    it('keeps the same _id when redefined after clearUserComponents (the hot-reload case)', () => {
        const id1 = defineComponent('Patrol', { speed: 60 })._id;
        clearUserComponents();
        // Re-import after a code edit: the def object is new (and its shape may even
        // differ), but the identity the World stores under must be the same.
        const b = defineComponent('Patrol', { speed: 60, range: 120 });
        expect(b._id).toBe(id1);
    });

    it('gives distinct names distinct ids', () => {
        expect(defineComponent('IdA', { x: 0 })._id).not.toBe(defineComponent('IdB', { x: 0 })._id);
    });

    it('returns the existing def within one context (defineComponent dedup unchanged)', () => {
        const a = defineComponent('Dup', { x: 0 });
        expect(defineComponent('Dup', { x: 999 })).toBe(a);
    });

    it('shares the id by name across isolated contexts but keeps per-context defs', () => {
        const ctxA = new AppContext();
        const ctxB = new AppContext();

        setDefaultContext(ctxA);
        const a = defineComponent('Shared', { x: 0 });
        setDefaultContext(ctxB);
        const b = defineComponent('Shared', { x: 0 });

        expect(b._id).toBe(a._id); // same stable identity, like a builtin
        expect(b).not.toBe(a); // but the registries are isolated — distinct def objects

        setDefaultContext(ctxA);
        expect(getComponent('Shared')).toBe(a);
        setDefaultContext(ctxB);
        expect(getComponent('Shared')).toBe(b);
    });
});
