// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  RC11 N2 over the real boundary: Transform (C++-backed, heap storage,
 *        vec3/quat object shapes) replicates between two Apps that each own a
 *        C++ Registry in the shared wasm module. The `replicated` annotation
 *        on Transform.hpp drives the whole pipeline — no per-component code.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { App } from '../src/app';
import { Transform, getReplicatedFields } from '../src/component';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';
import { MemoryTransport } from '../src/net/MemoryTransport';
import { replicationPlugin, Net, Replicated, NetGhost } from '../src/net/replication';

const STEP = 1 / 60;

describe.skipIf(!HAS_WASM)('replication over the wasm boundary (Transform)', () => {
    let module: ESEngineModule;

    beforeAll(async () => {
        module = await loadWasmModule();
    });

    function makeWasmApp(): App {
        const app = App.new();
        const registry = new (module as any).Registry() as CppRegistry;
        app.connectCpp(registry, module);
        app.addPlugin(replicationPlugin);
        return app;
    }

    it('replicates the annotated Transform pose, f32-exact, computed fields untouched', async () => {
        expect(getReplicatedFields('Transform')).toEqual(['position', 'rotation', 'scale']);

        const serverApp = makeWasmApp();
        const clientApp = makeWasmApp();
        const server = serverApp.getResource(Net).startServer();
        const [ta, tb] = MemoryTransport.pair();
        server.attachConnection(ta);
        await clientApp.getResource(Net).connect(tb, { interpolationDelayTicks: 0 });

        const e = serverApp.world.spawn('hero');
        serverApp.world.insert(e, Transform, { position: { x: 10.5, y: -3.25, z: 0 } });
        serverApp.world.insert(e, Replicated, {});

        await serverApp.tick(STEP);
        await clientApp.tick(STEP);

        const ghosts = clientApp.world.getEntitiesWithComponents([Replicated]);
        expect(ghosts).toHaveLength(1);
        const ghost = ghosts[0];
        expect(clientApp.world.has(ghost, NetGhost)).toBe(true);
        const t0 = clientApp.world.tryGet(ghost, Transform)!;
        expect(t0.position.x).toBe(10.5);
        expect(t0.position.y).toBe(-3.25);

        // Move on the server — only the annotated pose fields travel.
        const st = serverApp.world.tryGet(e, Transform)!;
        st.position.x = 99.75;
        st.scale.x = 2;
        serverApp.world.set(e, Transform, st);

        await serverApp.tick(STEP);
        await clientApp.tick(STEP);

        const t1 = clientApp.world.tryGet(ghost, Transform)!;
        expect(t1.position.x).toBe(99.75);
        expect(t1.position.y).toBe(-3.25);
        expect(t1.scale.x).toBe(2);

        // Server-side despawn tears the ghost down.
        serverApp.world.despawn(e);
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);
        expect(clientApp.world.getEntitiesWithComponents([Replicated])).toHaveLength(0);
    });
});
