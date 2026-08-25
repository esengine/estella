// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    conformance.test.ts
 * @brief   Every subset feature run BOTH ways and compared.
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
import { inlineSystem } from '../src/inline';
import { builtinShapes } from '../src/builtins';
import { printSystem } from '../src/eir';

import { driftSystem, clampSystem, tunedSystem, helperSystem, mathSystem, gateSystem } from './fixtures/in-subset';
import { PROBE, probeRow } from './probe';
import type { StubSystem } from './stubs/esengine';

const FIXTURE = resolve(fileURLToPath(new URL('./fixtures/in-subset.ts', import.meta.url)));
const ENTITIES = 48;

/** Two keys held and one not, so both answers are exercised every frame. */
function fakeInput(): { isKeyDown(k: string): boolean; isKeyPressed(k: string): boolean } {
    return {
        isKeyDown: (k) => k === 'KeyW',
        isKeyPressed: (k) => k === 'Space',
    };
}

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
        resources: new Map<string, Row>([
            ['Time', { delta: 1 / 30, elapsed: 0 }],
            // A service, not a record: the interpreter asks it, and a compiled
            // build reads what a host mirrored the same answers into.
            ['Input', fakeInput() as unknown as Row],
        ]),
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
const tuned = module.systems.find((s) => s.name === 'FixtureTuned');
const gate = module.systems.find((s) => s.name === 'FixtureGate');

