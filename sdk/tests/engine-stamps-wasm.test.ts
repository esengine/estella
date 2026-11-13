// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// A script's write to an engine component is stamped in the engine, where the engine's own readers of changes (the renderer)
// ask: batched in the World, handed over before the transforms are composed and at the frame's tick.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { Transform, Sprite, type TransformData } from '../src/ecs/component';
import { flushEngineStamps } from '../src/ecs/engineStamps';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('engine change stamps from script writes', () => {
    let engine: ESEngineModule;
    let registry: CppRegistry;
    let app: App;
    let transformId = -1;
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => {
        setDefaultContext(new AppContext());
        registry = new engine.Registry();
        app = App.new();
        app.connectCpp(registry, engine);
        transformId = registry.componentTypeId!('Transform');
    });
    afterEach(() => {
        app.world.disconnectCpp();
        registry.delete();
    });
    const changedSince = (entity: number, tick: number) => registry.componentChangedSince(transformId, entity, tick);

    it('stamps a set, an update and a markChanged once they are handed over, and nothing else', () => {
        const entity = app.world.spawn();
        app.world.insert(entity, Transform);
        app.world.flushEngineStamps();
        const seen = registry.beginChangeRead();
        expect(changedSince(entity, seen)).toBe(false);

        // A write the engine makes (a replace) is stamped where it is made.
        app.world.update(entity, Transform, (t: TransformData) => { t.position.x = 5; });
        app.world.flushEngineStamps();
        expect(changedSince(entity, seen)).toBe(true);

        // One only the script knows of waits in the batch until it is handed over: here, by the render pipeline's flush.
        const later = registry.beginChangeRead();
        app.world.markChanged(entity, Transform);
        expect(changedSince(entity, later)).toBe(false);
        flushEngineStamps(registry);
        expect(changedSince(entity, later)).toBe(true);

        const again = registry.beginChangeRead();
        app.world.get(entity, Transform);
        app.world.flushEngineStamps();
        expect(changedSince(entity, again)).toBe(false);  // a read is no write

        app.world.markChanged(entity, Transform);
        app.world.flushEngineStamps();
        expect(changedSince(entity, again)).toBe(true);
    });

    it('stamps only the component written', () => {
        const entity = app.world.spawn();
        app.world.insert(entity, Transform);
        app.world.insert(entity, Sprite);
        app.world.flushEngineStamps();
        const seen = registry.beginChangeRead();
        app.world.update(entity, Sprite, (s: { size: { x: number } }) => { s.size.x = 3; });
        app.world.flushEngineStamps();
        expect(changedSince(entity, seen)).toBe(false);
        expect(registry.componentChangedSince(registry.componentTypeId!('Sprite'), entity, seen)).toBe(true);
    });

    it('hands over a long batch in one go, and the frame tick hands over the rest', () => {
        const entities = Array.from({ length: 9000 }, () => {
            const e = app.world.spawn();
            app.world.insert(e, Transform);
            return e;
        });
        app.world.flushEngineStamps();
        const seen = registry.beginChangeRead();
        for (const e of entities) app.world.markChanged(e, Transform);
        // 8192 went over on their own; the rest wait for the tick.
        expect(changedSince(entities[0]!, seen)).toBe(true);
        expect(changedSince(entities[8999]!, seen)).toBe(false);
        app.world.advanceTick();
        expect(entities.every((e) => changedSince(e, seen))).toBe(true);
    });

    it('lets the audit see a script world with nothing unstamped', () => {
        const entity = app.world.spawn();
        app.world.insert(entity, Transform);
        app.world.setChangeAudit(true);
        app.world.update(entity, Transform, (t: TransformData) => { t.position.y = 2; });
        app.world.advanceTick();
        app.world.advanceTick();
        expect(app.world.changeAuditTotal()).toBe(0);
        app.world.setChangeAudit(false);
    });
});
