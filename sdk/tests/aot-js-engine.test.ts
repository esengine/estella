// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The engine built as plain JavaScript (wasm2js) has an ArrayBuffer where
 *        the WebAssembly.Memory would be, and a compiled system is a wasm module
 *        that cannot import it. Installing answers 0 and every system keeps
 *        running interpreted: a browser without WebAssembly plays the same game.
 */
import { describe, it, expect } from 'vitest';
import { App } from '../src/app/app';
import { defineComponent } from '../src/ecs/component';
import { defineSystem } from '../src/ecs/system';
import { Query, Mut } from '../src/ecs/query';
import { createMockModule } from './mocks/wasm';
import { fadeManifest } from './helpers/aotFade';

describe('compiled systems on the JavaScript engine', () => {
    it('installs nothing and leaves the interpreted systems running', async () => {
        const app = App.new();
        const Fade = defineComponent('Fade', { alpha: 1, step: 0.1 });
        app.addSystem(defineSystem([Query(Mut(Fade))], (q) => {
            for (const [, row] of q) row.alpha -= row.step;
        }, { name: 'Fade' }));
        const module = createMockModule();
        // What wasm2js hands out: a Memory-shaped object over a plain ArrayBuffer.
        Object.assign(module, { wasmMemory: { buffer: new ArrayBuffer(1 << 16), grow: () => 0 } });
        app.connectCpp(module.getRegistry(), module);
        try {
            const notWasm = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]).buffer;
            expect(await app.installCompiledSystems(notWasm, fadeManifest())).toBe(0);
            const entity = app.world.spawn();
            app.world.insert(entity, Fade, { alpha: 1, step: 0.1 });
            await app.tick(1 / 60);
            expect(app.world.get(entity, Fade).alpha).toBeCloseTo(0.9);
        } finally {
            app.quit({ keepRenderer: true });
        }
    });
});
