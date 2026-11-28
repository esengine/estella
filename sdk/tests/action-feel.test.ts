/**
 * @file  The forgiveness and weight an action game is played by: a jump a moment off the edge or a moment early still
 *        goes, the dodge key taps to dodge and holds to sprint, one bar pays for all of it, a hit leaves a moment of
 *        grace, enough blows stagger, a 2D dash bursts and is untouchable, and a landed blow holds the game still.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
    ThirdPersonController, requestMotion, type ThirdPersonControllerData,
    Stamina, spendStamina, regenerateStamina, type StaminaData,
    Health, Damage, applyDamage, tickHealth, type HealthData,
    MeleeAttack, GameplayPlugin, DODGE_KEY, TPC_DODGE, TPC_SPRINT,
    Hunter, staggerHunter, type HunterData,
} from '../src/gameplay';
import { CharacterController3D, type CharacterController3DData } from '../src/physics3d/Physics3DComponents';
import { Animator, type AnimatorData } from '../src/animation/Animator';
import { Transform, type TransformData } from '../src/ecs/component';
import { platformerState, stepPlatformer, PlatformerController2D, type PlatformerController2DData } from '../src/physics/PlatformerController2D';
import { App } from '../src/app/app';
import { defineSystem, Schedule } from '../src/ecs/system';
import { EventWriter, type EventWriterInstance } from '../src/ecs/event';
import { Time } from '../src/ecs/resource';
import type { DamagePayload } from '../src/gameplay';
import type { Entity } from '../src/types';

const PLAYER = 1;

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
        valid(e: number) { return e > 0; },
        update(e: number, c: unknown, edit: (d: any) => void) { edit(mapOf(c).get(e)); },
        getEntitiesWithComponents(comps: unknown[]) {
            const [first, ...rest] = comps;
            return [...mapOf(first).keys()].filter(e => rest.every(c => mapOf(c).has(e)));
        },
    } as any;
}

/** Keys held this step; `pressed` are the ones that went down this step. */
function keys(held: string[] = [], pressed: string[] = []) {
    const down = new Set(held), edge = new Set(pressed);
    return {
        isKeyDown: (k: string) => down.has(k),
        isKeyPressed: (k: string) => edge.has(k),
        getMousePosition: () => ({ x: 0, y: 0 }),
        isMouseButtonDown: () => false,
    } as any;
}

function animatorSpy() {
    const triggers: string[] = [];
    const bools = new Map<string, boolean>();
    return {
        triggers, bools,
        setTrigger: (_e: number, name: string) => { triggers.push(name); },
        setBool: (_e: number, name: string, v: boolean) => { bools.set(name, v); },
        setFloat: () => {},
    } as any;
}

function player(over: Partial<ThirdPersonControllerData> = {}, stamina?: Partial<StaminaData>) {
    const world = makeWorld();
    world.insert(PLAYER, Transform, { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } as TransformData);
    world.insert(PLAYER, CharacterController3D, {
        velocity: { x: 0, y: 0, z: 0 }, realVelocity: { x: 0, y: 0, z: 0 }, isOnFloor: true, floorNormal: { x: 0, y: 1, z: 0 }, enabled: true,
    } as unknown as CharacterController3DData);
    world.insert(PLAYER, ThirdPersonController, {
        moveSpeed: 4, acceleration: 1e6, deceleration: 1e6, rotationSpeed: 720, jumpSpeed: 5, airControl: 1,
        cameraRelative: false, camera: 0 as Entity, idleThreshold: 0.1, enabled: true,
        coyoteTime: 0.12, jumpBuffer: 0.14, sprintSpeed: 0, sprintCost: 9, dodgeCost: 22, attackCost: 9, jumpCost: 6, ...over,
    } as ThirdPersonControllerData);
    world.insert(PLAYER, Animator, { controller: 'x', currentState: '', enabled: true } as AnimatorData);
    if (stamina) world.insert(PLAYER, Stamina, { current: 100, max: 100, regen: 26, regenDelay: 0.7, cooldown: 0, ...stamina });
    return world;
}

