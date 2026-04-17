/**
 * Diagnostic test: verify Object.entries behavior with Emscripten reference wrappers
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { App } from '../src/app';
import { Transform } from '../src/component';
import { UIRect } from '../src/ui/core/ui-rect';
import type { UIRectData } from '../src/ui/core/ui-rect';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { loadWasmModule } from './helpers/loadWasm';

const WASM_PATH = resolve(__dirname, '../../desktop/public/wasm/esengine.wasm');
const HAS_WASM = existsSync(WASM_PATH);

describe.skipIf(!HAS_WASM)('Emscripten wrapper diagnostics', () => {
    let module: ESEngineModule;

    beforeAll(async () => {
        module = await loadWasmModule();
    });

    it('Object.entries on Emscripten getUIRect reference wrapper', () => {
        const registry = new module.Registry() as unknown as CppRegistry;
        const entity = registry.create();

        // Add UIRect with specific values
        registry.addUIRect(entity, {
            anchorMin: { x: 0, y: 0 },
            anchorMax: { x: 0.5, y: 1 },
            offsetMin: { x: 0, y: 0 },
            offsetMax: { x: 0, y: 0 },
            size: { x: 50, y: 50 },
            pivot: { x: 0.5, y: 0.5 },
        } as any);

        // Get the reference wrapper
        const ref = registry.getUIRect(entity);

        // Check values via getter
        console.log('=== Direct property access ===');
        console.log('ref.anchorMin:', JSON.stringify(ref.anchorMin));
        console.log('ref.anchorMax:', JSON.stringify(ref.anchorMax));
        console.log('ref.size:', JSON.stringify(ref.size));

        // Check Object.entries
        const entries = Object.entries(ref as any);
        console.log('\n=== Object.entries ===');
        console.log('entries length:', entries.length);
        console.log('entries:', JSON.stringify(entries));

        // Check Object.keys
        const keys = Object.keys(ref as any);
        console.log('\n=== Object.keys ===');
        console.log('keys:', JSON.stringify(keys));

        // Check own property names
        const ownProps = Object.getOwnPropertyNames(ref as any);
        console.log('\n=== Object.getOwnPropertyNames ===');
        console.log('ownProps:', JSON.stringify(ownProps));

        // Check own property descriptors
        const descs = Object.getOwnPropertyDescriptors(ref as any);
        console.log('\n=== Own property descriptors ===');
        for (const [k, d] of Object.entries(descs)) {
            console.log(`  ${k}: value=${d.value}, get=${typeof d.get}, set=${typeof d.set}, enum=${d.enumerable}`);
        }

        // Check prototype properties
        const proto = Object.getPrototypeOf(ref);
        if (proto) {
            const protoDescs = Object.getOwnPropertyDescriptors(proto);
            console.log('\n=== Prototype property descriptors ===');
            for (const [k, d] of Object.entries(protoDescs)) {
                console.log(`  ${k}: value=${typeof d.value}, get=${typeof d.get}, set=${typeof d.set}, enum=${d.enumerable}`);
            }
        }

        expect(ref.anchorMax.x).toBeCloseTo(0.5, 5);
        expect(ref.anchorMax.y).toBeCloseTo(1, 5);

        registry.destroy(entity);
        (registry as any).delete();
    });

    it('world.insert with Emscripten wrapper preserves values', () => {
        const app = App.new();
        const registry = new module.Registry() as unknown as CppRegistry;
        app.connectCpp(registry, module);

        const world = app.world;
        const entity = world.spawn();

        // Insert UIRect with specific stretch anchors
        world.insert(entity, UIRect, {
            anchorMin: { x: 0, y: 0 },
            anchorMax: { x: 1, y: 1 },
            offsetMin: { x: 0, y: 0 },
            offsetMax: { x: 0, y: 0 },
            size: { x: 0, y: 0 },
            pivot: { x: 0.5, y: 0.5 },
        });

        // Get the reference wrapper
        const ref = world.get(entity, UIRect) as UIRectData;

        console.log('\n=== Before modification ===');
        console.log('anchorMax:', JSON.stringify(ref.anchorMax));

        // Modify via wrapper (like applyDirectionalFill does)
        ref.anchorMin = { x: 0, y: 0 };
        ref.anchorMax = { x: 0.5, y: 1 };
        ref.offsetMin = { x: 0, y: 0 };
        ref.offsetMax = { x: 0, y: 0 };

        console.log('After setter, anchorMax:', JSON.stringify(ref.anchorMax));

        // Re-insert (like applyDirectionalFill does)
        world.insert(entity, UIRect, ref);

        // Read back
        const after = world.get(entity, UIRect) as UIRectData;
        console.log('\n=== After world.insert ===');
        console.log('anchorMax:', JSON.stringify(after.anchorMax));
        console.log('size:', JSON.stringify(after.size));
        console.log('pivot:', JSON.stringify(after.pivot));

        // THIS IS THE KEY CHECK
        expect(after.anchorMax.x).toBeCloseTo(0.5, 5);
        expect(after.anchorMax.y).toBeCloseTo(1, 5);
        expect(after.anchorMin.x).toBeCloseTo(0, 5);
        expect(after.anchorMin.y).toBeCloseTo(0, 5);

        world.despawn(entity);
        world.disconnectCpp();
        (registry as any).delete();
    });

    it('nested field modification on Emscripten wrapper', () => {
        const registry = new module.Registry() as unknown as CppRegistry;
        const entity = registry.create();

        registry.addUIRect(entity, {
            anchorMin: { x: 0, y: 0 },
            anchorMax: { x: 1, y: 1 },
            offsetMin: { x: 0, y: 0 },
            offsetMax: { x: 0, y: 0 },
            size: { x: 200, y: 200 },
            pivot: { x: 0.5, y: 0.5 },
        } as any);

        const ref = registry.getUIRect(entity);

        // Try nested modification (the problematic pattern from syncHandleRect)
        console.log('\n=== Nested field modification ===');
        console.log('Before: anchorMin.x =', ref.anchorMin.x);

        // This modifies a COPY, not C++ memory
        ref.anchorMin.x = 0.7;
        console.log('After ref.anchorMin.x = 0.7, actual value =', ref.anchorMin.x);

        // This SHOULD write to C++ memory
        ref.anchorMin = { x: 0.7, y: 0.3 };
        console.log('After ref.anchorMin = {0.7, 0.3}, actual value =', ref.anchorMin.x, ref.anchorMin.y);

        expect(ref.anchorMin.x).toBeCloseTo(0.7, 5);
        expect(ref.anchorMin.y).toBeCloseTo(0.3, 5);

        registry.destroy(entity);
        (registry as any).delete();
    });
});
