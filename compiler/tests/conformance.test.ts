// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    conformance.test.ts
 * @brief   Every subset feature run BOTH ways and compared (§8.2).
 *
 * @details move-system.test.ts covers the one shape a shipped system happens to
 *          use. This covers what the subset gained after it — locals, if /
 *          else-if / else, comparisons, `&&`, `!` — because a feature the
 *          frontend lowers but nobody runs both ways is unchecked.
 *
 *          The oracle is the fixture itself, imported through the stubbed
 *          `esengine` and called with live rows, exactly as move-system does.
 */
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lowerProgram } from '../src/frontend';
import { verifySystem } from '../src/verify';
import { runSystem, type EirWorld, type Row } from '../src/interp';
import { builtinShapes } from '../src/builtins';
import { printSystem } from '../src/eir';

import { driftSystem, clampSystem } from './fixtures/in-subset';
import type { StubSystem } from './stubs/esengine';

const FIXTURE = resolve(fileURLToPath(new URL('./fixtures/in-subset.ts', import.meta.url)));
const ENTITIES = 48;

function makeWorld(): EirWorld {
    let a = 0x51ed270b >>> 0;
    const rand = (): number => {
        a = (a * 1664525 + 1013904223) >>> 0;
        return (a >>> 8) / 16777216;
    };
    const transforms = new Map<number, Row>();
    const drifts = new Map<number, Row>();
    const entities: number[] = [];
    for (let e = 1; e <= ENTITIES; e++) {
        entities.push(e);
        transforms.set(e, {
            position: { x: (rand() - 0.5) * 260, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
            worldPosition: { x: 0, y: 0, z: 0 },
            worldRotation: { x: 0, y: 0, z: 0, w: 1 },
            worldScale: { x: 1, y: 1, z: 1 },
        });
        // Spread rate across the `> 50` boundary and vary `enabled`, so every
        // branch of the fixture is taken by some entity in every frame.
        drifts.set(e, { rate: rand() * 120, wrap: 100, enabled: e % 4 !== 0 });
    }
    return {
        entities,
        comps: new Map([['Transform', transforms], ['FixtureDrift', drifts]]),
        resources: new Map<string, Row>([['Time', { delta: 1 / 30, elapsed: 0 }]]),
    };
}

function runNative(world: EirWorld): void {
    const sys = driftSystem as unknown as StubSystem;
    const transforms = world.comps.get('Transform')!;
    const drifts = world.comps.get('FixtureDrift')!;
    const query = {
        *[Symbol.iterator]() {
            for (const e of world.entities) {
                if (transforms.has(e) && drifts.has(e)) yield [e, transforms.get(e)!, drifts.get(e)!];
            }
        },
    };
    (sys.fn as unknown as (q: unknown, t: unknown) => void)(query, world.resources.get('Time'));
}

const { module, diagnostics } = lowerProgram([FIXTURE], builtinShapes());
const drift = module.systems.find((s) => s.name === 'FixtureDrift');
const clamp = module.systems.find((s) => s.name === 'FixtureClampSys');

describe('conformance — locals, branches, logic', () => {
    it('compiles', () => {
        expect(diagnostics.filter((d) => d.system === 'FixtureDrift')).toEqual([]);
        expect(drift).toBeDefined();
        expect(verifySystem(drift!, module.comps)).toEqual([]);
    });

    it('reads back with its locals and branches intact', () => {
        expect(printSystem(drift!)).toMatchInlineSnapshot(`
          "system FixtureDrift(query: query<mut Transform, FixtureDrift>, time: res<Time>) {
            rowLoop query -> (_entity, transform, drift) {
              let step = (drift.rate * time.delta)
              let nx = (transform.position.x + step)
              let fast = (drift.rate > 50)
              if (nx > drift.wrap) {
                transform.position.x = (nx - (drift.wrap * 2))
              } else {
                if ((nx < -drift.wrap) && drift.enabled) {
                  transform.position.x = (nx + (drift.wrap * 2))
                } else {
                  transform.position.x = nx
                }
              }
              if (!fast && drift.enabled) {
                transform.position.y = (transform.position.y + (step * 0.5))
              }
            }
          }"
        `);
    });

    it('agrees with node over 40 frames', () => {
        const byNode = makeWorld();
        const byEir = makeWorld();
        for (let f = 0; f < 40; f++) {
            runNative(byNode);
            runSystem(drift!, byEir);
        }
        expect(byEir.comps.get('Transform')).toEqual(byNode.comps.get('Transform'));
    });

    it('took every branch — an agreement over dead code proves nothing', () => {
        const world = makeWorld();
        const wrapped = new Set<number>();
        const yMoved = new Set<number>();
        for (let f = 0; f < 40; f++) {
            const before = new Map([...world.comps.get('Transform')!].map(
                ([e, r]) => [e, { ...(r['position'] as Record<string, number>) }]));
            runSystem(drift!, world);
            for (const [e, row] of world.comps.get('Transform')!) {
                const p = row['position'] as Record<string, number>;
                const b = before.get(e)!;
                if (Math.abs(p['x']! - b['x']!) > 100) wrapped.add(e);
                if (p['y'] !== b['y']) yMoved.add(e);
            }
        }
        expect(wrapped.size, 'no entity ever hit the wrap branch').toBeGreaterThan(0);
        expect(yMoved.size, 'the !fast && enabled branch never ran').toBeGreaterThan(0);
        // And some entity must have been excluded by `enabled`.
        expect(yMoved.size).toBeLessThan(ENTITIES);
    });
});

describe('conformance — ternaries and exact Math', () => {
    function clampWorld(): EirWorld {
        let a = 0x9e3779b1 >>> 0;
        const rand = (): number => {
            a = (a * 1664525 + 1013904223) >>> 0;
            return (a >>> 8) / 16777216;
        };
        const transforms = new Map<number, Row>();
        const clamps = new Map<number, Row>();
        const entities: number[] = [];
        for (let e = 1; e <= 32; e++) {
            entities.push(e);
            transforms.set(e, { position: { x: (rand() - 0.5) * 160, y: 0, z: 0 } });
            clamps.set(e, { lo: -50, hi: 50, push: 10 + rand() * 60 });
        }
        return {
            entities,
            comps: new Map([['Transform', transforms], ['FixtureClamp', clamps]]),
            resources: new Map<string, Row>([['Time', { delta: 1 / 30 }]]),
        };
    }

    function runClampNative(world: EirWorld): void {
        const sys = clampSystem as unknown as StubSystem;
        const transforms = world.comps.get('Transform')!;
        const clamps = world.comps.get('FixtureClamp')!;
        const query = {
            *[Symbol.iterator]() {
                for (const e of world.entities) yield [e, transforms.get(e)!, clamps.get(e)!];
            },
        };
        (sys.fn as unknown as (q: unknown, t: unknown) => void)(query, world.resources.get('Time'));
    }

    it('compiles and verifies', () => {
        expect(diagnostics.filter((d) => d.system === 'FixtureClampSys').map((d) => d.message)).toEqual([]);
        expect(clamp).toBeDefined();
        expect(verifySystem(clamp!, module.comps)).toEqual([]);
    });

    it('keeps the ternary and the intrinsics in the IR', () => {
        const text = printSystem(clamp!);
        expect(text).toContain('? ');
        expect(text).toContain('min(max(');
        expect(text).toContain('sqrt(abs(');
    });

    it('agrees with node over 40 frames', () => {
        const byNode = clampWorld();
        const byEir = clampWorld();
        for (let f = 0; f < 40; f++) {
            runClampNative(byNode);
            runSystem(clamp!, byEir);
        }
        expect(byEir.comps.get('Transform')).toEqual(byNode.comps.get('Transform'));
    });

});
