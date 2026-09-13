import {
    defineSystem, Commands, GetWorld, Transform, Text,
    TextAlign, TextVerticalAlign,
} from 'esengine';
import type { Entity, World } from 'esengine';
import { LabelOf } from '../components';

// The emitters are authored in the scene; this only adds the floating label
// each one carries (kept over its target by labelSystem).
const LABELS: ReadonlyArray<[string, string]> = [
    ['Comet', 'Comet — Lissajous, long additive trail (E freezes it)'],
    ['Follower', 'Follower — chases the cursor'],
    ['Dasher', 'Dasher — click to dash (T teleports home + clear)'],
];

let labelled = false;

export const setupSystem = defineSystem(
    [Commands(), GetWorld()],
    (cmds, world: World) => {
        if (labelled) return;
        const targets = LABELS.map(([name]) => world.findEntityByName(name));
        // The scene loads asynchronously; without its emitters there is nothing to
        // label and the next frame tries again.
        if (targets.some((t) => t === null)) return;
        labelled = true;

        for (const [i, [, content]] of LABELS.entries()) {
            cmds.spawn()
                .insert(Transform, { position: { x: 0, y: 0, z: 0 } })
                .insert(Text, {
                    content,
                    fontSize: 15,
                    color: { r: 0.75, g: 0.78, b: 0.88, a: 0.9 },
                    align: TextAlign.Center,
                    verticalAlign: TextVerticalAlign.Bottom,
                })
                .insert(LabelOf, { target: targets[i] as Entity });
        }
    },
    { name: 'SetupSystem' },
);