const asked = (world: any) => (world.get(PLAYER, CharacterController3D) as CharacterController3DData).velocity;
const setFloor = (world: any, on: boolean) => { (world.get(PLAYER, CharacterController3D) as CharacterController3DData).isOnFloor = on; };
const DT = 1 / 60;

describe('a jump forgives both ways', () => {
    it('still goes a moment after walking off an edge', () => {
        const world = player();
        requestMotion(world, keys(), DT);
        setFloor(world, false);
        for (let i = 0; i < 4; i++) requestMotion(world, keys(), DT);
        requestMotion(world, keys(['Space'], ['Space']), DT);
        expect(asked(world).y).toBeCloseTo(5, 5);
    });

    it('does not go once the edge is well behind', () => {
        const world = player();
        requestMotion(world, keys(), DT);
        setFloor(world, false);
        for (let i = 0; i < 12; i++) requestMotion(world, keys(), DT);
        requestMotion(world, keys(['Space'], ['Space']), DT);
        expect(asked(world).y).toBe(0);
    });

    it('goes on landing when pressed a moment before', () => {
        const world = player();
        setFloor(world, false);
        for (let i = 0; i < 20; i++) requestMotion(world, keys(), DT);
        requestMotion(world, keys(['Space'], ['Space']), DT);
        expect(asked(world).y).toBe(0);
        for (let i = 0; i < 4; i++) requestMotion(world, keys(), DT);
        setFloor(world, true);
        requestMotion(world, keys(), DT);
        expect(asked(world).y).toBeCloseTo(5, 5);
    });
});

describe('the dodge key taps to dodge and holds to sprint', () => {
    it('dodges the moment it goes down when there is no sprint', () => {
        const world = player();
        const animator = animatorSpy();
        requestMotion(world, keys([DODGE_KEY], [DODGE_KEY]), DT, animator);
        expect(animator.triggers).toContain(TPC_DODGE);
    });

    it('with a sprint, a tap dodges when it is let go', () => {
        const world = player({ sprintSpeed: 8 });
        const animator = animatorSpy();
        for (let i = 0; i < 5; i++) requestMotion(world, keys([DODGE_KEY], i === 0 ? [DODGE_KEY] : []), DT, animator);
        expect(animator.triggers).not.toContain(TPC_DODGE);
        requestMotion(world, keys(), DT, animator);
        expect(animator.triggers).toContain(TPC_DODGE);
    });

    it('held, it sprints and the animator hears so, and letting go is no dodge', () => {
        const world = player({ sprintSpeed: 8 });
        const animator = animatorSpy();
        for (let i = 0; i < 30; i++) requestMotion(world, keys([DODGE_KEY, 'KeyW']), DT, animator);
        expect(Math.hypot(asked(world).x, asked(world).z)).toBeCloseTo(8, 3);
        expect(animator.bools.get(TPC_SPRINT)).toBe(true);
        requestMotion(world, keys(['KeyW']), DT, animator);
        expect(animator.triggers).not.toContain(TPC_DODGE);
        expect(Math.hypot(asked(world).x, asked(world).z)).toBeCloseTo(4, 3);
    });
});

