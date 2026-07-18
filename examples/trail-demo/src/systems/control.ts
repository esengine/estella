import {
    defineSystem, Query, Mut, Res, Input, Transform, TrailRenderer, UICameraInfo,
    Trail,
} from 'esengine';
import type { TrailAPI, UICameraData } from 'esengine';
import { Comet, Dasher } from '../components';
import { DASHER_HOME } from '../config';

// Input → trail control. Two things happen here:
//   • component-level control: flipping TrailRenderer.emitting on the comet
//     stops recording — the streak stops growing and fades out where it was
//     left (recorded points still age); pressing E again resumes recording;
//   • resource-level control: the `Trail` resource's clear(entity) drops an
//     entity's recorded points instantly. C clears every trail; T pairs a
//     teleport with a clear so no streak spans the jump — the canonical use.
export const controlSystem = defineSystem(
    [
        Res(Input),
        Res(Trail),
        Res(UICameraInfo),
        Query(Mut(Transform), Mut(Dasher)),
        Query(Mut(TrailRenderer), Comet),
        Query(TrailRenderer),
    ],
    (input, trail: TrailAPI, camera: UICameraData, dashers, cometTrails, allTrails) => {
        if (camera.valid && input.isMouseButtonPressed(0)) {
            for (const [, transform, dash] of dashers) {
                dash.fromX = transform.position.x;
                dash.fromY = transform.position.y;
                dash.toX = camera.worldMouseX;
                dash.toY = camera.worldMouseY;
                dash.t = 0;
                dash.active = true;
            }
        }

        if (input.isKeyPressed('KeyE')) {
            for (const [, trailRenderer] of cometTrails) {
                trailRenderer.emitting = !trailRenderer.emitting;
            }
        }

        if (input.isKeyPressed('KeyC')) {
            for (const [entity] of allTrails) {
                trail.clear(entity);
            }
        }

        if (input.isKeyPressed('KeyT')) {
            for (const [entity, transform, dash] of dashers) {
                dash.active = false;
                transform.position.x = DASHER_HOME.x;
                transform.position.y = DASHER_HOME.y;
                trail.clear(entity);
            }
        }
    },
    { name: 'ControlSystem' },
);
