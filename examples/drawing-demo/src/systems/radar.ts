import {
    defineSystem, Query, Mut, Res, Time, Transform,
    Draw, registerDrawCallback,
} from 'esengine';
import { Drone } from '../components';
import { RADAR, DRONES } from '../config';

// The Draw tier: an immediate-mode debug overlay. Every shape below is
// re-issued from scratch each frame inside a draw callback — Draw batches the
// commands and clears them after the frame, so animation is just "draw with
// different numbers next frame".

// The draw callback only receives `elapsed`, so the system that moves the
// drones snapshots their positions here for the overlay to read.
const blips: { x: number; y: number }[] = [];

export const droneSystem = defineSystem(
    [Query(Mut(Transform), Drone), Res(Time)],
    (query, time) => {
        blips.length = 0;
        const t = time.elapsed;
        for (const [_entity, transform, drone] of query) {
            const angle = t * (0.4 + drone.seed * 0.17) + drone.seed * 2.1;
            const r = RADAR.radius * (0.45 + 0.32 * Math.sin(t * 0.6 + drone.seed * 2.7));
            const x = RADAR.center.x + Math.cos(angle) * r;
            const y = RADAR.center.y + Math.sin(angle) * r;
            transform.position.x = x;
            transform.position.y = y;
            blips.push({ x, y });
        }
    },
    { name: 'DroneSystem' },
);

function drawRadar(elapsed: number): void {
    const { center, radius, color } = RADAR;

    for (let i = 1; i <= RADAR.rings; i++) {
        Draw.circleOutline(center, (radius * i) / RADAR.rings,
            { ...color, a: 0.3 }, 1, 48);
    }
    Draw.line({ x: center.x - radius, y: center.y }, { x: center.x + radius, y: center.y },
        { ...color, a: 0.18 });
    Draw.line({ x: center.x, y: center.y - radius }, { x: center.x, y: center.y + radius },
        { ...color, a: 0.18 });

    // Expanding pulse ring that fades as it grows.
    const pulse = (elapsed * 0.45) % 1;
    Draw.circleOutline(center, radius * pulse, { ...color, a: 0.5 * (1 - pulse) }, 2, 48);

    // Sweep line with a trail of ghost lines fading behind it.
    const sweep = -elapsed * RADAR.sweepSpeed;
    for (let i = 0; i < RADAR.trailSteps; i++) {
        const a = sweep + i * (RADAR.trailSpread / RADAR.trailSteps);
        const alpha = (1 - i / RADAR.trailSteps) * 0.85;
        Draw.line(center,
            { x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius },
            { ...color, a: alpha }, i === 0 ? 2 : 1);
    }
    Draw.circle(center, 5, color);

    // Bounding boxes over the drone sprites — the classic debug-overlay use.
    const box = DRONES.size + DRONES.boxMargin * 2;
    const ping = 1 + 0.15 * Math.sin(elapsed * 5);
    for (const blip of blips) {
        Draw.rectOutline(blip, { x: box, y: box }, DRONES.boxColor, 2);
        Draw.circleOutline(blip, box * 0.85 * ping, { ...DRONES.boxColor, a: 0.35 }, 1, 24);
    }
}

// Draw callbacks run inside the render pass, after the scene, with the active
// camera's view-projection already set — coordinates are world-space.
registerDrawCallback('radar-overlay', drawRadar);
