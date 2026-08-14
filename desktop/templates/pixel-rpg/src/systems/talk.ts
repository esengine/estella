import { defineSystem, Query, Mut, Res, Input, Transform, Text } from 'esengine';
import { Player, SayLine, Talkable } from '../components';

/** The nearest thing in range with something to say, or null. */
function nearest(
    at: { x: number; y: number },
    talkers: Iterable<[unknown, { position: { x: number; y: number } }, { line: string; range: number }]>,
): string | null {
    let best: string | null = null;
    let bestDistance = Infinity;
    for (const [, transform, talkable] of talkers) {
        const d = Math.hypot(transform.position.x - at.x, transform.position.y - at.y);
        if (d <= talkable.range && d < bestDistance) {
            bestDistance = d;
            best = talkable.line;
        }
    }
    return best;
}

export const talkSystem = defineSystem(
    [Query(Transform, Player), Query(Transform, Talkable), Query(SayLine, Mut(Text)), Res(Input)],
    (players, talkers, labels, input) => {
        const player = [...players][0];
        if (!player) return;
        const line = nearest(player[1].position, talkers);

        for (const [, say, text] of labels) {
            const wanted = line === null
                ? say.idle
                : (input.isKeyDown('Space') ? line : 'Space to read.');
            if (text.content !== wanted) text.content = wanted;
        }
    },
    { name: 'TalkSystem' },
);
