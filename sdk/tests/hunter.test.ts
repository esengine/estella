// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The claim: a hunter decides and asks. It moves no transform, deals no damage,
 * and what its animator hears is what the world allowed.
 */
import { describe, it, expect } from 'vitest';
import {
    Hunter, decideHunterState, huntTargets, driveHunterRootMotion,
    TPC_SPEED, TPC_GROUNDED, TPC_ATTACK,
    type HunterData,
} from '../src/gameplay';
import { Health, type HealthData } from '../src/gameplay';
import { Perception, type PerceptionData } from '../src/ai/perception/components';
import { NavAgent, type NavAgentData } from '../src/ai/nav/NavAgent';
import { CharacterController3D, type CharacterController3DData } from '../src/physics3d/Physics3DComponents';
import { AnimatorRootMotion, type AnimatorRootMotionData } from '../src/animation';
import { Animator, AnimatorControllerAPI, type AnimatorData } from '../src/animation';
import { Transform, type TransformData } from '../src/ecs/component';
import { q } from '../src/math/quat';

const ENEMY = 1;

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
        set(e: number, c: unknown, d: unknown) { mapOf(c).set(e, d); },
        valid() { return true; },
        update(e: number, c: unknown, edit: (d: any) => void) {
            const d = mapOf(c).get(e);
            if (d === undefined) throw new Error('update: entity does not carry it');
            edit(d); mapOf(c).set(e, d);
        },
        getEntitiesWithComponents(comps: unknown[]) {
            const [first, ...rest] = comps;
            return [...mapOf(first).keys()].filter(e => rest.every(c => mapOf(c).has(e)));
        },
    } as any;
}

const sight = (over: Partial<PerceptionData> = {}): PerceptionData => ({
    visible: true, distance: 0,
    targetX: 0, targetY: 0, targetZ: -400,
    dirX: 0, dirY: 0, dirZ: -1,
    ...over,
} as PerceptionData);

const character = (over: Partial<CharacterController3DData> = {}): CharacterController3DData => ({
    velocity: { x: 0, y: 0, z: 0 },
    radius: 30, halfHeight: 30, maxSlope: 0.87, layer: 0,
    stepHeight: 40, snapDown: 50, mass: 70, pushForce: 5000, enabled: true,
    isOnFloor: true, floorNormal: { x: 0, y: 1, z: 0 },
    realVelocity: { x: 0, y: 0, z: 0 },
    ...over,
} as CharacterController3DData);

/** A hunter at the origin that can see something 400 units up the -Z axis. */
function scene(over: Partial<HunterData> = {}, perception: Partial<PerceptionData> = {}) {
    const world = makeWorld();
    world.insert(ENEMY, Transform, {
        position: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
    } as unknown as TransformData);
    world.insert(ENEMY, Hunter, {
        attackRange: 110, attackInterval: 1.6, rotationSpeed: 3600,
        idleThreshold: 8, enabled: true, state: 'idle', cooldown: 0, ...over,
    } as HunterData);
    world.insert(ENEMY, Perception, sight(perception));
    world.insert(ENEMY, NavAgent, {
        speed: 200, radius: 0, arriveRadius: 6, repathInterval: 0.5,
        hasTarget: false, targetX: 0, targetY: 0, targetZ: 0, arrived: false,
    } as NavAgentData);
    world.insert(ENEMY, CharacterController3D, character());
    world.insert(ENEMY, Animator, { controller: 'x', currentState: '', enabled: true } as AnimatorData);
    world.insert(ENEMY, Health, { current: 100, max: 100 } as HealthData);
    return world;
}

const hunter = (world: any) => world.get(ENEMY, Hunter) as HunterData;
const agent = (world: any) => world.get(ENEMY, NavAgent) as NavAgentData;
const body = (world: any) => world.get(ENEMY, CharacterController3D) as CharacterController3DData;
const hunt = (world: any, animator: AnimatorControllerAPI | null = null, dt = 1 / 60) =>
    huntTargets(world, animator, TPC_ATTACK, dt);

// =============================================================================
// The decision, on its own
// =============================================================================

