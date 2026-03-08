/**
 * Integration tests: Timeline property animation applied to real WASM-backed components.
 *
 * Requires pre-built WASM at desktop/public/wasm/esengine.wasm.
 * Run `node build-tools/cli.js build -t web` first if missing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { World } from '../src/world';
import { Transform, Children, Name, getComponent } from '../src/component';
import { UIRect, type UIRectData } from '../src/ui/UIRect';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { loadWasmModule } from './helpers/loadWasm';
import {
    WrapMode,
    TrackType,
    type TimelineAsset,
    type PropertyTrack,
} from '../src/timeline/TimelineTypes';
import { setNestedProperty } from '../src/timeline/TimelinePlugin';

const WASM_PATH = resolve(__dirname, '../../desktop/public/wasm/esengine.wasm');
const HAS_WASM = existsSync(WASM_PATH);

describe.skipIf(!HAS_WASM)('Timeline WASM Integration', () => {
    let module: ESEngineModule;

    beforeAll(async () => {
        module = await loadWasmModule();
    });

    function createWorld(): { world: World; registry: CppRegistry } {
        const registry = new module.Registry() as unknown as CppRegistry;
        const world = new World();
        world.connectCpp(registry, module);
        return { world, registry };
    }

    function disposeWorld(world: World, registry: CppRegistry): void {
        for (const e of world.getAllEntities()) {
            try { world.despawn(e); } catch (_) {}
        }
        world.disconnectCpp();
        (registry as any).delete();
    }

    describe('world.set updates C++ Transform', () => {
        it('should update position.x via world.set', () => {
            const { world, registry } = createWorld();
            const entity = world.spawn();
            world.insert(entity, Transform);

            const before = world.get(entity, Transform);
            expect(before.position.x).toBe(0);

            const data = world.get(entity, Transform);
            data.position.x = 42;
            world.set(entity, Transform, data);

            const after = world.get(entity, Transform);
            expect(after.position.x).toBeCloseTo(42, 5);

            disposeWorld(world, registry);
        });

        it('should update position via setNestedProperty + world.set', () => {
            const { world, registry } = createWorld();
            const entity = world.spawn();
            world.insert(entity, Transform);

            const data = world.get(entity, Transform) as Record<string, any>;
            setNestedProperty(data, 'position.x', 99);
            setNestedProperty(data, 'position.y', 55);
            world.set(entity, Transform, data as any);

            const after = world.get(entity, Transform);
            expect(after.position.x).toBeCloseTo(99, 5);
            expect(after.position.y).toBeCloseTo(55, 5);

            disposeWorld(world, registry);
        });

        it('should update position via world.insert on existing component', () => {
            const { world, registry } = createWorld();
            const entity = world.spawn();
            world.insert(entity, Transform);

            const data = world.get(entity, Transform) as Record<string, any>;
            setNestedProperty(data, 'position.x', 77);
            world.insert(entity, Transform, data as any);

            const after = world.get(entity, Transform);
            expect(after.position.x).toBeCloseTo(77, 5);

            disposeWorld(world, registry);
        });
    });

    describe('getComponent resolves Transform', () => {
        it('should return Transform def from getComponent("Transform")', () => {
            const def = getComponent('Transform');
            expect(def).toBeDefined();
            expect(def!._name).toBe('Transform');
        });
    });
});
