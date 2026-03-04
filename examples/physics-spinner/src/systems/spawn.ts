import {
    defineSystem, Query, Mut, Commands,
    Transform, ShapeRenderer, ShapeType,
    RigidBody, BoxCollider, CircleCollider, CapsuleCollider, ChainCollider, BodyType,
} from 'esengine';
import { SpawnMarker } from '../components';

const BODY_COUNT = 6076;
const PPU = 100;
const GRID_LEFT = -23;
const GRID_RIGHT = 23;
const GRID_STEP = 0.5;
const GRID_START_Y = 2;
const ARENA_RADIUS = 40;
const ARENA_CENTER_Y = 32;
const ARENA_POINT_COUNT = 360;

function generateArenaPoints(): Array<{ x: number; y: number }> {
    const points: Array<{ x: number; y: number }> = [];
    const step = (-2 * Math.PI) / ARENA_POINT_COUNT;
    let cos = 1;
    let sin = 0;
    const rotCos = Math.cos(step);
    const rotSin = Math.sin(step);

    for (let i = 0; i < ARENA_POINT_COUNT; i++) {
        points.push({
            x: ARENA_RADIUS * cos,
            y: ARENA_RADIUS * sin + ARENA_CENTER_Y,
        });
        const newCos = cos * rotCos - sin * rotSin;
        const newSin = cos * rotSin + sin * rotCos;
        cos = newCos;
        sin = newSin;
    }
    return points;
}

export const spawnSystem = defineSystem(
    [Query(Mut(SpawnMarker)), Commands()],
    (query, cmds) => {
        for (const [_entity, marker] of query) {
            if (marker.spawned) continue;
            marker.spawned = true;

            cmds.spawn()
                .insert(Transform, { position: { x: 0, y: 0, z: 0 } })
                .insert(RigidBody, { bodyType: BodyType.Static })
                .insert(ChainCollider, {
                    points: generateArenaPoints(),
                    isLoop: true,
                    friction: 0.1,
                    restitution: 0.0,
                });

            let x = GRID_LEFT;
            let y = GRID_START_Y;

            for (let i = 0; i < BODY_COUNT; i++) {
                const px = x * PPU;
                const py = y * PPU;
                const remainder = i % 3;

                if (remainder === 0) {
                    const capsuleRadius = 0.25;
                    const capsuleHalfLen = 0.25;
                    const w = capsuleRadius * 2 * PPU;
                    const h = (capsuleHalfLen * 2 + capsuleRadius * 2) * PPU;
                    cmds.spawn()
                        .insert(Transform, { position: { x: px, y: py, z: 0 } })
                        .insert(ShapeRenderer, {
                            shapeType: ShapeType.Capsule,
                            size: { x: w, y: h },
                            color: { r: 0.9, g: 0.55, b: 0.2, a: 1 },
                        })
                        .insert(RigidBody, { bodyType: BodyType.Dynamic })
                        .insert(CapsuleCollider, {
                            radius: capsuleRadius,
                            halfHeight: capsuleHalfLen,
                            density: 0.25,
                            friction: 0.1,
                            restitution: 0.1,
                        });
                } else if (remainder === 1) {
                    const r = 0.35;
                    const d = r * 2 * PPU;
                    cmds.spawn()
                        .insert(Transform, { position: { x: px, y: py, z: 0 } })
                        .insert(ShapeRenderer, {
                            shapeType: ShapeType.Circle,
                            size: { x: d, y: d },
                            color: { r: 0.3, g: 0.7, b: 0.9, a: 1 },
                        })
                        .insert(RigidBody, { bodyType: BodyType.Dynamic })
                        .insert(CircleCollider, {
                            radius: r,
                            density: 0.25,
                            friction: 0.1,
                            restitution: 0.1,
                        });
                } else {
                    const half = 0.35;
                    const size = half * 2 * PPU;
                    cmds.spawn()
                        .insert(Transform, { position: { x: px, y: py, z: 0 } })
                        .insert(ShapeRenderer, {
                            shapeType: ShapeType.RoundedRect,
                            size: { x: size, y: size },
                            cornerRadius: 2,
                            color: { r: 0.2, g: 0.85, b: 0.4, a: 1 },
                        })
                        .insert(RigidBody, { bodyType: BodyType.Dynamic })
                        .insert(BoxCollider, {
                            halfExtents: { x: half, y: half },
                            density: 0.25,
                            friction: 0.1,
                            restitution: 0.1,
                        });
                }

                x += GRID_STEP;
                if (x >= GRID_RIGHT) {
                    x = GRID_LEFT;
                    y += GRID_STEP;
                }
            }
        }
    },
    { name: 'SpawnSystem' }
);