describe('what a hunter should be doing', () => {
    const at = (over: Partial<Parameters<typeof decideHunterState>[0]>) =>
        decideHunterState({ alive: true, visible: true, distance: 400, attackRange: 110, ...over });

    it('is nothing at all once it is down, whatever it can see', () => {
        expect(at({ alive: false, visible: true, distance: 10 })).toBe('dead');
    });

    it('is idle while it sees nothing', () => {
        expect(at({ visible: false })).toBe('idle');
    });

    it('is a chase while what it sees is out of reach', () => {
        expect(at({ distance: 400 })).toBe('chase');
    });

    it('is a swing once it is close enough', () => {
        expect(at({ distance: 100 })).toBe('attack');
    });

    it('goes back to a chase when the target steps away mid-swing', () => {
        // Recomputed, not latched: a state that only left on its own would leave
        // the hunter swinging at air.
        expect(at({ distance: 111 })).toBe('chase');
    });
});

// =============================================================================
// What it asks for
// =============================================================================

describe('a hunter asks navigation, and nothing else', () => {
    it('points the agent at what it sees', () => {
        const world = scene();
        hunt(world);
        expect(hunter(world).state).toBe('chase');
        expect(agent(world).hasTarget).toBe(true);
        expect(agent(world).targetZ).toBe(-400);
    });

    it('moves no transform of its own', () => {
        const world = scene();
        const before = { ...(world.get(ENEMY, Transform) as TransformData).position };
        hunt(world);
        expect((world.get(ENEMY, Transform) as TransformData).position).toEqual(before);
    });

    it('stops the agent AND the body when it loses sight', () => {
        const world = scene();
        hunt(world);
        // Navigation SKIPS an agent with no destination, so a hunter that only
        // cleared the target would coast on the velocity nav last wrote.
        world.update(ENEMY, CharacterController3D, (c: CharacterController3DData) => {
            c.velocity.x = 120; c.velocity.z = -160;
        });
        world.insert(ENEMY, Perception, sight({ visible: false }));
        hunt(world);

        expect(hunter(world).state).toBe('idle');
        expect(agent(world).hasTarget).toBe(false);
        expect(body(world).velocity.x).toBe(0);
        expect(body(world).velocity.z).toBe(0);
    });

    it('stops chasing once it is close enough to swing', () => {
        const world = scene({}, { targetZ: -80 });
        hunt(world);
        expect(hunter(world).state).toBe('attack');
        expect(agent(world).hasTarget).toBe(false);
    });
});

describe('a hunter swings through the animator', () => {
    /** The triggers an animator is holding for the enemy, read back. */
    const triggersOf = (a: AnimatorControllerAPI): string[] => {
        const store = (a as unknown as { triggers: Map<number, Set<string>> }).triggers;
        return [...(store.get(ENEMY) ?? [])];
    };

    it('sets the action, and names no clip', () => {
        const world = scene({}, { targetZ: -80 });
        const animator = new AnimatorControllerAPI();
        hunt(world, animator);
        expect(triggersOf(animator)).toContain(TPC_ATTACK);
    });

    it('and waits out its own interval before the next one', () => {
        const world = scene({ attackInterval: 1 }, { targetZ: -80 });
        const animator = new AnimatorControllerAPI();
        hunt(world, animator, 0.1);
        animator.resetTrigger(ENEMY, TPC_ATTACK);

        for (let i = 0; i < 5; i++) hunt(world, animator, 0.1);
        expect(triggersOf(animator)).not.toContain(TPC_ATTACK);
        for (let i = 0; i < 6; i++) hunt(world, animator, 0.1);
        expect(triggersOf(animator)).toContain(TPC_ATTACK);
    });

    it('never swings once it is down', () => {
        const world = scene({}, { targetZ: -80 });
        world.insert(ENEMY, Health, { current: 0, max: 100 } as HealthData);
        const animator = new AnimatorControllerAPI();
        hunt(world, animator);
        expect(hunter(world).state).toBe('dead');
        expect(triggersOf(animator)).not.toContain(TPC_ATTACK);
        expect(agent(world).hasTarget).toBe(false);
    });
});

