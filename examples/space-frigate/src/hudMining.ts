import { Assets, Light, Material, MeshRenderer, Particle, ParticleEmitter, Transform, instantiatePrefab } from 'esengine';
import type { App, Entity, World } from 'esengine';
import { clamp, lookRotation } from './flight';
import { guns } from './gunnery';
import { helm, turnBy } from './helm';
import { AMBER, hullBlocks, pad, type Frame, type Log, type Rock } from './hudKit';
import type { TargetProbe } from './hudTargets';
import { FIELD_HALF_LENGTH, ship } from './shipState';

const FX = 'assets/fx/mining.esprefab';
const NO_TURRET = [{ at: { x: 0, y: 5.4, z: 13 }, bears: true }];
const PLUME_LENGTH = 11;

export const MINING = { range: 1500, capacity: 40, drain: 0.15, recharge: 0.055, heating: 0.13, cooling: 0.11 };

export const ROCK_CLASSES = [
    { code: 'C', name: 'CARBONACEOUS', worth: 0.3 },
    { code: 'S', name: 'SILICATE', worth: 0.5 },
    { code: 'M', name: 'IRON-NICKEL', worth: 0.9 },
] as const;

export const rockClass = (index: number): (typeof ROCK_CLASSES)[number] => ROCK_CLASSES[[0, 1, 0, 2, 1, 0, 1, 2, 0, 1][index % 10]!]!;

export const mining = {
    ready: false, armed: false, firing: false, overheated: false, capacitor: 1, heat: 0, hold: 0, delivered: 0, broken: 0, target: -1, reason: '',
    integrity: [] as number[],
};

