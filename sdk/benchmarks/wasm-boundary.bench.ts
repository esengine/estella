import { describe, bench, beforeAll } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';

let module: any;
let Registry: any;

const WASM_DIR = path.resolve(__dirname, '../../desktop/public/wasm');

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

const TRANSFORM_DATA = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
    worldPosition: { x: 0, y: 0, z: 0 },
    worldRotation: { x: 0, y: 0, z: 0, w: 1 },
    worldScale: { x: 1, y: 1, z: 1 },
};

const SPRITE_DATA = {
    texture: 0,
    color: { x: 1, y: 1, z: 1, w: 1 },
    size: { x: 100, y: 100 },
    uvOffset: { x: 0, y: 0 },
    uvScale: { x: 1, y: 1 },
    layer: 0,
    flipX: false,
    flipY: false,
    material: 0,
    enabled: true,
};

const UIRECT_DATA = {
    anchorMin: { x: 0, y: 0 },
    anchorMax: { x: 1, y: 1 },
    offsetMin: { x: 0, y: 0 },
    offsetMax: { x: 0, y: 0 },
    size: { x: 100, y: 100 },
    pivot: { x: 0.5, y: 0.5 },
};

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

describe('WASM boundary - UIRect CRUD', () => {
    bench('addUIRect', () => {
        const reg = new Registry();
        const e = reg.create();
        reg.addUIRect(e, UIRECT_DATA);
        reg.delete();
    });

    bench('getUIRect x100', () => {
        const reg = new Registry();
        const e = reg.create();
        reg.addUIRect(e, UIRECT_DATA);
        for (let i = 0; i < 100; i++) reg.getUIRect(e);
        reg.delete();
    });
});

describe('WASM boundary - Multi-component entity', () => {
    bench('create entity + 3 components', () => {
        const reg = new Registry();
        const e = reg.create();
        reg.addTransform(e, TRANSFORM_DATA);
        reg.addSprite(e, SPRITE_DATA);
        reg.addUIRect(e, UIRECT_DATA);
        reg.delete();
    });

    bench('get 3 components x100 iterations', () => {
        const reg = new Registry();
        const e = reg.create();
        reg.addTransform(e, TRANSFORM_DATA);
        reg.addSprite(e, SPRITE_DATA);
        reg.addUIRect(e, UIRECT_DATA);
        for (let i = 0; i < 100; i++) {
            reg.getTransform(e);
            reg.getSprite(e);
            reg.getUIRect(e);
        }
        reg.delete();
    });

    bench('has 3 components x100 iterations', () => {
        const reg = new Registry();
        const e = reg.create();
        reg.addTransform(e, TRANSFORM_DATA);
        reg.addSprite(e, SPRITE_DATA);
        reg.addUIRect(e, UIRECT_DATA);
        for (let i = 0; i < 100; i++) {
            reg.hasTransform(e);
            reg.hasSprite(e);
            reg.hasUIRect(e);
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
            if (i % 3 === 0) reg.addUIRect(e, UIRECT_DATA);
            entities.push(e);
        }
        for (const e of entities) {
            reg.hasTransform(e);
            reg.hasSprite(e);
            reg.hasUIRect(e);
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
