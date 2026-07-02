import {
    defineSystem, Query, Res, Transform, Input, UICameraInfo,
    Tween, TweenAPI, TweenTarget, EasingType,
} from 'esengine';
import type { UICameraData } from 'esengine';
import { Comet } from '../components';
import { COMET_DURATION, COMET_SIZE, COMET_POP } from '../config';

// Left-click flings the comet to the cursor: cancel whatever it was doing, then
// start fresh position tweens (from its live position) with an overshooting ease,
// plus a parallel elastic size pop for arrival juice. Clicking mid-flight simply
// retargets — cancelAll clears the in-progress tweens first.
export const cometSystem = defineSystem(
    [Res(Tween), Res(Input), Res(UICameraInfo), Query(Transform, Comet)],
    (tween: TweenAPI, input, camera: UICameraData, comets) => {
        if (!camera.valid || !input.isMouseButtonPressed(0)) return;

        const targetX = camera.worldMouseX;
        const targetY = camera.worldMouseY;
        for (const [entity, transform] of comets) {
            const fromX = transform.position.x;
            const fromY = transform.position.y;
            tween.cancelAll(entity);
            tween.to(entity, TweenTarget.PositionX, fromX, targetX, COMET_DURATION, { easing: EasingType.EaseOutBack });
            tween.to(entity, TweenTarget.PositionY, fromY, targetY, COMET_DURATION, { easing: EasingType.EaseOutBack });
            tween.parallel([
                tween.to(entity, TweenTarget.SizeX, COMET_POP, COMET_SIZE, COMET_DURATION, { easing: EasingType.EaseOutElastic }),
                tween.to(entity, TweenTarget.SizeY, COMET_POP, COMET_SIZE, COMET_DURATION, { easing: EasingType.EaseOutElastic }),
            ]);
        }
    },
    { name: 'CometSystem' },
);
