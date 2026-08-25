// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    commands.test.ts
 * @brief   A per-frame system that despawns, run both ways.
 *
 * @details The oracle is examples/ecs-basics/src/systems/lifetime.ts — a real
 *          per-frame Commands user, which is the shape AOT is for. Most of the
 *          corpus's Commands uses are in startup systems, where compiling buys
 *          nothing; this one runs every frame and removes entities.
 *
 *          The stub queues and flushes at system end because the SDK's runner
 *          does (flushSystem_). A despawn taking effect mid-row would change
 *          what the row loop walks, and the two sides would part company there.
 */
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lowerProgram } from '../src/frontend';
import { verifySystem } from '../src/verify';
import { runSystem, type EirWorld, type Row } from '../src/interp';
import { builtinShapes } from '../src/builtins';
import { printSystem } from '../src/eir';

import { lifetimeSystem } from '../../examples/ecs-basics/src/systems/lifetime';
import type { StubSystem } from './stubs/esengine';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FILES = [
    resolve(ROOT, 'examples/ecs-basics/src/systems/lifetime.ts'),
    resolve(ROOT, 'examples/ecs-basics/src/components.ts'),
];

const { module, diagnostics } = lowerProgram(FILES, builtinShapes());
const eir = module.systems.find((s) => s.name === 'LifetimeSystem');

function makeWorld(): EirWorld {
    const lifetimes = new Map<number, Row>();
    const sprites = new Map<number, Row>();
    const entities: number[] = [];
    for (let e = 1; e <= 24; e++) {
        entities.push(e);
        // Staggered so some expire on every frame rather than all at once.
        lifetimes.set(e, { remaining: e * 0.05 });
        sprites.set(e, { color: { r: 1, g: 1, b: 1, a: 1 }, size: { x: 8, y: 8 } });
    }
    return {
        entities,
        comps: new Map([['Lifetime', lifetimes], ['Sprite', sprites]]),
        resources: new Map<string, Row>([['Time', { delta: 1 / 30 }]]),
    };
}

function runNative(world: EirWorld): void {
    const sys = lifetimeSystem as unknown as StubSystem;
    const lifetimes = world.comps.get('Lifetime')!;
    const sprites = world.comps.get('Sprite')!;
    const queued: number[] = [];
    const cmds = { despawn: (e: number) => { queued.push(e); } };
    const query = {
        *[Symbol.iterator]() {
            for (const e of world.entities) {
                if (lifetimes.has(e) && sprites.has(e)) yield [e, lifetimes.get(e)!, sprites.get(e)!];
            }
        },
    };
    (sys.fn as unknown as (q: unknown, t: unknown, c: unknown) => void)(
        query, world.resources.get('Time'), cmds);
    for (const e of queued) {
        const at = world.entities.indexOf(e);
        if (at >= 0) world.entities.splice(at, 1);
        for (const rows of world.comps.values()) rows.delete(e);
    }
}

describe('commands — a per-frame despawn', () => {
    it('compiles and verifies', () => {
        expect(diagnostics.filter((d) => d.system === 'LifetimeSystem').map((d) => d.message)).toEqual([]);
        expect(eir).toBeDefined();
        expect(verifySystem(eir!, module.comps, module.fns)).toEqual([]);
    });

    it('keeps the despawn as an emit on the channel', () => {
        expect(printSystem(eir!)).toContain('emit cmds.despawn(entity)');
        expect(printSystem(eir!)).toContain('cmds: channel<Commands>');
    });

    it('agrees with node, entity for entity, over 40 frames', () => {
        const byNode = makeWorld();
        const byEir = makeWorld();
        for (let f = 0; f < 40; f++) {
            runNative(byNode);
            runSystem(eir!, byEir);
            expect(byEir.entities, `frame ${f}`).toEqual(byNode.entities);
        }
        expect(byEir.comps.get('Lifetime')).toEqual(byNode.comps.get('Lifetime'));
        expect(byEir.comps.get('Sprite')).toEqual(byNode.comps.get('Sprite'));
    });

    it('actually despawned, and not everything at once', () => {
        const world = makeWorld();
        const counts: number[] = [];
        for (let f = 0; f < 40; f++) {
            runSystem(eir!, world);
            counts.push(world.entities.length);
        }
        expect(counts[counts.length - 1]).toBe(0);
        // A count that only ever falls, over more than a few distinct values:
        // an all-at-once wipe would agree with node just as well.
        for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeLessThanOrEqual(counts[i - 1]!);
        expect(new Set(counts).size).toBeGreaterThan(3);
    });
});
