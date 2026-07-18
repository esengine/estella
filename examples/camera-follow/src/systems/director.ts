import {
    defineSystem, Query, Res, Input, Camera,
    CameraDirector, FollowTarget, setViewTarget, shakeCamera, BlendCurve,
} from 'esengine';
import { OverviewCam } from '../components';
import { BLEND_TIME, SHAKE } from '../config';

// Space  → shakeCamera: a decaying perturbation on the rendered view only (the
//          camera Transform is untouched, so the view always recovers).
// 1 / 2  → setViewTarget: hand the view to the follow camera / the overview
//          camera, easing position + zoom over BLEND_TIME seconds.
export const cameraDirectorSystem = defineSystem(
    [Res(Input), Res(CameraDirector), Query(Camera, FollowTarget), Query(Camera, OverviewCam)],
    (input, director, followCams, overviewCams) => {
        if (input.isKeyPressed('Space')) {
            shakeCamera(director, SHAKE);
        }
        if (input.isKeyPressed('Digit1')) {
            for (const [entity] of followCams) {
                setViewTarget(director, entity, { time: BLEND_TIME, curve: BlendCurve.EaseInOut });
            }
        }
        if (input.isKeyPressed('Digit2')) {
            for (const [entity] of overviewCams) {
                setViewTarget(director, entity, { time: BLEND_TIME, curve: BlendCurve.EaseInOut });
            }
        }
    },
    { name: 'CameraDirectorControls' },
);