export function installMining(app: App, world: World, rocks: readonly Rock[], probe: TargetProbe, log: Log): (frame: Frame) => void {
    mining.integrity = rocks.map(() => 1);
    const sizes = rocks.map((rock) => world.get(rock.entity, Transform).scale.x);
    let fx: { beam: Entity; muzzle: Entity; impact: Entity; glow: Entity; sparks: Entity; debris: Entity } | null = null;
    const assets = app.getResource(Assets);
    void assets.loadPrefab(FX).then(async (prefab) => {
        await instantiatePrefab(world, prefab.data as Parameters<typeof instantiatePrefab>[1], { assets });
        const find = (name: string): Entity => {
            const e = world.findEntityByName(name);
            if (e === null) throw new Error(`space-frigate mining effect missing: ${name}`);
            return e;
        };
        fx = { beam: find('MiningBeam'), muzzle: find('MiningMuzzle'), impact: find('MiningImpact'), glow: find('MiningGlow'), sparks: find('MiningSparks'), debris: find('MiningDebris') };
        mining.ready = true;
    }, (err: unknown) => console.error(`space-frigate mining effect did not load: ${err instanceof Error ? err.message : String(err)}`));

    const shipRoot = world.findEntityByName('Ship');
    let said = '', respawns = 0, pressed = false;
    const note = (text: string, tone?: number): void => { if (said !== text) { said = text; if (text) log.say(text, tone); } };
    const rate = (e: Entity, perSecond: number): void => {
        const emitter = world.get(e, ParticleEmitter);
        if (emitter.rate !== perSecond) world.update(e, ParticleEmitter, (p) => { p.rate = perSecond; });
    };
    const shine = (e: Entity, intensity: number): void => { world.update(e, Light, (l) => { l.intensity = intensity; }); };
    const put = (e: Entity, at: readonly number[]): void => { world.update(e, Transform, (t) => { t.position = { x: at[0]!, y: at[1]!, z: at[2]! }; }); };
    const shrink = (index: number): void => {
        const left = clamp(mining.integrity[index]!, 0, 1);
        world.update(rocks[index]!.entity, Transform, (t) => { const s = sizes[index]! * (0.62 + 0.38 * left); t.scale = { x: s, y: s, z: s }; });
    };
    const shatter = (index: number, said: string): void => {
        const rock = rocks[index]!;
        const at = world.get(rock.entity, Transform).position;
        mining.broken++;
        if (fx) {
            put(fx.debris, [at.x, at.y, at.z]);
            app.getResource(Particle).emitAt(fx.debris, 220, { x: at.x, y: at.y, z: at.z });
        }
        log.say(said);
        respawns++;
        const spin = Math.sin(index * 12.9898 + respawns * 78.233) * 43758.5453, lane = spin - Math.floor(spin);
        mining.integrity[index] = 1;
        const ahead = turnBy(helm.level, { x: (lane - 0.5) * 1800, y: -150 + ((lane * 7.3) % 1) * 400, z: FIELD_HALF_LENGTH - 80 });
        const within = (v: number, half: number): number => Math.max(-half, Math.min(half, v));
        world.update(rock.entity, Transform, (t) => {
            t.position = { x: within(ahead.x, FIELD_HALF_LENGTH * 1.15), y: within(ahead.y, FIELD_HALF_LENGTH * 0.65), z: within(ahead.z, FIELD_HALF_LENGTH - 20) };
            t.scale = { x: sizes[index]!, y: sizes[index]!, z: sizes[index]! };
        });
        if (probe.selected === index) probe.release = true;
    };
    guns.strike = (index, amount) => {
        const rock = rocks[index];
        if (!rock) return;
        if (rock.big) { log.say(`ROCK ${pad(index + 1, 2)} HIT  NO EFFECT`); return; }
        mining.integrity[index] = mining.integrity[index]! - amount / (1 + sizes[index]! * 0.08);
        if (mining.integrity[index]! <= 0) shatter(index, `ROCK ${pad(index + 1, 2)} DESTROYED`);
        else { shrink(index); log.say(`ROCK ${pad(index + 1, 2)} HIT  ${Math.round(clamp(mining.integrity[index]!, 0, 1) * 100)} %`); }
    };

    return (frame) => {
        const index = probe.selected;
        const rock = index >= 0 ? rocks[index]! : null;
        const there = rock ? world.get(rock.entity, Transform).position : null;
        const range = there ? Math.hypot(there.x, there.y, there.z) : Infinity;
        const key = frame.held('KeyF');
        if (key && !pressed) mining.armed = !mining.armed;
        pressed = key;
        if (rock === null || guns.view) mining.armed = false;
        const wants = mining.armed && rock !== null && probe.locked;
        if (mining.overheated && mining.heat < 0.45) mining.overheated = false;
        let reason = '';
        if (wants) {
            if (rock!.big) reason = 'TOO LARGE TO MINE';
            else if (range > MINING.range) reason = 'OUT OF RANGE';
            else if (mining.hold >= MINING.capacity) reason = 'HOLD FULL';
            else if (mining.overheated) reason = 'EMITTER COOLING';
            else if (mining.capacitor < (mining.firing ? 0.03 : 0.2)) reason = 'CAPACITOR LOW';
        }
        const firing = wants && reason === '' && fx !== null;
        if (wants && reason) note(`MINING HELD  ${reason}`, AMBER);
        else if (firing && !mining.firing) note(`MINING ROCK ${pad(index + 1, 2)}`);
        else if (!wants) said = '';
        mining.firing = firing;
        mining.reason = reason;
        mining.target = firing ? index : -1;

        const drive = ship.throttle * ship.throttle;
        if (firing) {
            mining.capacitor = Math.max(0, mining.capacitor - MINING.drain * frame.dt);
            mining.heat = Math.min(1, mining.heat + MINING.heating * frame.dt);
            if (mining.heat >= 1) { mining.overheated = true; log.say('EMITTER OVERHEATED', AMBER); }
            mining.integrity[index] = mining.integrity[index]! - frame.dt / (2.4 + sizes[index]! * 0.2);
        } else {
            mining.capacitor = Math.min(1 - 0.35 * drive, mining.capacitor + MINING.recharge * frame.dt * (1 - 0.5 * drive));
            mining.capacitor = Math.max(0, mining.capacitor);
            mining.heat = Math.max(0, mining.heat - MINING.cooling * frame.dt);
        }

        if (!fx) return;
        const base = shipRoot === null ? { x: 0, y: 0, z: 0 } : world.get(shipRoot, Transform).position;
        if (firing && there) {
            const target = [there.x, there.y, there.z];
            const far = (e: { x: number; y: number; z: number }): number => Math.hypot(e.x - there.x, e.y - there.y, e.z - there.z);
            const mounts = (guns.turrets.length > 0 ? guns.turrets.map((t) => ({ at: t.mouth, bears: t.onTarget })) : NO_TURRET).map((m) => ({ at: turnBy(helm.attitude, m.at), bears: m.bears }));
            const chosen = mounts.sort((a, b) => Number(b.bears) - Number(a.bears) || Number(hullBlocks(a.at, there)) - Number(hullBlocks(b.at, there)) || far(a.at) - far(b.at))[0]!.at;
            const from = [chosen.x + base.x, chosen.y + base.y, chosen.z + base.z];
            const span = Math.hypot(target[0]! - from[0]!, target[1]! - from[1]!, target[2]! - from[2]!);
            const reach = Math.max(1, span - sizes[index]! * 0.7);
            const hit = from.map((v, axis) => v + ((target[axis]! - v) * reach) / span);
            const wide = (0.75 + 0.12 * Math.sin(frame.time * 31)) * (0.6 + 0.4 * clamp(mining.capacitor * 3, 0, 1));
            world.update(fx.beam, Transform, (t) => {
                t.position = { x: from[0]!, y: from[1]!, z: from[2]! };
                t.rotation = lookRotation(from, target);
                t.scale = { x: wide, y: wide, z: reach / PLUME_LENGTH };
            });
            const beam = world.get(fx.beam, MeshRenderer);
            if (!beam.enabled) world.update(fx.beam, MeshRenderer, (m) => { m.enabled = true; });
            Material.setUniform(beam.material, 'u_strength', 7 + 3 * Math.sin(frame.time * 23) + 4 * mining.heat);
            put(fx.muzzle, from);
            shine(fx.muzzle, 1.6 + 0.5 * Math.sin(frame.time * 29));
            for (const e of [fx.impact, fx.glow, fx.sparks]) put(e, hit);
            shine(fx.impact, 5 + 2 * Math.sin(frame.time * 37));
            rate(fx.glow, 70);
            rate(fx.sparks, 110);
            shrink(index);
            if (mining.integrity[index]! <= 0) {
                const kind = rockClass(index);
                const tonnes = Math.min(MINING.capacity - mining.hold, Math.round(sizes[index]! * kind.worth * 10) / 10);
                mining.hold = Math.round((mining.hold + tonnes) * 10) / 10;
                shatter(index, `ROCK ${pad(index + 1, 2)} BROKEN  +${tonnes.toFixed(1)} T ${kind.name}`);
                if (mining.hold >= MINING.capacity) log.say(`HOLD FULL  RETURN TO ${helm.gateName}`, AMBER);
                probe.release = true;
                mining.armed = false;
            }
        } else {
            const beam = world.get(fx.beam, MeshRenderer);
            if (beam.enabled) {
                world.update(fx.beam, MeshRenderer, (m) => { m.enabled = false; });
                shine(fx.muzzle, 0);
                shine(fx.impact, 0);
            }
            rate(fx.glow, 0);
            rate(fx.sparks, 0);
        }
    };
}
