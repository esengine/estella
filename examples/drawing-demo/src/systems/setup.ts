import { defineSystem, Commands, Transform, Sprite } from 'esengine';
import { Drone } from '../components';
import { RADAR, DRONES } from '../config';

// Spawns the radar's drone sprites — ordinary scene entities the immediate-mode
// overlay tracks. Everything else in the demo is drawn, not spawned.
export const setupSystem = defineSystem(
    [Commands()],
    (cmds) => {
        for (let i = 0; i < DRONES.count; i++) {
            cmds.spawn(`Drone${i}`)
                .insert(Transform, {
                    position: { x: RADAR.center.x, y: RADAR.center.y, z: 0 },
                })
                .insert(Sprite, {
                    size: { x: DRONES.size, y: DRONES.size },
                    color: DRONES.colors[i % DRONES.colors.length],
                    layer: 2,
                })
                .insert(Drone, { seed: i });
        }
    },
    { name: 'SetupSystem' },
);
