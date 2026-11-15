import { addPlugin, defineSystem, Res, GetWorld, Input, Time, Transform, Playthrough } from 'esengine';

addPlugin({ name: 'last-signal-showcase', build(app) {
    const facts: Record<string, string | number | boolean> = { angle: 0.7, height: 0.32, distance: 11, spinning: true };
    app.insertResource(Playthrough, { facts });
    let angle = 0.7, pitch = 0.32, distance = 11, spinning = true;
    app.addSystem(defineSystem([Res(Input), Res(Time), GetWorld()], (input, time, world) => {
        if (input.isKeyPressed('Space')) spinning = !spinning;
        if (spinning) angle += time.unscaledDelta * 0.18;
        if (input.isKeyDown('KeyA')) angle -= time.unscaledDelta;
        if (input.isKeyDown('KeyD')) angle += time.unscaledDelta;
        if (input.isKeyDown('KeyW')) pitch = Math.min(1.2, pitch + time.unscaledDelta * 0.6);
        if (input.isKeyDown('KeyS')) pitch = Math.max(0.03, pitch - time.unscaledDelta * 0.6);
        distance = Math.min(40, Math.max(3, distance * (1 + input.getScrollDelta().y * 0.001)));
        const camera = world.findEntityByName('Camera');
        if (camera === null) return;
        const pose = world.get(camera, Transform);
        const target = { x: 0, y: 220, z: 0 };
        pose.position = {
            x: target.x + Math.sin(angle) * Math.cos(pitch) * distance * 100,
            y: target.y + Math.sin(pitch) * distance * 100,
            z: target.z + Math.cos(angle) * Math.cos(pitch) * distance * 100,
        };
        const yaw = { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
        const tilt = { x: Math.sin(-pitch / 2), y: 0, z: 0, w: Math.cos(-pitch / 2) };
        pose.rotation = {
            x: yaw.w * tilt.x + yaw.y * tilt.z, y: yaw.y * tilt.w, z: -yaw.y * tilt.x, w: yaw.w * tilt.w,
        };
        world.insert(camera, Transform, pose);
        facts.angle = angle; facts.height = pitch; facts.distance = distance; facts.spinning = spinning;
    }, { name: 'ShowcaseOrbit' }));
} });
