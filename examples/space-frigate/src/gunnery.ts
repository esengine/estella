import { Light, Particle, Transform } from 'esengine';
import type { App, Entity, World } from 'esengine';
import { clamp, lookRotation } from './flight';
import { BATTERIES, GUNNERY, boreOf, crossing, dispersion, intercept, limit, muzzleOf, rayToSphere, scatter, slew, solve, wrap, type Mount, type Turret } from './gunSolution';
import { helm, mulQuat, turnBack, turnBy, type Quat, type Vec } from './helm';

export { GUNNERY } from './gunSolution';

export type AimSource = 'view' | 'auto' | 'target' | 'stowed';

export const guns = {
    view: false,
    toggle: false,
    auto: false,
    locked: false,
    squeeze: false,
    holding: false,
    clicks: 0,
    held: 0,
    lead: 0,
    spread: 0,
    source: 'stowed' as AimSource,
    aim: null as Vec | null,
    range: 0,
    rock: -1,
    bearing: 0,
    ready: 0,
    shots: 0,
    hits: 0,
    note: '',
    turrets: [] as Turret[],
    strike: null as ((rock: number, amount: number) => void) | null,
};

interface Bolt { entity: Entity; at: Vec; way: Vec; flown: number; live: boolean }
interface Burst { entity: Entity; light: Entity; age: number; size: number; live: boolean }
interface Rig { turret: Entity; guns: Entity; muzzle: Entity; light: Entity; base: Quat; pivot: Vec; scale: number }

const about = (axis: 'x' | 'y', angle: number): Quat => ({ x: 0, y: 0, z: 0, w: Math.cos(angle / 2), [axis]: Math.sin(angle / 2) });