describe('what the animator hears', () => {
    it('is the speed the world allowed, not the one navigation asked for', () => {
        const world = scene();
        const animator = new AnimatorControllerAPI();
        // Navigation asked for a full run and the world gave nothing back.
        world.update(ENEMY, CharacterController3D, (c: CharacterController3DData) => {
            c.velocity.z = -200;
            c.realVelocity.z = 0;
        });
        hunt(world, animator);
        expect(animator.getFloat(ENEMY, TPC_SPEED)).toBe(0);
    });

    it('is that speed when it is real', () => {
        const world = scene();
        const animator = new AnimatorControllerAPI();
        world.update(ENEMY, CharacterController3D, (c: CharacterController3DData) => {
            c.realVelocity.z = -150;
        });
        hunt(world, animator);
        expect(animator.getFloat(ENEMY, TPC_SPEED)).toBeCloseTo(150, 5);
    });

    it('is standing still once it is down, however fast it was going', () => {
        const world = scene();
        world.insert(ENEMY, Health, { current: 0, max: 100 } as HealthData);
        const animator = new AnimatorControllerAPI();
        world.update(ENEMY, CharacterController3D, (c: CharacterController3DData) => {
            c.realVelocity.z = -150;
        });
        hunt(world, animator);
        expect(animator.getFloat(ENEMY, TPC_SPEED)).toBe(0);
    });

    it('carries the floor contact through as it stands', () => {
        const world = scene();
        const animator = new AnimatorControllerAPI();
        world.update(ENEMY, CharacterController3D, (c: CharacterController3DData) => {
            c.isOnFloor = false;
        });
        hunt(world, animator);
        expect(animator.getBool(ENEMY, TPC_GROUNDED)).toBe(false);
    });
});

describe('which way a hunter looks', () => {
    const yawOf = (world: any) =>
        q.toEuler((world.get(ENEMY, Transform) as TransformData).rotation)[1];

    it('is where it actually went while it is chasing', () => {
        const world = scene();
        world.update(ENEMY, CharacterController3D, (c: CharacterController3DData) => {
            c.realVelocity.x = -150;
        });
        // Turning is rate-limited, so give it the steps the quarter turn takes.
        for (let i = 0; i < 5; i++) hunt(world);
        expect(yawOf(world)).toBeCloseTo(90, 3);
    });

    it('is at the target while it is swinging, whatever the last drift was', () => {
        // A swing aimed down a residual drift lands beside what it aimed at.
        const world = scene({}, { targetZ: -80, dirX: -1, dirZ: 0 });
        world.update(ENEMY, CharacterController3D, (c: CharacterController3DData) => {
            c.realVelocity.z = -150;
        });
        for (let i = 0; i < 5; i++) hunt(world);
        expect(hunter(world).state).toBe('attack');
        expect(yawOf(world)).toBeCloseTo(90, 3);
    });
});

describe('a hunter’s lunge goes through the character controller', () => {
    it('becomes the rate the animation asked for', () => {
        const world = scene();
        world.insert(ENEMY, AnimatorRootMotion, {
            enabled: true, active: true,
            deltaPosition: { x: 0, y: 0, z: -4 },
            deltaRotation: { w: 1, x: 0, y: 0, z: 0 },
            deltaTime: 1 / 60,
        } as AnimatorRootMotionData);
        driveHunterRootMotion(world);
        expect(body(world).velocity.z).toBeCloseTo(-240, 5);
    });

    it('and leaves the steering alone when no animation is driving', () => {
        const world = scene();
        world.insert(ENEMY, AnimatorRootMotion, {
            enabled: true, active: false,
            deltaPosition: { x: 0, y: 0, z: -4 },
            deltaRotation: { w: 1, x: 0, y: 0, z: 0 },
            deltaTime: 1 / 60,
        } as AnimatorRootMotionData);
        world.update(ENEMY, CharacterController3D, (c: CharacterController3DData) => {
            c.velocity.z = -77;
        });
        driveHunterRootMotion(world);
        expect(body(world).velocity.z).toBe(-77);
    });
});
