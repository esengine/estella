// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Replacing a builtin with data written before a field grew reads it as that field.
 *
 * `insert` merges data into the defaults one level in (component-default-merge
 * test), so a gravity stored as {x, y} still reads after it became a vec3. The
 * REPLACE path, `world.set`, handed the document's value to embind as it was, and
 * embind refuses a value_object with a missing field: the whole ParticleEmitter
 * write failed with `Missing field: "z"` and the emitter kept whatever it had.
 * celestial-heights' three scenes carry such a gravity, so opening them in the
 * editor logged the error and their dust fell at the wrong rate.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { Transform, ParticleEmitter } from '../src/ecs/component';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

let engine: ESEngineModule;
const apps: App[] = [];
afterEach(() => { for (const app of apps.splice(0)) app.quit(); vi.restoreAllMocks(); });

describe.skipIf(!HAS_WASM)('world.set on a builtin with an older, shorter vector', () => {
    beforeAll(async () => { engine = await loadWasmModule(); });

    it('fills the axis the data lacks from the default and keeps the rest', () => {
        const app = App.new();
        apps.push(app);
        app.connectCpp(new engine.Registry(), engine, { ownedRegistry: true });
        const e = app.world.spawn();
        app.world.insert(e, Transform, {});
        app.world.insert(e, ParticleEmitter, { rate: 3 });

        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const stored = { ...app.world.get(e, ParticleEmitter), gravity: { x: 0, y: -260 } };
        app.world.set(e, ParticleEmitter, stored as never);

        const read = app.world.get(e, ParticleEmitter);
        expect(read.gravity).toEqual({ x: 0, y: -260, z: 0 });
        expect(read.rate).toBe(3);
        expect(errors.mock.calls.map((c) => c.join(' ')).filter((s) => /Missing field/.test(s))).toEqual([]);
    });
});
