/**
 * @file  An enemy a player can read: its swing winds up (the tell), strikes, and recovers (the opening), on its own
 *        clock or on its clip's; it tracks the player while it winds up and not after; it flushes its colour as it
 *        winds up and gives it back; it waits its turn when others are already swinging; a stagger cancels the swing.
 */
import { describe, it, expect } from 'vitest';
import {
    Hunter, huntTargets, hunterStrikeWindow, staggerHunter, COMBAT_ATTACK_ACTIVE,
    type HunterData,
} from '../src/gameplay';
import { Perception, type PerceptionData } from '../src/ai/perception/components';
import { Transform, MeshRenderer, Children, type TransformData } from '../src/ecs/component';
import { yawOfQuaternion } from '../src/gameplay';
import { Animator } from '../src/animation/Animator';
import type { Entity } from '../src/types';

const DT = 1 / 60;

function makeWorld() {
    const store = new Map<unknown, Map<number, unknown>>();
    const mapOf = (c: unknown) => {
        let m = store.get(c);
        if (!m) { m = new Map(); store.set(c, m); }
        return m;
    };
    return {
        insert(e: number, c: unknown, d: unknown) { mapOf(c).set(e, d); },
        get(e: number, c: unknown) { return mapOf(c).get(e); },
        has(e: number, c: unknown) { return mapOf(c).has(e); },
        valid() { return true; },
        update(e: number, c: unknown, edit: (d: any) => void) { edit(mapOf(c).get(e)); },
        getEntitiesWithComponents(comps: unknown[]) {
            const [first, ...rest] = comps;
            return [...mapOf(first).keys()].filter(e => rest.every(c => mapOf(c).has(e)));
        },
    } as any;
}