describe('one bar pays for every costly action', () => {
    it('takes a dodge from the bar, and refuses one on an empty bar', () => {
        const world = player({}, { current: 30 });
        const animator = animatorSpy();
        requestMotion(world, keys([DODGE_KEY], [DODGE_KEY]), DT, animator);
        expect((world.get(PLAYER, Stamina) as StaminaData).current).toBeCloseTo(8, 5);
        requestMotion(world, keys(), DT, animator);
        requestMotion(world, keys([DODGE_KEY], [DODGE_KEY]), DT, animator);
        expect((world.get(PLAYER, Stamina) as StaminaData).current).toBe(0);
        requestMotion(world, keys(), DT, animator);
        requestMotion(world, keys([DODGE_KEY], [DODGE_KEY]), DT, animator);
        expect(animator.triggers.filter((t: string) => t === TPC_DODGE)).toHaveLength(2);
    });

    it('drops a sprint to a run when the bar runs dry, until the key is let go', () => {
        const world = player({ sprintSpeed: 8, sprintCost: 60 }, { current: 10 });
        for (let i = 0; i < 40; i++) requestMotion(world, keys([DODGE_KEY, 'KeyW']), DT);
        expect(Math.hypot(asked(world).x, asked(world).z)).toBeCloseTo(4, 3);
        (world.get(PLAYER, Stamina) as StaminaData).current = 50;
        requestMotion(world, keys([DODGE_KEY, 'KeyW']), DT);
        expect(Math.hypot(asked(world).x, asked(world).z)).toBeCloseTo(4, 3);
    });

    it('comes back only after a moment of spending nothing', () => {
        const world = player({}, { current: 50 });
        spendStamina(world, PLAYER as Entity, 10);
        regenerateStamina(world, 0.5);
        expect((world.get(PLAYER, Stamina) as StaminaData).current).toBeCloseTo(40, 5);
        regenerateStamina(world, 0.5);
        expect((world.get(PLAYER, Stamina) as StaminaData).current).toBeCloseTo(40 + 26 * 0.3, 5);
    });

    it('costs nothing to a character without a bar', () => {
        const world = player();
        expect(spendStamina(world, PLAYER as Entity, 1000)).toBe(true);
    });
});

describe('a hit has weight and leaves a moment of grace', () => {
    const blow = (amount: number): DamagePayload => ({ target: PLAYER as Entity, source: 2 as Entity, amount, x: 0, y: 0, z: 0 });
    const health = (over: Partial<HealthData>) => {
        const world = makeWorld();
        world.insert(PLAYER, Health, { current: 100, max: 100, graceTime: 0, poise: 0, poiseRecovery: 2, invulnerable: 0, stagger: 0, ...over });
        return world;
    };

    it('lets no second blow land inside the grace after the first', () => {
        const world = health({ graceTime: 0.5 });
        applyDamage(world, [blow(10)]);
        const second = applyDamage(world, [blow(10)]);
        expect(second.landed).toHaveLength(0);
        tickHealth(world, 0.6);
        applyDamage(world, [blow(10)]);
        expect((world.get(PLAYER, Health) as HealthData).current).toBe(80);
    });

    it('lands nothing on a character its animation says is untouchable', () => {
        const world = health({});
        const outcome = applyDamage(world, [blow(10)], () => true);
        expect(outcome.landed).toHaveLength(0);
        expect((world.get(PLAYER, Health) as HealthData).current).toBe(100);
    });

    it('staggers once the blows inside the recovery reach its poise, and poise comes back', () => {
        const world = health({ poise: 30, poiseRecovery: 2 });
        expect(applyDamage(world, [blow(20)]).staggered).toHaveLength(0);
        expect(applyDamage(world, [blow(15)]).staggered).toEqual([PLAYER]);
        applyDamage(world, [blow(20)]);
        tickHealth(world, 2);
        expect(applyDamage(world, [blow(20)]).staggered).toHaveLength(0);
    });

    it('costs a staggered hunter the swing it was winding up', () => {
        const world = makeWorld();
        world.insert(PLAYER, Hunter, { attackRange: 1, attackInterval: 1.6, rotationSpeed: 540, idleThreshold: 0.1, enabled: true, state: 'attack', cooldown: 0.1 });
        staggerHunter(world, PLAYER as Entity);
        expect((world.get(PLAYER, Hunter) as HunterData).cooldown).toBeCloseTo(1.6, 5);
    });
});

