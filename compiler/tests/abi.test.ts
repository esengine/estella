// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    abi.test.ts
 * @brief   Is the ABI SUFFICIENT? (docs/REARCH_AOT_ABI.md)
 *
 * @details The same interpreter runs the same system twice: once over JS objects
 *          and once over flat memory reached only through what SysCtx carries.
 *          Both must match node.
 *
 *          That is the question this file exists to answer. A system that runs
 *          in the first and not the second names something the contract is
 *          missing — which is the only legitimate reason to add a field to it.
 */
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lowerProgram } from '../src/frontend';
import { verifySystem } from '../src/verify';
import { runSystem, type EirWorld, type Row } from '../src/interp';
import { builtinShapes } from '../src/builtins';
import { AbiMemory, packLayout, runOnAbi } from '../src/abi';

import { moveSystem } from '../../examples/ecs-basics/src/systems/move';
import { lifetimeSystem } from '../../examples/ecs-basics/src/systems/lifetime';
import type { StubSystem } from './stubs/esengine';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FILES = [
    resolve(ROOT, 'examples/ecs-basics/src/systems/move.ts'),
    resolve(ROOT, 'examples/ecs-basics/src/systems/lifetime.ts'),
    resolve(ROOT, 'examples/ecs-basics/src/components.ts'),
];

const { module } = lowerProgram(FILES, builtinShapes());
const layout = packLayout(module.comps);
const N = 24;

/** The same starting world, in each of the two shapes. */
function seed(i: number): { tx: number; ty: number; dx: number; dy: number; speed: number; life: number } {
    return {
        tx: (i % 7) * 13 - 40, ty: (i % 5) * 9 - 20,
        dx: ((i % 3) - 1), dy: ((i % 4) - 2) / 2,
        speed: 40 + (i % 6) * 15, life: 0.05 * i,
    };
}

/**
 * Rounds every store the way that shape's storage does — f32 for an engine pool,
 * f64 for a ScriptStorage record. Asking the SHAPE, not the name: a JS-object
 * world that rounded everything the same way would drift from the ABI image and
 * flip `remaining <= 0` a frame early.
 */
function rowOf(comp: string, fields: Record<string, unknown>): Row {
    return module.comps.get(comp)!.storage === 'engine' ? f32Row(fields) : (fields as Row);
}

function f32Row(fields: Record<string, unknown>): Row {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
        if (v !== null && typeof v === 'object') { out[k] = f32Row(v as Record<string, unknown>); continue; }
        let held = Math.fround(v as number);
        Object.defineProperty(out, k, {
            enumerable: true,
            get: () => held,
            set: (n: number) => { held = Math.fround(n); },
        });
    }
    return out;
}

function jsWorld(): EirWorld {
    const transforms = new Map<number, Row>();
    const movers = new Map<number, Row>();
    const lifetimes = new Map<number, Row>();
    const sprites = new Map<number, Row>();
    const entities: number[] = [];
    for (let i = 1; i <= N; i++) {
        const s = seed(i);
        entities.push(i);
        transforms.set(i, rowOf('Transform', {
            position: { x: s.tx, y: s.ty, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 },
            worldPosition: { x: 0, y: 0, z: 0 },
            worldRotation: { x: 0, y: 0, z: 0, w: 1 }, worldScale: { x: 1, y: 1, z: 1 },
        }));
        movers.set(i, rowOf('Mover', { speed: s.speed, directionX: s.dx, directionY: s.dy }));
        lifetimes.set(i, rowOf('Lifetime', { remaining: s.life }));
        sprites.set(i, rowOf('Sprite', { color: { r: 1, g: 1, b: 1, a: 1 }, size: { x: 8, y: 8 } }));
    }
    return {
        entities,
        comps: new Map([['Transform', transforms], ['Mover', movers],
            ['Lifetime', lifetimes], ['Sprite', sprites]]),
        resources: new Map<string, Row>([['Time', { delta: 1 / 30 }]]),
    };
}

function abiWorld(): AbiMemory {
    const mem = new AbiMemory(layout);
    mem.addResource('Time', { delta: 1 / 30 });
    for (let i = 1; i <= N; i++) {
        const s = seed(i);
        mem.addComponent('Transform', i, { 'position.x': s.tx, 'position.y': s.ty });
        mem.addComponent('Mover', i, { speed: s.speed, directionX: s.dx, directionY: s.dy });
        mem.addComponent('Lifetime', i, { remaining: s.life });
        mem.addComponent('Sprite', i, { 'color.a': 1 });
    }
    return mem;
}

describe('the ABI is sufficient for the systems the subset compiles', () => {
    const move = module.systems.find((s) => s.name === 'MoveSystem')!;
    const life = module.systems.find((s) => s.name === 'LifetimeSystem')!;

    it('lowered both, and both verify', () => {
        expect(move).toBeDefined();
        expect(life).toBeDefined();
        expect(verifySystem(move, module.comps, module.fns)).toEqual([]);
        expect(verifySystem(life, module.comps, module.fns)).toEqual([]);
    });

    it('MoveSystem: flat memory agrees with JS objects, and both with node', () => {
        const byNode = jsWorld();
        const byJs = jsWorld();
        const mem = abiWorld();

        const sys = moveSystem as unknown as StubSystem;
        for (let f = 0; f < 30; f++) {
            const tf = byNode.comps.get('Transform')!;
            const mv = byNode.comps.get('Mover')!;
            (sys.fn as unknown as (q: unknown, t: unknown) => void)({
                *[Symbol.iterator]() {
                    for (const e of byNode.entities) yield [e, tf.get(e)!, mv.get(e)!];
                },
            }, byNode.resources.get('Time'));
            runSystem(move, byJs, module.fns);
            runOnAbi(move, mem, layout, module.fns);
        }

        for (let i = 1; i <= N; i++) {
            const want = (byNode.comps.get('Transform')!.get(i)!['position'] as Record<string, number>);
            const js = (byJs.comps.get('Transform')!.get(i)!['position'] as Record<string, number>);
            // Both sides round through f32 on every store, so this is exact.
            expect(js['x'], `js entity ${i}`).toBe(want['x']);
            expect(mem.read('Transform', i, 'position.x'), `abi entity ${i}`).toBe(want['x']);
            expect(mem.read('Transform', i, 'position.y'), `abi entity ${i}`).toBe(want['y']);
        }
    });

    it('LifetimeSystem: despawn through the command buffer removes the same entities', () => {
        const byJs = jsWorld();
        const mem = abiWorld();
        for (let f = 0; f < 30; f++) {
            runSystem(life, byJs, module.fns);
            runOnAbi(life, mem, layout, module.fns);
            expect(mem.entities, `frame ${f}`).toEqual(byJs.entities);
        }
        expect(byJs.entities.length).toBeLessThan(N);
        expect(byJs.entities.length).toBeGreaterThan(0);
    });

    // "Zero calls into the engine" is not asserted here: it is a property of the
    // shipped artifact (an empty wasm import section) that the build checks,
    // per docs/REARCH_AOT_ABI.md §6.5.
});
