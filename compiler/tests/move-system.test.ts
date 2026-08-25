// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    move-system.test.ts
 * @brief   Stage 1's exit criterion, end to end (docs/REARCH_AOT.md §10).
 *
 * @details Takes a real system out of examples/, lowers it to EIR, and holds
 *          the interpreter's result against node's.
 *
 *          Both sides read the SAME FILE — the oracle is move.ts imported through a
 *          stubbed `esengine`, not a copy re-typed here. A copy would agree with
 *          whatever the copy got wrong.
 */
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lowerProgram } from '../src/frontend';
import { verifySystem } from '../src/verify';
import { runSystem, type EirWorld, type Row } from '../src/interp';
import { builtinShapes } from '../src/builtins';
import { printSystem } from '../src/eir';

import { moveSystem } from '../../examples/ecs-basics/src/systems/move';
import type { StubSystem } from './stubs/esengine';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FILES = [
    resolve(ROOT, 'examples/ecs-basics/src/systems/move.ts'),
    resolve(ROOT, 'examples/ecs-basics/src/components.ts'),
];

const ENTITIES = 64;

/** Two identical worlds from one seed, so a difference can only be the system. */
function makeWorld(): EirWorld {
    let a = 0x2f6e2b1 >>> 0;
    const rand = (): number => {
        a = (a * 1664525 + 1013904223) >>> 0;
        return (a >>> 8) / 16777216;
    };
    const transforms = new Map<number, Row>();
    const movers = new Map<number, Row>();
    const entities: number[] = [];
    for (let e = 1; e <= ENTITIES; e++) {
        entities.push(e);
        transforms.set(e, {
            position: { x: (rand() - 0.5) * 200, y: (rand() - 0.5) * 200, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
            worldPosition: { x: 0, y: 0, z: 0 },
            worldRotation: { x: 0, y: 0, z: 0, w: 1 },
            worldScale: { x: 1, y: 1, z: 1 },
        });
        // Every third entity has no Mover, so "the query matched the right rows"
        // is part of what the comparison proves.
        if (e % 3 !== 0) {
            movers.set(e, { speed: 20 + rand() * 80, directionX: rand() * 2 - 1, directionY: rand() * 2 - 1 });
        }
    }
    return {
        entities,
        comps: new Map([['Transform', transforms], ['Mover', movers]]),
        resources: new Map<string, Row>([['Time', { delta: 1 / 60, elapsed: 0 }]]),
    };
}

/** Run the real callback, handing it live rows the way a Mut query does. */
function runNative(world: EirWorld): void {
    const sys = moveSystem as unknown as StubSystem;
    const transforms = world.comps.get('Transform')!;
    const movers = world.comps.get('Mover')!;
    const query = {
        *[Symbol.iterator]() {
            for (const e of world.entities) {
                if (transforms.has(e) && movers.has(e)) yield [e, transforms.get(e)!, movers.get(e)!];
            }
        },
    };
    (sys.fn as unknown as (q: unknown, t: unknown) => void)(query, world.resources.get('Time'));
}

describe('Stage 1 — a real example system, end to end', () => {
    const { module, diagnostics, seen } = lowerProgram(FILES, builtinShapes());
    const moveEir = module.systems.find((s) => s.name === 'MoveSystem');

    it('lowers MoveSystem out of examples/ecs-basics', () => {
        expect(seen).toContain('MoveSystem');
        expect(diagnostics.filter((d) => d.system === 'MoveSystem')).toEqual([]);
        expect(moveEir).toBeDefined();
    });

    it('reads back as the loop it came from', () => {
        expect(printSystem(moveEir!)).toMatchInlineSnapshot(`
          "system MoveSystem(query: query<mut Transform, Mover>, time: res<Time>) {
            rowLoop query -> (_entity, transform, mover) {
              transform.position.x = (transform.position.x + ((mover.directionX * mover.speed) * time.delta))
              transform.position.y = (transform.position.y + ((mover.directionY * mover.speed) * time.delta))
            }
          }"
        `);
    });

    it('re-proves its own types without looking at the TypeScript', () => {
        expect(verifySystem(moveEir!, module.comps)).toEqual([]);
    });

    it('picks up Mover from defineComponent as a compile-time declaration', () => {
        expect([...module.comps.get('Mover')!.fields.keys()]).toEqual(['speed', 'directionX', 'directionY']);
    });

    it('moves the world exactly the way node does', () => {
        const byNode = makeWorld();
        const byEir = makeWorld();
        expect(byEir).toEqual(byNode);

        for (let frame = 0; frame < 30; frame++) {
            runNative(byNode);
            runSystem(moveEir!, byEir);
        }

        // Bit-for-bit: both sides are f64 doing the same operations in the same
        // order, so "close enough" would hide a real divergence.
        expect(byEir.comps.get('Transform')).toEqual(byNode.comps.get('Transform'));
        expect(byEir.comps.get('Mover')).toEqual(byNode.comps.get('Mover'));
    });

    it('did something — a system that no-ops would also agree', () => {
        const before = makeWorld();
        const after = makeWorld();
        for (let frame = 0; frame < 30; frame++) runSystem(moveEir!, after);
        expect(after.comps.get('Transform')).not.toEqual(before.comps.get('Transform'));
        // The entities without a Mover must NOT have moved.
        for (const e of after.entities) {
            if (e % 3 === 0) {
                expect(after.comps.get('Transform')!.get(e)).toEqual(before.comps.get('Transform')!.get(e));
            }
        }
    });
});
