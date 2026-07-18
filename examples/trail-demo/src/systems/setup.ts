import {
    defineSystem, Commands, Transform, Sprite, TrailRenderer, Text,
    TextAlign, TextVerticalAlign, BlendMode,
} from 'esengine';
import type { Entity } from 'esengine';
import { Comet, Follower, Dasher, LabelOf } from '../components';
import { COMET, DASHER_HOME, COMET_SIZE, FOLLOWER_SIZE, DASHER_SIZE } from '../config';

// Spawns the three emitters, each pairing a small sprite with a differently
// tuned TrailRenderer, plus a floating world-space label per emitter (kept over
// its target by labelSystem). Trail recording itself is entirely engine-side.
export const setupSystem = defineSystem(
    [Commands()],
    (cmds) => {
        const label = (target: Entity, content: string) => {
            cmds.spawn()
                .insert(Transform, { position: { x: 0, y: 0, z: 0 } })
                .insert(Text, {
                    content,
                    fontSize: 15,
                    color: { r: 0.75, g: 0.78, b: 0.88, a: 0.9 },
                    align: TextAlign.Center,
                    verticalAlign: TextVerticalAlign.Bottom,
                })
                .insert(LabelOf, { target });
        };

        // Long additive streak: generous lifetime, wide head tapering to zero,
        // warm head fading to a fully transparent ember red.
        const comet = cmds.spawn('Comet')
            .insert(Transform, { position: { x: COMET.centerX, y: COMET.centerY, z: 0 } })
            .insert(Sprite, {
                size: { x: COMET_SIZE, y: COMET_SIZE },
                color: { r: 1, g: 0.85, b: 0.55, a: 1 },
                layer: 3,
            })
            .insert(TrailRenderer, {
                time: 1.4,
                minVertexDistance: 4,
                startWidth: 26,
                endWidth: 0,
                startColor: { r: 1, g: 0.72, b: 0.3, a: 0.9 },
                endColor: { r: 1, g: 0.2, b: 0.1, a: 0 },
                blendMode: BlendMode.Additive,
                layer: 2,
            })
            .insert(Comet)
            .id();
        label(comet, 'Comet — Lissajous, long additive trail (E freezes it)');

        // Cursor trail: default lifetime/spacing, slim cool ribbon, normal blend.
        const follower = cmds.spawn('Follower')
            .insert(Transform, { position: { x: 0, y: 0, z: 0 } })
            .insert(Sprite, {
                size: { x: FOLLOWER_SIZE, y: FOLLOWER_SIZE },
                color: { r: 0.55, g: 0.95, b: 1, a: 1 },
                layer: 3,
            })
            .insert(TrailRenderer, {
                startWidth: 14,
                endWidth: 2,
                startColor: { r: 0.45, g: 0.9, b: 1, a: 0.85 },
                endColor: { r: 0.15, g: 0.35, b: 1, a: 0 },
                layer: 2,
            })
            .insert(Follower)
            .id();
        label(follower, 'Follower — chases the cursor');

        // Dash burst: very short lifetime with a wide head, so the streak is a
        // bright slash that vanishes almost immediately. Dense spacing keeps the
        // ribbon smooth over the fast 0.14 s flight.
        const dasher = cmds.spawn('Dasher')
            .insert(Transform, { position: { x: DASHER_HOME.x, y: DASHER_HOME.y, z: 0 } })
            .insert(Sprite, {
                size: { x: DASHER_SIZE, y: DASHER_SIZE },
                color: { r: 0.85, g: 0.7, b: 1, a: 1 },
                layer: 3,
            })
            .insert(TrailRenderer, {
                time: 0.25,
                minVertexDistance: 2,
                startWidth: 44,
                endWidth: 6,
                startColor: { r: 1, g: 1, b: 1, a: 0.95 },
                endColor: { r: 0.6, g: 0.3, b: 1, a: 0 },
                blendMode: BlendMode.Additive,
                layer: 2,
            })
            .insert(Dasher)
            .id();
        label(dasher, 'Dasher — click to dash (T teleports home + clear)');
    },
    { name: 'SetupSystem' },
);