describe('a 2D dash bursts along the way it faces', () => {
    const config = (over: Partial<PlatformerController2DData> = {}): PlatformerController2DData => ({
        ...(PlatformerController2D as unknown as { _default: PlatformerController2DData })._default,
        moveSpeed: 200, groundAcceleration: 1e6, airAcceleration: 1e6, groundDeceleration: 1e6, airDeceleration: 1e6,
        gravity: 1600, fallGravityScale: 1, maxFallSpeed: 1000, jumpSpeed: 600, jumpCut: 0.5, coyoteTime: 0.1, jumpBuffer: 0.1,
        airJumps: 0, dropTime: 0.2, keepPlatformVelocity: true, readKeyboard: false, moveInput: 0, jumpHeld: false,
        jumpPressed: false, dropPressed: false, enabled: true,
        dashSpeed: 900, dashTime: 0.1, dashCooldown: 0.2, ...over,
    } as PlatformerController2DData);
    const ground = { onFloor: true, onCeiling: false, floorVelocityX: 0, floorVelocityY: 0 };
    const air = { ...ground, onFloor: false };

    it('goes at its speed with no gravity for its time, then is over', () => {
        const state = platformerState();
        const c = config({ moveInput: -1 });
        const first = stepPlatformer(c, state, air, 0, -300, false, false, DT, true);
        expect(first).toMatchObject({ velocityX: -900, velocityY: 0, dashed: true, dashing: true });
        let step = first;
        for (let i = 0; i < 6; i++) step = stepPlatformer(c, state, air, step.velocityX, step.velocityY, false, false, DT);
        expect(step.dashing).toBe(false);
        expect(step.velocityY).toBeLessThan(0);
    });

    it('dashes once in the air until it lands, and waits out its cooldown', () => {
        const state = platformerState();
        const c = config({ moveInput: 1 });
        stepPlatformer(c, state, air, 0, 0, false, false, DT, true);
        for (let i = 0; i < 30; i++) stepPlatformer(c, state, air, 0, 0, false, false, DT);
        expect(stepPlatformer(c, state, air, 0, 0, false, false, DT, true).dashed).toBe(false);
        stepPlatformer(c, state, ground, 0, 0, false, false, DT);
        expect(stepPlatformer(c, state, ground, 0, 0, false, false, DT, true).dashed).toBe(true);
        for (let i = 0; i < 8; i++) stepPlatformer(c, state, ground, 0, 0, false, false, DT);
        expect(stepPlatformer(c, state, ground, 0, 0, false, false, DT, true).dashed).toBe(false);
    });

    it('does nothing with no dash speed', () => {
        const step = stepPlatformer(config({ dashSpeed: 0 }), platformerState(), ground, 0, 0, false, false, DT, true);
        expect(step.dashed).toBe(false);
    });
});

describe('a landed blow holds the game still', () => {
    const apps: App[] = [];
    afterEach(() => { for (const app of apps.splice(0)) app.quit(); });

    it('takes Time.scale to 0 for its hit stop and gives it back', async () => {
        const app = App.new();
        apps.push(app);
        app.addPlugin(new GameplayPlugin());
        const attacker = app.world.spawn();
        app.world.insert(attacker, MeleeAttack, { ...(MeleeAttack as any)._default, hitStop: 0.05 });
        const target = app.world.spawn();
        app.world.insert(target, Health, { current: 100, max: 100 });
        let sent = false;
        app.addSystemToSchedule(Schedule.Update, defineSystem([EventWriter(Damage)], (w: EventWriterInstance<DamagePayload>) => {
            if (sent) return;
            sent = true;
            w.send({ target, source: attacker, amount: 10, x: 0, y: 0, z: 0 });
        }, { name: 'TestBlow' }));
        await app.tick(1 / 60);
        await app.tick(1 / 60);
        expect((app.world.get(target, Health) as HealthData).current).toBe(90);
        expect(app.getResource(Time).scale).toBe(0);
        for (let i = 0; i < 6; i++) await app.tick(1 / 60);
        expect(app.getResource(Time).scale).toBe(1);
    });
});
