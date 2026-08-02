// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, bench, beforeAll } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { Transform, Sprite } from '../src/ecs/component';
import { UINode } from '../src/ui/core/ui-node';
import { convertForWasm } from '../src/ecs/bridge/BuiltinBridge';
import { WASM_DIR as WASM_DIR_SHARED } from '../tests/helpers/loadWasm';

let module: any;
let Registry: any;

// Same resolution the integration tests use: $ESENGINE_WASM_DIR, then the
// in-repo build output, then the editor's copy. Hard-coding the last of
// those is why these never found a wasm in CI.
const WASM_DIR = WASM_DIR_SHARED;

// Build the embind value_object payloads from the authoritative component
// defaults (the same source BuiltinBridge inserts from), so these stay valid as
// the C++ structs gain fields instead of drifting into "missing field" errors.
const wasmData = (def: { _default: unknown; colorKeys: readonly string[] }) =>
    convertForWasm({ ...(def._default as Record<string, unknown>) }, def.colorKeys);

beforeAll(async () => {
    const jsPath = path.join(WASM_DIR, 'esengine.js');
    const mod = await import(jsPath);
    const factory = mod.default;
    module = await factory({
        locateFile(p: string) {
            return path.join(WASM_DIR, p);
        },
    });
    Registry = module.Registry;
});

const TRANSFORM_DATA = wasmData(Transform);
const SPRITE_DATA = wasmData(Sprite);
const UINODE_DATA = wasmData(UINode);

describe('WASM boundary - Entity lifecycle', () => {
    bench('create + destroy (single)', () => {
        const reg = new Registry();
        const e = reg.create();
        reg.destroy(e);
        reg.delete();
    });

    bench('create 100 entities', () => {
        const reg = new Registry();
        for (let i = 0; i < 100; i++) reg.create();
        reg.delete();
    });

    bench('valid() check x1000', () => {
        const reg = new Registry();
        const entities: number[] = [];
        for (let i = 0; i < 100; i++) entities.push(reg.create());
        for (let i = 0; i < 1000; i++) reg.valid(entities[i % 100]);
        reg.delete();
    });

    bench('destroy 100 entities', () => {
        const reg = new Registry();
        const entities: number[] = [];
        for (let i = 0; i < 100; i++) entities.push(reg.create());
        for (let i = 0; i < 100; i++) reg.destroy(entities[i]);
        reg.delete();
    });
});

describe('WASM boundary - Transform CRUD', () => {
    bench('addTransform', () => {
        const reg = new Registry();
        const e = reg.create();
        reg.addTransform(e, TRANSFORM_DATA);
        reg.delete();
    });

    bench('hasTransform', () => {
        const reg = new Registry();
        const e = reg.create();
        reg.addTransform(e, TRANSFORM_DATA);
        for (let i = 0; i < 100; i++) reg.hasTransform(e);
        reg.delete();
    });

    bench('getTransform', () => {
        const reg = new Registry();
        const e = reg.create();
        reg.addTransform(e, TRANSFORM_DATA);
        for (let i = 0; i < 100; i++) reg.getTransform(e);
        reg.delete();
    });

    bench('addTransform + removeTransform', () => {
        const reg = new Registry();
        const e = reg.create();
        reg.addTransform(e, TRANSFORM_DATA);
        reg.removeTransform(e);
        reg.delete();
    });
});

describe('WASM boundary - Sprite CRUD', () => {
    bench('addSprite', () => {
        const reg = new Registry();
        const e = reg.create();
        reg.addSprite(e, SPRITE_DATA);
        reg.delete();
    });

    bench('getSprite x100', () => {
        const reg = new Registry();
        const e = reg.create();
        reg.addSprite(e, SPRITE_DATA);
        for (let i = 0; i < 100; i++) reg.getSprite(e);
        reg.delete();
    });

    bench('hasSprite x100', () => {
        const reg = new Registry();
        const e = reg.create();
        reg.addSprite(e, SPRITE_DATA);
        for (let i = 0; i < 100; i++) reg.hasSprite(e);
        reg.delete();
    });
});