export function createGunnery(app: App): (world: World, dt: number, sight: { from: Vec; way: Vec } | null, held: boolean) => void {
    let rigs: Rig[] | null = null;
    let rocks: Entity[] = [];
    let bolts: Bolt[] = [];
    let bursts: Burst[] = [];
    let ship: Entity | null = null;
    let sparks: Entity | null = null, smoke: Entity | null = null;
    const puff = (emitter: Entity | null, count: number, at: Vec): void => { if (emitter !== null) app.getResource(Particle).emitAt(emitter, count, at); };
    let clock = 0, pressed = false, pressAt = -1, tapAt = -1, rippleAt = -1, autoAt = -1, nextBolt = 0, nextBurst = 0, seed = 20261115;
    let seen: Vec | null = null, drift: Vec = { x: 0, y: 0, z: 0 }, said = '';
    const chance = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const note = (text: string): void => { if (said !== text) { said = text; guns.note = text; } };

    const need = (world: World, name: string): Entity => {
        const found = world.findEntityByName(name);
        if (found === null) throw new Error(`space-frigate entity missing: ${name}`);
        return found;
    };

    const build = (world: World): Rig[] => {
        ship = need(world, 'Ship');
        sparks = world.findEntityByName('GunSparks');
        smoke = world.findEntityByName('GunSmoke');
        for (let i = 0; ; i++) { const e = world.findEntityByName(`Rock${i}`); if (e === null) break; rocks.push(e); }
        for (let i = 0; ; i++) { const e = world.findEntityByName(`Shell${i}`); if (e === null) break; bolts.push({ entity: e, at: { x: 0, y: 0, z: 0 }, way: { x: 0, y: 0, z: 1 }, flown: 0, live: false }); }
        for (let i = 0; ; i++) { const e = world.findEntityByName(`Impact${i}`); if (e === null) break; bursts.push({ entity: e, light: need(world, `Impact${i}Light`), age: 0, size: 1, live: false }); }
        return BATTERIES.map((battery) => {
            const rig: Rig = { turret: need(world, `Turret${battery.key}`), guns: need(world, `Guns${battery.key}`), muzzle: need(world, `Muzzle${battery.key}`), light: need(world, `Muzzle${battery.key}Light`), base: { x: 0, y: 0, z: 0, w: 1 }, pivot: { x: 0, y: 0, z: 0 }, scale: 1 };
            const seat = world.get(rig.turret, Transform);
            rig.base = { ...seat.rotation };
            rig.pivot = { ...world.get(rig.guns, Transform).position };
            rig.scale = seat.scale.x;
            const mount: Mount = {
                ...battery, seat: { ...seat.position }, flipped: Math.abs(seat.rotation.z) > 0.5,
                trunnion: { x: rig.pivot.x * rig.scale, y: rig.pivot.y * rig.scale, z: rig.pivot.z * rig.scale },
                muzzle: (world.get(rig.muzzle, Transform).position.z - 0.5) * rig.scale, spread: GUNNERY.barrels * rig.scale,
            };
            const at = { yaw: mount.half >= Math.PI - 1e-6 ? 0 : clamp(0, mount.centre - mount.half, mount.centre + mount.half), pitch: 0 };
            guns.turrets.push({ ...mount, ...at, bears: false, onTarget: false, loaded: 1, kick: 0, flash: 0, mouth: muzzleOf(mount, at, 0), bore: boreOf(mount, at) });
            return rig;
        });
    };

    const loose = (turret: Turret, hull: { position: Vec; rotation: Quat }, wide: number): void => {
        turret.loaded = 0;
        turret.kick = 1;
        turret.flash = 1;
        guns.shots++;
        const way = turnBy(hull.rotation, turret.bore);
        for (const side of [turret.spread, -turret.spread]) {
            const bolt = bolts[nextBolt++ % Math.max(1, bolts.length)];
            if (!bolt) return;
            const from = turnBy(hull.rotation, muzzleOf(turret, turret, side));
            bolt.at = { x: hull.position.x + from.x, y: hull.position.y + from.y, z: hull.position.z + from.z };
            bolt.way = scatter(way, wide, chance(), chance());
            bolt.flown = 0;
            bolt.live = true;
            puff(sparks, 9, bolt.at);
            puff(smoke, 5, bolt.at);
        }
    };

    const fireOne = (hull: { position: Vec; rotation: Quat }, wide: number): boolean => {
        const turret = guns.turrets.find((t) => t.onTarget && t.loaded >= 1);
        if (!turret) return false;
        loose(turret, hull, wide);
        return true;
    };

    return (world, dt, sight, held) => {
        if (world.findEntityByName('TurretA') === null) return;
        rigs ??= build(world);
        clock += dt;
        const hull = world.get(ship!, Transform);

        const target = helm.aim;
        if (target && seen && dt > 0 && Math.hypot(target.x - seen.x, target.y - seen.y, target.z - seen.z) < 60) {
            const ease = Math.min(1, dt * 6);
            drift = { x: drift.x + ((target.x - seen.x) / dt - drift.x) * ease, y: drift.y + ((target.y - seen.y) / dt - drift.y) * ease, z: drift.z + ((target.z - seen.z) / dt - drift.z) * ease };
            guns.held = guns.locked ? guns.held + dt : 0;
        } else {
            drift = { x: 0, y: 0, z: 0 };
            guns.held = 0;
        }
        seen = target ? { ...target } : null;
        const from = target ? { x: target.x - hull.position.x, y: target.y - hull.position.y, z: target.z - hull.position.z } : null;
        const meet = from ? intercept(from, drift, GUNNERY.boltSpeed) : null;
        guns.lead = meet ? meet.time : 0;
        guns.spread = from ? dispersion(Math.hypot(from.x, from.y, from.z), crossing(from, drift), guns.held) : GUNNERY.laid;

        let aim: Vec | null = null;
        guns.rock = -1;
        if (guns.auto && guns.view && guns.locked && meet) {
            aim = { x: hull.position.x + meet.point.x, y: hull.position.y + meet.point.y, z: hull.position.z + meet.point.z };
            guns.source = 'auto';
        } else if (guns.view && sight) {
            let best = Infinity;
            rocks.forEach((rock, i) => {
                const t = world.get(rock, Transform);
                const hit = rayToSphere(sight.from, sight.way, t.position, t.scale.x * 0.95);
                if (hit < best) { best = hit; guns.rock = i; }
            });
            const eye = Math.hypot(sight.from.x, sight.from.y, sight.from.z);
            const far = best < Infinity ? best : eye + GUNNERY.convergence;
            aim = { x: sight.from.x + sight.way.x * far, y: sight.from.y + sight.way.y * far, z: sight.from.z + sight.way.z * far };
            guns.source = 'view';
        } else if (target) {
            aim = { ...target };
            guns.source = 'target';
        } else {
            guns.source = 'stowed';
        }
        guns.aim = aim;
        guns.range = aim ? Math.hypot(aim.x, aim.y, aim.z) : 0;
        const local = aim ? turnBack(hull.rotation, { x: aim.x - hull.position.x, y: aim.y - hull.position.y, z: aim.z - hull.position.z }) : null;

        guns.bearing = 0;
        guns.ready = 0;
        guns.turrets.forEach((turret, i) => {
            const rig = rigs![i]!;
            const want = local ? limit(turret, solve(turret, local)) : { ...limit(turret, { yaw: 0, pitch: 0 }), bears: false };
            const now = slew(turret, turret, want, dt);
            turret.yaw = now.yaw;
            turret.pitch = now.pitch;
            turret.bears = want.bears;
            turret.onTarget = want.bears && Math.abs(wrap(want.yaw - now.yaw)) < GUNNERY.tolerance && Math.abs(want.pitch - now.pitch) < GUNNERY.tolerance;
            turret.loaded = Math.min(1, turret.loaded + dt / GUNNERY.reload);
            turret.kick = Math.max(0, turret.kick - dt / 0.5);
            turret.flash = Math.max(0, turret.flash - dt / 0.09);
            turret.bore = boreOf(turret, turret);
            turret.mouth = muzzleOf(turret, turret, 0);
            if (turret.bears) guns.bearing++;
            if (turret.onTarget && turret.loaded >= 1) guns.ready++;
            const back = GUNNERY.recoil * turret.kick * turret.kick;
            world.update(rig.turret, Transform, (t) => { t.rotation = mulQuat(rig.base, about('y', turret.yaw)); });
            world.update(rig.guns, Transform, (t) => {
                t.rotation = about('x', -turret.pitch);
                t.position = { x: rig.pivot.x, y: rig.pivot.y - Math.sin(turret.pitch) * back, z: rig.pivot.z - Math.cos(turret.pitch) * back };
            });
            const glare = 0.001 + 1.5 * turret.flash;
            world.update(rig.muzzle, Transform, (t) => { t.scale = { x: glare, y: glare, z: glare * 1.6 }; });
            world.update(rig.light, Light, (l) => { l.intensity = 3 * turret.flash; });
        });

        const taps = guns.clicks + (held && !pressed ? 1 : 0);
        guns.clicks = 0;
        if (held && !pressed) pressAt = clock;
        pressed = held;
        if (guns.source === 'auto') {
            if (guns.bearing === 0) note('TARGET MASKED  TURN THE SHIP');
            else if (guns.range > GUNNERY.reach) note('TARGET OUT OF RANGE');
            else {
                note('AUTO FIRE');
                if (clock - autoAt > GUNNERY.autoEvery && fireOne(hull, guns.spread)) autoAt = clock;
            }
        } else if (guns.source === 'view') {
            said = '';
            for (let tap = 0; tap < taps; tap++) {
                const again = clock - tapAt < GUNNERY.doubleTap;
                tapAt = clock;
                let loosed = 0;
                while (fireOne(hull, GUNNERY.laid)) { loosed++; if (!again) break; }
                if (loosed === 0) guns.note = guns.bearing === 0 ? 'NO GUN BEARS' : guns.turrets.some((t) => t.bears && t.loaded < 1) ? 'GUNS RELOADING' : 'GUNS TRAINING';
            }
            if (held && clock - pressAt > GUNNERY.rippleAfter && clock - rippleAt > GUNNERY.rippleEvery && fireOne(hull, GUNNERY.laid)) rippleAt = clock;
        } else {
            said = '';
        }

        for (const bolt of bolts) {
            if (!bolt.live) continue;
            const stride = GUNNERY.boltSpeed * dt;
            let struck = -1, near = stride;
            rocks.forEach((rock, i) => {
                const t = world.get(rock, Transform);
                const hit = rayToSphere(bolt.at, bolt.way, t.position, t.scale.x * 0.95);
                if (hit <= near) { near = hit; struck = i; }
            });
            const step = struck >= 0 ? Math.max(0, near) : stride;
            bolt.at = { x: bolt.at.x + bolt.way.x * step, y: bolt.at.y + bolt.way.y * step, z: bolt.at.z + bolt.way.z * step };
            bolt.flown += step;
            if (struck >= 0) {
                const burst = bursts[nextBurst++ % Math.max(1, bursts.length)];
                if (burst) {
                    burst.age = 0;
                    burst.live = true;
                    burst.size = 5 + world.get(rocks[struck]!, Transform).scale.x * 0.35;
                    world.update(burst.entity, Transform, (t) => { t.position = { ...bolt.at }; });
                }
                guns.hits++;
                puff(sparks, 70, bolt.at);
                puff(smoke, 16, bolt.at);
                guns.strike?.(struck, GUNNERY.damage);
            }
            bolt.live = struck < 0 && bolt.flown < GUNNERY.reach;
            const ahead = [bolt.at.x + bolt.way.x, bolt.at.y + bolt.way.y, bolt.at.z + bolt.way.z];
            world.update(bolt.entity, Transform, (t) => {
                t.position = { ...bolt.at };
                t.rotation = lookRotation([bolt.at.x, bolt.at.y, bolt.at.z], ahead);
                t.scale = bolt.live ? { x: 0.45, y: 0.45, z: 7 } : { x: 0.001, y: 0.001, z: 0.001 };
            });
        }

        for (const burst of bursts) {
            if (!burst.live) continue;
            burst.age += dt;
            const k = clamp(burst.age / 0.4, 0, 1);
            burst.live = k < 1;
            const size = burst.live ? burst.size * (0.35 + 0.65 * Math.sin(Math.PI * Math.sqrt(k))) : 0.001;
            world.update(burst.entity, Transform, (t) => { t.scale = { x: size, y: size, z: size }; });
            world.update(burst.light, Light, (l) => { l.intensity = burst.live ? 7 * (1 - k) * (1 - k) : 0; });
        }
    };
}
