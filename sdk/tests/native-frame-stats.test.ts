// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  native-frame-stats.test.ts — a device with no wasm module still reports
 *        what its engine counted.
 *
 * A native build answers the engine's counters through the host's bindings, not a
 * module; reading `app.wasmModule` there reported zero draws for a frame the Frame
 * Debugger captured ten draws from.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { Schedule, defineSystem } from '../src/ecs/system';
import { setNativeEngineApi } from '../src/ecs/bridge/engineApi';
import { frameStatsReport } from '../src/runtime/frameStats';
import { ProfileRecorder } from '../src/app/profileRecorder';

function nativeEngine() {
    return {
        renderer_getDrawCalls: () => 10,
        renderer_getTriangles: () => 36,
        renderer_getSprites: () => 7,
        renderer_getGpuTimeMs: () => 1.5,
        renderer_getTextureBytes: () => 4096,
        engine_getCpuScopes: () => JSON.stringify({ 'render.submit': 0.8 }),
        engine_getCounters: () => JSON.stringify({ batches: 3 }),
        engine_getGpuScopes: () => JSON.stringify({ main: 1.2 }),
        engine_setCpuProfiling: vi.fn(),
    };
}

afterEach(() => setNativeEngineApi(null));

describe('frame stats on a device with no wasm module', () => {
    it('reads the counters from the native engine', () => {
        setNativeEngineApi(nativeEngine());
        const report = frameStatsReport(App.new());

        expect(report).toMatchObject({
            drawCalls: 10, triangles: 36, sprites: 7, gpuMs: 1.5, vramBytes: 4096,
            cppScopes: { 'render.submit': 0.8 },
            cppCounters: { batches: 3 },
            gpuScopes: { main: 1.2 },
            wasmBytes: 0,
        });
    });

    it('a profile recording turns on and reads the native engine too', async () => {
        const engine = nativeEngine();
        setNativeEngineApi(engine);
        const app = App.new();
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {}, { name: 'Worker' }));
        const rec = new ProfileRecorder(app);

        rec.start();
        await app.tick(1 / 60);
        rec.stop();

        expect(engine.engine_setCpuProfiling.mock.calls).toEqual([[true], [false]]);
        const frame = rec.take().frames[0];
        expect(frame.gpuMs).toBe(1.5);
        expect(frame.memory?.vramBytes).toBe(4096);
        expect(frame.counters).toEqual({ batches: 3 });
    });
});