describe('WASM boundary - UINode CRUD', () => {
    bench('addUINode', () => {
        const reg = new Registry();
        const e = reg.create();
        reg.addUINode(e, UINODE_DATA);
        reg.delete();
    });

    bench('getUINode x100', () => {
        const reg = new Registry();
        const e = reg.create();
        reg.addUINode(e, UINODE_DATA);
        for (let i = 0; i < 100; i++) reg.getUINode(e);
        reg.delete();
    });
});

describe('WASM boundary - Multi-component entity', () => {
    bench('create entity + 3 components', () => {
        const reg = new Registry();
        const e = reg.create();
        reg.addTransform(e, TRANSFORM_DATA);
        reg.addSprite(e, SPRITE_DATA);
        reg.addUINode(e, UINODE_DATA);
        reg.delete();
    });

    bench('get 3 components x100 iterations', () => {
        const reg = new Registry();
        const e = reg.create();
        reg.addTransform(e, TRANSFORM_DATA);
        reg.addSprite(e, SPRITE_DATA);
        reg.addUINode(e, UINODE_DATA);
        for (let i = 0; i < 100; i++) {
            reg.getTransform(e);
            reg.getSprite(e);
            reg.getUINode(e);
        }
        reg.delete();
    });

    bench('has 3 components x100 iterations', () => {
        const reg = new Registry();
        const e = reg.create();
        reg.addTransform(e, TRANSFORM_DATA);
        reg.addSprite(e, SPRITE_DATA);
        reg.addUINode(e, UINODE_DATA);
        for (let i = 0; i < 100; i++) {
            reg.hasTransform(e);
            reg.hasSprite(e);
            reg.hasUINode(e);
        }
        reg.delete();
    });
});

describe('WASM boundary - Hierarchy', () => {
    bench('setParent x100', () => {
        const reg = new Registry();
        const root = reg.create();
        reg.addTransform(root, TRANSFORM_DATA);
        const children: number[] = [];
        for (let i = 0; i < 100; i++) {
            const c = reg.create();
            reg.addTransform(c, TRANSFORM_DATA);
            children.push(c);
        }
        for (let i = 0; i < 100; i++) reg.setParent(children[i], root);
        reg.delete();
    });
});

describe('WASM boundary - Batch scenario (typical frame)', () => {
    bench('spawn 10 entities with Transform+Sprite', () => {
        const reg = new Registry();
        for (let i = 0; i < 10; i++) {
            const e = reg.create();
            reg.addTransform(e, TRANSFORM_DATA);
            reg.addSprite(e, SPRITE_DATA);
        }
        reg.delete();
    });

    bench('read Transform+Sprite for 100 entities', () => {
        const reg = new Registry();
        const entities: number[] = [];
        for (let i = 0; i < 100; i++) {
            const e = reg.create();
            reg.addTransform(e, TRANSFORM_DATA);
            reg.addSprite(e, SPRITE_DATA);
            entities.push(e);
        }
        for (const e of entities) {
            reg.getTransform(e);
            reg.getSprite(e);
        }
        reg.delete();
    });

    bench('has check for 100 entities x3 components', () => {
        const reg = new Registry();
        const entities: number[] = [];
        for (let i = 0; i < 100; i++) {
            const e = reg.create();
            reg.addTransform(e, TRANSFORM_DATA);
            if (i % 2 === 0) reg.addSprite(e, SPRITE_DATA);
            if (i % 3 === 0) reg.addUINode(e, UINODE_DATA);
            entities.push(e);
        }
        for (const e of entities) {
            reg.hasTransform(e);
            reg.hasSprite(e);
            reg.hasUINode(e);
        }
        reg.delete();
    });
});

describe('WASM boundary - Call overhead isolation', () => {
    bench('noop baseline (JS object create)', () => {
        const obj = { x: 1, y: 2, z: 3 };
        void obj;
    });

    bench('single WASM call: create()', () => {
        const reg = new Registry();
        reg.create();
        reg.delete();
    });

    bench('single WASM call: valid()', () => {
        const reg = new Registry();
        const e = reg.create();
        reg.valid(e);
        reg.delete();
    });

    bench('single WASM call: hasTransform()', () => {
        const reg = new Registry();
        const e = reg.create();
        reg.hasTransform(e);
        reg.delete();
    });

    bench('single WASM call: entityCount()', () => {
        const reg = new Registry();
        reg.entityCount();
        reg.delete();
    });
});
