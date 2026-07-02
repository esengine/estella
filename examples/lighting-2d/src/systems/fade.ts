import {
    defineSystem, Query, Mut, Res, Time, Commands,
    Sprite, Light2D, ShadowCaster2D,
} from 'esengine';
import { Fading } from '../components';
import { PLACED_LIGHT_INTENSITY, FADE_DURATION } from '../config';

// Dims placed entities to nothing over FADE_DURATION, then despawns them. The
// two queries are disjoint: a placed light has Light2D (no ShadowCaster2D), an
// obstacle has ShadowCaster2D (no Light2D), so each entity is ticked exactly
// once. The torch never gets a Fading component, so it is never matched here.
export const fadeSystem = defineSystem(
    [
        Query(Mut(Fading), Mut(Sprite), Mut(Light2D)),
        Query(Mut(Fading), Mut(Sprite), ShadowCaster2D),
        Res(Time),
        Commands(),
    ],
    (fadingLights, fadingObstacles, time, cmds) => {
        for (const [entity, fading, sprite, light] of fadingLights) {
            fading.remaining -= time.delta;
            const t = Math.max(0, fading.remaining / FADE_DURATION);
            light.intensity = PLACED_LIGHT_INTENSITY * t;
            sprite.color.a = t;
            if (fading.remaining <= 0) cmds.despawn(entity);
        }
        for (const [entity, fading, sprite] of fadingObstacles) {
            fading.remaining -= time.delta;
            const t = Math.max(0, fading.remaining / FADE_DURATION);
            sprite.color.a = t;
            if (fading.remaining <= 0) cmds.despawn(entity);
        }
    },
    { name: 'FadeSystem' },
);
