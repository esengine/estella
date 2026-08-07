// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A PhysicsAPI answers with a usable pixels-per-unit before anyone pushes one.
 *
 * `_fromModule` builds the instance with `Object.create`, which runs no field
 * initializer. The default lived in one, so the published `Physics` resource
 * answered `undefined`, and `1 / undefined` is NaN — the character controller
 * reads it one system before `PhysicsStepSystem` pushes the Canvas value, so its
 * first move wrote a NaN Transform that every later move started from.
 */
import { describe, it, expect } from 'vitest';
import { PhysicsAPI } from '../src/physics/Physics';
import type { PhysicsWasmModule } from '../src/physics/PhysicsModuleLoader';

const fakeModule = () => ({}) as unknown as PhysicsWasmModule;

describe('PhysicsAPI pixels-per-unit', () => {
    it('is finite and positive on a _fromModule instance, before any push', () => {
        const ppu = PhysicsAPI._fromModule(fakeModule()).getPixelsPerUnit();
        expect(Number.isFinite(ppu)).toBe(true);
        expect(ppu).toBeGreaterThan(0);
    });

    it('takes the pushed value', () => {
        const api = PhysicsAPI._fromModule(fakeModule());
        api.setPixelsPerUnit(1);
        expect(api.getPixelsPerUnit()).toBe(1);
    });

    it('keeps the last good value when pushed a non-finite or non-positive one', () => {
        const api = PhysicsAPI._fromModule(fakeModule());
        api.setPixelsPerUnit(64);
        for (const bad of [NaN, Infinity, 0, -1, undefined as unknown as number]) {
            api.setPixelsPerUnit(bad);
            expect(api.getPixelsPerUnit()).toBe(64);
        }
    });
});
