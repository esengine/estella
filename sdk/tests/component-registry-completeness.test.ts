// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { COMPONENT_META } from '../src/component.generated';
import { getComponent, ensureBuiltinComponentsRegistered } from '../src/component';

describe('builtin component registry completeness', () => {
    it('every COMPONENT_META component is registered (no silent-drop)', () => {
        // The invariant violated by the ShadowCaster2D bug: a component present in
        // the EHT-generated COMPONENT_META but absent from the registry, so the
        // scene loader silently dropped it.
        ensureBuiltinComponentsRegistered();
        for (const name of Object.keys(COMPONENT_META)) {
            expect(getComponent(name), `"${name}" is in COMPONENT_META but not registered`).toBeDefined();
        }
    });

    it('backstop registers a COMPONENT_META component that lacks a typed const', () => {
        const FAKE = '__BackstopProbe__';
        const meta = COMPONENT_META as Record<string, unknown>;
        meta[FAKE] = {
            defaults: { amount: 1 },
            assetFields: [], entityFields: [], colorFields: [], animatableFields: [], fields: {},
        };
        try {
            expect(getComponent(FAKE)).toBeUndefined();
            ensureBuiltinComponentsRegistered();
            const def = getComponent(FAKE);
            expect(def).toBeDefined();
            expect(def?._default).toEqual({ amount: 1 });
        } finally {
            delete meta[FAKE];
        }
    });

    it('is idempotent (re-running keeps the same def instance)', () => {
        ensureBuiltinComponentsRegistered();
        const first = getComponent('Sprite');
        ensureBuiltinComponentsRegistered();
        expect(getComponent('Sprite')).toBe(first);
    });
});
