import { addPlugin, defineSystem, GetWorld, Res, Time, Input, Transform, MeshRenderer, Light, Material, Playthrough } from 'esengine';
import type { Entity, World } from 'esengine';
import { SHOTS, SHOT_SECONDS, clamp, eyeOf, lookRotation, tourOrbit, type Orbit } from './flight';
import { installHud } from './hud';
import { ship, TOP_SPEED } from './shipState';

const PLUMES = [
    { name: 'PlumeL', width: 4.0, length: 2.3 },
    { name: 'PlumeR', width: 4.0, length: 2.3 },
    { name: 'PlumeNL', width: 3.0, length: 1.7 },
    { name: 'PlumeNR', width: 3.0, length: 1.7 },
] as const;

const GLOWS = ['EngineGlowL', 'EngineGlowR', 'EngineGlowNL', 'EngineGlowNR'] as const;

addPlugin({
    name: 'space-frigate',
    build(app) {
        const facts = { ready: false, frame: 0, time: 0, throttle: 0, tour: true, shot: 0, eyeX: 0, eyeY: 0, eyeZ: 0 };
        app.insertResource(Playthrough, { facts });
        installHud(app);
        const ids = new Map<string, Entity>();
        let clock = 0;
        let wanted = 0.65;
        let throttle = 0.65;
        let tour = true;
        let hand: Orbit = { ...SHOTS[0] };
        let grabbed = false;
        let last = { x: 0, y: 0 };

        const get = (world: World, name: string): Entity => {
            const known = ids.get(name);
            if (known !== undefined) return known;
            const found = world.findEntityByName(name);
            if (found === null) throw new Error(`space-frigate entity missing: ${name}`);
            ids.set(name, found);
            return found;
        };

        app.addSystem(defineSystem([GetWorld(), Res(Time), Res(Input)], (world, time, input) => {
            if (world.findEntityByName('Camera') === null) return;
            const dt = Math.min(time.delta, 0.05);
            clock += dt;

            const push = Number(input.isKeyDown('KeyW') || input.isKeyDown('ArrowUp')) - Number(input.isKeyDown('KeyS') || input.isKeyDown('ArrowDown'));
            wanted = clamp(wanted + push * dt * 0.7, 0, 1);
            throttle += (wanted - throttle) * Math.min(1, dt * 2.2);

            for (const plume of PLUMES) {
                const e = get(world, plume.name);
                const t = world.get(e, Transform);
                const wide = plume.width * (0.8 + 0.2 * throttle);
                t.scale = { x: wide, y: wide, z: plume.length * (0.22 + 1.05 * throttle) };
                world.insert(e, Transform, t);
            }
            Material.setUniform(world.get(get(world, 'PlumeL'), MeshRenderer).material, 'u_strength', 0.5 + 4 * throttle * throttle);
            for (const name of GLOWS) {
                const e = get(world, name);
                world.insert(e, Light, { ...world.get(e, Light), intensity: 0.1 + 0.7 * throttle * throttle });
            }

            const held = input.isMouseButtonDown(0);
            const pointer = input.getMousePosition();
            const drag = held && grabbed ? { x: pointer.x - last.x, y: pointer.y - last.y } : { x: 0, y: 0 };
            grabbed = held;
            last = { x: pointer.x, y: pointer.y };
            const turn = Number(input.isKeyDown('KeyD') || input.isKeyDown('ArrowRight')) - Number(input.isKeyDown('KeyA') || input.isKeyDown('ArrowLeft'));
            const tilt = Number(input.isKeyDown('KeyE')) - Number(input.isKeyDown('KeyQ'));
            const wheel = input.getScrollDelta().y;
            const live = tour ? tourOrbit(clock) : hand;
            if (drag.x !== 0 || drag.y !== 0 || turn !== 0 || tilt !== 0 || wheel !== 0) {
                if (tour) hand = { ...live };
                tour = false;
            }
            for (let n = 0; n < SHOTS.length; n++) {
                if (input.isKeyPressed(`Digit${n + 1}`)) { hand = { ...SHOTS[n]! }; tour = false; }
            }
            if (input.isKeyPressed('Space')) {
                tour = !tour;
                if (!tour) hand = { ...live };
            }
            if (!tour) {
                hand.yaw += turn * dt * 0.9 - drag.x * 0.005;
                hand.pitch = clamp(hand.pitch + tilt * dt * 0.6 + drag.y * 0.004, -1.2, 1.2);
                hand.distance = clamp(hand.distance * (1 + wheel * 0.001), 22, 260);
            }
            const orbit = tour ? tourOrbit(clock) : hand;
            const { eye, target } = eyeOf(orbit);
            const camera = get(world, 'Camera');
            const cam = world.get(camera, Transform);
            cam.position = { x: eye[0], y: eye[1], z: eye[2] };
            cam.rotation = lookRotation(eye, target);
            world.insert(camera, Transform, cam);

            const root = get(world, 'Ship');
            const hull = world.get(root, Transform);
            const roll = Math.sin(clock * 0.31) * 0.012, nod = Math.sin(clock * 0.23 + 1.3) * 0.006;
            hull.rotation = { x: Math.sin(nod / 2), y: 0, z: Math.sin(roll / 2), w: Math.cos(nod / 2) * Math.cos(roll / 2) };
            hull.position = { x: 0, y: Math.sin(clock * 0.19) * 0.35, z: 0 };
            world.insert(root, Transform, hull);

            ship.time = clock;
            ship.throttle = throttle;
            ship.wanted = wanted;
            ship.speed += (throttle * TOP_SPEED - ship.speed) * Math.min(1, dt * 0.8);
            ship.tour = tour;
            ship.shot = Math.floor(clock / SHOT_SECONDS) % SHOTS.length;

            facts.ready = true;
            facts.frame++;
            facts.time = clock;
            facts.throttle = throttle;
            facts.tour = tour;
            facts.shot = Math.floor(clock / SHOT_SECONDS) % SHOTS.length;
            facts.eyeX = eye[0];
            facts.eyeY = eye[1];
            facts.eyeZ = eye[2];
        }));
    },
});