describe('conformance — locals, branches, logic', () => {
    it('compiles', () => {
        expect(diagnostics.filter((d) => d.system === 'FixtureDrift')).toEqual([]);
        expect(drift).toBeDefined();
        expect(verifySystem(drift!, module.comps, module.fns)).toEqual([]);
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

describe('conformance — a service question, and the ways out of a row loop', () => {
    /** The author's own system, over the same world the interpreter walks. */
    const runGateNative = (world: EirWorld): void => {
        const drifts = world.comps.get('FixtureDrift')!;
        const query = {
            *[Symbol.iterator]() {
                for (const e of world.entities) if (drifts.has(e)) yield [e, drifts.get(e)!];
            },
        };
        (gateSystem as unknown as StubSystem).fn(query, world.resources.get('Input'));
    };

    it('compiles, and verifies', () => {
        expect(diagnostics.filter((d) => d.system === 'FixtureGate')).toEqual([]);
        expect(gate).toBeDefined();
        expect(verifySystem(gate!, module.comps, module.fns)).toEqual([]);
    });

    it('reads back as the question and the jumps, not as calls', () => {
        expect(printSystem(gate!)).toMatchInlineSnapshot(`
          "system FixtureGate(query: query<mut FixtureDrift>, input: res<Input>) {
            if !input.isKeyDown("KeyW") {
              return
            }
            rowLoop query -> (_, d) {
              if !d.enabled {
                continue
              }
              if (d.rate > 110) {
                break
              }
              d.rate = (d.rate + (input.isKeyPressed("Space") ? 2 : 1))
            }
          }"
        `);
    });

    it('agrees with node over 40 frames', () => {
        const byNode = makeWorld();
        const byEir = makeWorld();
        for (let f = 0; f < 40; f++) {
            runGateNative(byNode);
            runSystem(gate!, byEir);
        }
        expect(byEir.comps.get('FixtureDrift')).toEqual(byNode.comps.get('FixtureDrift'));
    });

    it('took each exit — an agreement over an untaken jump proves nothing', () => {
        const world = makeWorld();
        const rows = [...world.comps.get('FixtureDrift')!.values()] as { rate: number; enabled: boolean }[];
        // `continue`: rows with enabled false, which must never move.
        const skipped = rows.filter((r) => !r.enabled).map((r) => r.rate);
        // `break`: a row over the limit exists, so the loop ends early and the
        // rows after it are untouched this frame.
        expect(rows.some((r) => r.rate > 110)).toBe(true);
        for (let f = 0; f < 40; f++) runSystem(gate!, world);
        expect(rows.filter((r) => !r.enabled).map((r) => r.rate)).toEqual(skipped);
        // `return`: with the key up, nothing at all moves.
        const quiet = makeWorld();
        (quiet.resources as Map<string, Row>).set('Input',
            { isKeyDown: () => false, isKeyPressed: () => false } as unknown as Row);
        const before = JSON.stringify([...quiet.comps.get('FixtureDrift')!.values()]);
        for (let f = 0; f < 4; f++) runSystem(gate!, quiet);
        expect(JSON.stringify([...quiet.comps.get('FixtureDrift')!.values()])).toBe(before);
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
        expect(verifySystem(clamp!, module.comps, module.fns)).toEqual([]);
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

describe('conformance — module constants', () => {
    function runTunedNative(world: EirWorld): void {
        const sys = tunedSystem as unknown as StubSystem;
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

    it('compiles and verifies', () => {
        expect(diagnostics.filter((d) => d.system === 'FixtureTuned').map((d) => d.message)).toEqual([]);
        expect(tuned).toBeDefined();
        expect(verifySystem(tuned!, module.comps, module.fns)).toEqual([]);
    });

    it('folds the constants rather than loading them', () => {
        const text = printSystem(tuned!);
        // The values, not the names: WRAP is 120 and TUNING.damping is 0.9.
        expect(text).toContain('120');
        expect(text).toContain('0.9');
        expect(text).not.toContain('WRAP)');
        expect(text).not.toContain('TUNING');
    });

    it('lets a local shadow a module constant', () => {
        // Inside the if, WRAP is a local; folding that ignored scope would print
        // the module value 120 in its place.
        expect(printSystem(tuned!)).toContain('let WRAP = drift.rate');
        expect(printSystem(tuned!)).toContain('(WRAP > 100)');
    });

    it('agrees with node over 40 frames', () => {
        const byNode = makeWorld();
        const byEir = makeWorld();
        for (let f = 0; f < 40; f++) {
            runTunedNative(byNode);
            runSystem(tuned!, byEir);
        }
        expect(byEir.comps.get('Transform')).toEqual(byNode.comps.get('Transform'));
    });
});

describe('conformance — pure helpers, called and inlined', () => {
    const helpers = module.systems.find((s) => s.name === 'FixtureHelpers');
    const inlined = helpers ? inlineSystem(helpers, module.fns) : undefined;

    function runHelperNative(world: EirWorld): void {
        const sys = helperSystem as unknown as StubSystem;
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

    it('compiles, and both forms verify', () => {
        expect(diagnostics.filter((d) => d.system === 'FixtureHelpers').map((d) => d.message)).toEqual([]);
        expect(helpers).toBeDefined();
        expect(verifySystem(helpers!, module.comps, module.fns)).toEqual([]);
        // The pass must not invalidate the IR it rewrote.
        expect(verifySystem(inlined!, module.comps, module.fns)).toEqual([]);
    });

    it('leaves no call to a module function after inlining', () => {
        expect(printSystem(helpers!)).toContain('clamp(');
        expect(printSystem(helpers!)).toContain('boost(');
        const after = printSystem(inlined!);
        expect(after).not.toContain('clamp(');
        expect(after).not.toContain('boost(');
        // Arguments are bound once, not duplicated per use.
        expect(after).toContain('let v$');
    });

    it('node, the IR, and the inlined IR all agree over 40 frames', () => {
        const byNode = makeWorld();
        const byEir = makeWorld();
        const byInlined = makeWorld();
        for (let f = 0; f < 40; f++) {
            runHelperNative(byNode);
            runSystem(helpers!, byEir, module.fns);
            runSystem(inlined!, byInlined, module.fns);
        }
        expect(byEir.comps.get('Transform')).toEqual(byNode.comps.get('Transform'));
        expect(byInlined.comps.get('Transform')).toEqual(byNode.comps.get('Transform'));
    });
});

const math = module.systems.find((s) => s.name === 'FixtureMathOps');

describe('conformance — the Math the subset admits', () => {
    function probeWorld(): EirWorld {
        const rows = new Map<number, Row>();
        const entities: number[] = [];
        PROBE.forEach((v, i) => {
            entities.push(i + 1);
            // defineComponent shapes are host-stored, so f64: no fround, and -0
            // stays -0 all the way into the image.
            rows.set(i + 1, probeRow(v));
        });
        return { entities, comps: new Map([['FixtureMathProbe', rows]]), resources: new Map() };
    }

    it('compiles, and lowers each operation to a call rather than a fallback', () => {
        expect(diagnostics.filter((d) => d.system === 'FixtureMathOps')).toEqual([]);
        expect(math).toBeDefined();
        expect(verifySystem(math!, module.comps, module.fns)).toEqual([]);
    });

    it('agrees with node, including the sign of zero', () => {
        const byNode = probeWorld();
        const byEir = probeWorld();
        const sys = mathSystem as unknown as StubSystem;
        const rows = byNode.comps.get('FixtureMathProbe')!;
        (sys.fn as unknown as (q: unknown) => void)({
            *[Symbol.iterator]() {
                for (const e of byNode.entities) yield [e, rows.get(e)!];
            },
        });
        runSystem(math!, byEir);

        for (const e of byNode.entities) {
            const want = rows.get(e) as Record<string, number>;
            const got = byEir.comps.get('FixtureMathProbe')!.get(e) as Record<string, number>;
            for (const k of Object.keys(want)) {
                // Object.is, not toBe on the number: -0 and +0 are equal and are
                // not the same bytes, and the bytes are what ships.
                expect(Object.is(got[k], want[k]), `entity ${e} field ${k}: ${got[k]} vs ${want[k]}`).toBe(true);
            }
        }
    });

    it('the probe actually reaches the cases the shims exist for', () => {
        const w = probeWorld();
        runSystem(math!, w);
        const rows = [...w.comps.get('FixtureMathProbe')!.values()] as Record<string, number>[];
        // A tie that rounds toward +Inf rather than away from zero.
        expect(rows.some((r) => r['v'] === -2.5 && r['rounded'] === -2)).toBe(true);
        // The double just below 0.5, where floor(x + 0.5) gives the wrong answer.
        expect(rows.some((r) => r['v'] === 0.49999999999999994 && Object.is(r['rounded'], 0))).toBe(true);
        // min picking the negative zero, which fmin is free not to do.
        expect(rows.some((r) => Object.is(r['lo'], -0))).toBe(true);
        expect(rows.some((r) => Object.is(r['signum'], -0))).toBe(true);
    });
});