/** A hunter at `x` on the X axis that sees a target 50 units up -Z of the origin, inside its reach. */
function addHunter(world: any, e: number, over: Partial<HunterData> = {}, x = 0) {
    world.insert(e, Transform, {
        position: { x, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
    } as unknown as TransformData);
    world.insert(e, Hunter, {
        attackRange: 110, attackInterval: 1.6, rotationSpeed: 3600, idleThreshold: 8, enabled: true, state: 'idle', cooldown: 0,
        windup: 0.5, strike: 0.2, recover: 0.6, telegraphColor: { r: 1, g: 1, b: 0, a: 0 }, maxAttackers: 0, phase: '', phaseTime: 0,
        ...over,
    } as HunterData);
    world.insert(e, Perception, {
        visible: true, distance: 50, targetX: 0, targetY: 0, targetZ: -50, dirX: -x / Math.hypot(x, 50), dirY: 0, dirZ: -50 / Math.hypot(x, 50),
    } as PerceptionData);
}

const hunter = (world: any, e = 1) => world.get(e, Hunter) as HunterData;
const run = (world: any, seconds: number, windows: any = null) => {
    for (let t = 0; t < seconds - 1e-9; t += DT) huntTargets(world, null, 'attack', DT, windows);
};

describe('a swing it times itself', () => {
    it('winds up, strikes, recovers and is ready again', () => {
        const world = makeWorld();
        addHunter(world, 1);
        run(world, DT);
        expect(hunter(world).phase).toBe('windup');
        expect(hunterStrikeWindow(world, 1 as Entity)).toBeNull();
        run(world, 0.5);
        expect(hunter(world).phase).toBe('strike');
        expect(hunterStrikeWindow(world, 1 as Entity)).not.toBeNull();
        run(world, 0.2);
        expect(hunter(world).phase).toBe('recover');
        expect(hunterStrikeWindow(world, 1 as Entity)).toBeNull();
        run(world, 0.6);
        expect(hunter(world).phase).toBe('');
    });

    it('gives each swing a reach of its own', () => {
        const world = makeWorld();
        addHunter(world, 1, { attackInterval: 1.4 });
        run(world, 0.55);
        const first = hunterStrikeWindow(world, 1 as Entity)!.id;
        run(world, 1.4);
        expect(hunter(world).phase).toBe('strike');
        expect(hunterStrikeWindow(world, 1 as Entity)!.id).not.toBe(first);
    });

    it('carries a swing through when the target steps out of reach', () => {
        const world = makeWorld();
        addHunter(world, 1);
        run(world, 0.2);
        (world.get(1, Perception) as PerceptionData).targetZ = -900;
        run(world, 0.35);
        expect(hunter(world).phase).toBe('strike');
    });
});

describe('a swing its clip times', () => {
    it('winds up until the attack-active window opens, and recovers when it closes', () => {
        const world = makeWorld();
        addHunter(world, 1, { windup: 0 });
        world.insert(1, Animator, { controller: 'x', currentState: '', enabled: true });
        let open = false;
        const windows = { openWindow: (_e: number, name: string) => (open && name === COMBAT_ATTACK_ACTIVE ? { id: 7 } : null) };
        const animator = { setTrigger: () => {}, setFloat: () => {}, setBool: () => {} } as any;
        const step = () => huntTargets(world, animator, 'attack', DT, windows);
        step();
        expect(hunter(world).phase).toBe('windup');
        open = true; step();
        expect(hunter(world).phase).toBe('strike');
        open = false; step();
        expect(hunter(world).phase).toBe('recover');
    });
});

describe('what a player reads', () => {
    it('tracks the target while it winds up, and not once it strikes', () => {
        const world = makeWorld();
        addHunter(world, 1);
        run(world, 0.55);
        expect(hunter(world).phase).toBe('strike');
        const before = yawOfQuaternion((world.get(1, Transform) as TransformData).rotation);
        Object.assign(world.get(1, Perception), { dirX: 1, dirZ: 0 });
        run(world, 0.1);
        expect(yawOfQuaternion((world.get(1, Transform) as TransformData).rotation)).toBeCloseTo(before, 5);
    });

    it('flushes toward its telegraph colour over the windup, on its parts too, and gives the colours back', () => {
        const world = makeWorld();
        addHunter(world, 1, { telegraphColor: { r: 1, g: 1, b: 0, a: 1 } });
        world.insert(1, MeshRenderer, { color: { r: 0, g: 0, b: 1, a: 1 } });
        world.insert(1, Children, { entities: [5] });
        world.insert(5, MeshRenderer, { color: { r: 0.2, g: 0.2, b: 0.2, a: 1 } });
        run(world, 0.25);
        const mid = (world.get(1, MeshRenderer) as { color: { r: number; b: number } }).color;
        expect(mid.r).toBeGreaterThan(0.4);
        expect(mid.r).toBeLessThan(0.6);
        expect((world.get(5, MeshRenderer) as { color: { r: number } }).color.r).toBeGreaterThan(0.4);
        run(world, 0.4);
        expect((world.get(1, MeshRenderer) as { color: unknown }).color).toEqual({ r: 0, g: 0, b: 1, a: 1 });
        expect((world.get(5, MeshRenderer) as { color: unknown }).color).toEqual({ r: 0.2, g: 0.2, b: 0.2, a: 1 });
    });

    it('waits its turn when as many as allowed already swing at the same target', () => {
        const world = makeWorld();
        addHunter(world, 1, { maxAttackers: 1 }, -30);
        addHunter(world, 2, { maxAttackers: 1 }, 30);
        run(world, DT);
        const phases = [hunter(world, 1).phase, hunter(world, 2).phase].sort();
        expect(phases).toEqual(['wait', 'windup']);
        run(world, 0.75);
        expect([hunter(world, 1).phase, hunter(world, 2).phase]).toContain('windup');
    });

    it('loses the swing it was winding up to a stagger', () => {
        const world = makeWorld();
        addHunter(world, 1);
        run(world, 0.2);
        staggerHunter(world, 1 as Entity);
        expect(hunter(world).phase).toBe('');
        expect(hunter(world).cooldown).toBeCloseTo(1.6, 5);
    });
});
