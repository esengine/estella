import {
    addPlugin, defineSystem, GetWorld, Res, Time, Transform, MeshRenderer, ParticleEmitter, ParticleForceField, Light,
    Material, Particle, Playthrough, CameraDirector, shakeCamera,
} from 'esengine';
import type { Entity, World } from 'esengine';
import { CHARGE, PERIOD, CORE_Y, clamp01, easeOutCubic, easeInCubic, smooth, shockRadius, chargeLevel, heatAfter } from './timeline';

addPlugin({
    name: 'vfx-showcase',
    build(app) {
        const facts = { ready: false, frame: 0, time: 0, phase: 'charge', blasts: 0 };
        app.insertResource(Playthrough, { facts });
        const ids = new Map<string, Entity>();
        let clock = 0;
        let cycle = -1;
        let fired = false;

        const get = (world: World, name: string): Entity => {
            const known = ids.get(name);
            if (known !== undefined) return known;
            const found = world.findEntityByName(name);
            if (found === null) throw new Error(`vfx-showcase entity missing: ${name}`);
            ids.set(name, found);
            return found;
        };
        const materialOf = (world: World, name: string): number => world.get(get(world, name), MeshRenderer).material;
        const scale = (world: World, name: string, x: number, y: number, z: number): void => {
            const e = get(world, name);
            const t = world.get(e, Transform);
            t.scale = { x, y, z };
            world.insert(e, Transform, t);
        };
        const tint = (world: World, name: string, alpha: number): void => {
            const e = get(world, name);
            const m = world.get(e, MeshRenderer);
            world.insert(e, MeshRenderer, { ...m, color: { r: 1, g: 1, b: 1, a: alpha } });
        };
        const rate = (world: World, name: string, value: number): void => {
            const e = get(world, name);
            const p = world.get(e, ParticleEmitter);
            if (p.rate !== value) world.insert(e, ParticleEmitter, { ...p, rate: value });
        };
        const light = (world: World, name: string, intensity: number): void => {
            const e = get(world, name);
            world.insert(e, Light, { ...world.get(e, Light), intensity });
        };
        const field = (world: World, name: string, enabled: boolean): void => {
            const e = get(world, name);
            const f = world.get(e, ParticleForceField);
            if (f.enabled !== enabled) world.insert(e, ParticleForceField, { ...f, enabled });
        };

        app.addSystem(defineSystem([GetWorld(), Res(Time), Res(Particle), Res(CameraDirector)], (world, time, particles, director) => {
            if (world.findEntityByName('Camera') === null) return;
            const dt = Math.min(time.delta, 0.05);
            clock += dt;
            const lap = Math.floor(clock / PERIOD);
            const t = clock - lap * PERIOD;
            if (lap !== cycle) { cycle = lap; fired = false; }
            const charging = t < CHARGE;
            const since = t - CHARGE;
            const level = chargeLevel(t);

            field(world, 'Pull', charging);
            field(world, 'Swirl', charging);
            rate(world, 'Gather', charging ? Math.round(40 + 420 * level) : 0);
            rate(world, 'Motes', charging ? Math.round(10 + 40 * level) : 0);
            rate(world, 'Mist', charging ? 26 : 0);
            rate(world, 'Haze', !charging && since > 0.25 && since < 2.6 ? 16 : 0);

            const core = materialOf(world, 'Core');
            const pulse = 1 + 0.06 * Math.sin(clock * (6 + 22 * level)) * level;
            let coreSize = 0.001;
            if (charging) coreSize = (0.2 + 1.2 * easeOutCubic(level)) * pulse;
            else if (since < 0.12) coreSize = 1.4 + 6 * (since / 0.12);
            scale(world, 'Core', coreSize / 100, coreSize / 100, coreSize / 100);
            Material.setUniform(core, 'u_intensity', charging ? 0.3 + 0.9 * level * level : since < 0.12 ? 8 * (1 - since / 0.12) : 0);
            Material.setUniform(core, 'u_flow', 0.8 + 3.2 * level);
            Material.setUniform(core, 'u_instability', charging ? smooth(0.55, 1, level) : 1);

            const rune = materialOf(world, 'Rune');
            const runeFade = charging ? 1 : clamp01(1 - since / 0.3);
            Material.setUniform(rune, 'u_reveal', charging ? clamp01(t / 1.4) : 1);
            Material.setUniform(rune, 'u_spin', clock * 0.35 + level * level * 3);
            Material.setUniform(rune, 'u_intensity', (1.2 + 6.5 * level * level) * runeFade + (charging ? 0 : 26 * clamp01(1 - since / 0.2)));

            light(world, 'CoreLight', charging ? (0.4 + 5.2 * level * level) * pulse : 0);
            light(world, 'BlastLight', charging ? 0 : 30 * Math.exp(-since * 9) + 5 * heatAfter(since));

            const reach = charging ? 0 : shockRadius(since);
            const shockFade = charging ? 0 : clamp01(1 - since / 0.95);
            scale(world, 'ShockGlow', Math.max(reach * 2, 0.1) / 100, 1, Math.max(reach * 2, 0.1) / 100);
            scale(world, 'ShockBend', Math.max(reach * 2.15, 0.1) / 100, 1, Math.max(reach * 2.15, 0.1) / 100);
            Material.setUniform(materialOf(world, 'ShockGlow'), 'u_intensity', 7 * shockFade * shockFade);
            tint(world, 'ShockBend', Math.min(1, easeInCubic(shockFade) * 3));

            const scorch = materialOf(world, 'Scorch');
            Material.setUniform(scorch, 'u_heat', charging ? 0 : heatAfter(since));
            Material.setUniform(scorch, 'u_soot', charging ? clamp01(1 - t / 1.2) * (cycle > 0 ? 1 : 0) : clamp01(since / 0.15));

            if (!charging && !fired) {
                fired = true;
                facts.blasts++;
                const at = { x: 0, y: CORE_Y, z: 0 };
                const up = { x: 0, y: 1, z: 0 };
                particles.emitAt(get(world, 'Flash'), 2, at);
                particles.emitAt(get(world, 'Flare'), 1, at);
                particles.emitAt(get(world, 'AirShock'), 1, at);
                particles.emitAt(get(world, 'Sparks'), 420, { x: 0, y: 1.4, z: 0 }, { normal: up });
                particles.emitAt(get(world, 'Embers'), 300, { x: 0, y: 2, z: 0 });
                particles.emitAt(get(world, 'Fireball'), 44, { x: 0, y: 2, z: 0 });
                particles.emitAt(get(world, 'Smoke'), 90, { x: 0, y: 1.8, z: 0 });
                particles.emitAt(get(world, 'DustRing'), 110, { x: 0, y: 0.5, z: 0 });
                shakeCamera(director, { amplitude: 0.35, rotation: 0.012, frequency: 26, duration: 0.7 });
            }

            const camera = get(world, 'Camera');
            const cam = world.get(camera, Transform);
            const orbit = Math.sin(clock * 0.21) * 0.32;
            const distance = 12.2 - 1.2 * easeOutCubic(level) + (charging ? 0 : 1.8 * easeOutCubic(clamp01(since / 0.6)) * clamp01(1 - (since - 2.2) / 2));
            const height = 3.6 + 0.5 * Math.sin(clock * 0.13);
            cam.position = { x: Math.sin(orbit) * distance, y: height, z: Math.cos(orbit) * distance };
            const pitch = Math.atan2(2.9 - height, distance);
            cam.rotation = {
                x: Math.cos(orbit / 2) * Math.sin(pitch / 2), y: Math.sin(orbit / 2) * Math.cos(pitch / 2),
                z: -Math.sin(orbit / 2) * Math.sin(pitch / 2), w: Math.cos(orbit / 2) * Math.cos(pitch / 2),
            };
            world.insert(camera, Transform, cam);

            facts.ready = true;
            facts.frame++;
            facts.time = t;
            facts.phase = charging ? 'charge' : since < 1 ? 'blast' : 'embers';
        }));
    },
});
