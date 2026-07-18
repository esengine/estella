import {
    defineSystem, Res,
    AnimatorController, AnimatorControllerAPI, type AnimatorControllerDef,
    SpriteAnimation, SpriteAnimationAPI,
} from 'esengine';
import {
    CLIP_IDLE, CLIP_WALK, CLIP_HOP, CONTROLLER,
    MOVE_ENTER, MOVE_EXIT, RUN_BLEND_AT,
} from '../config';
import { footsteps } from '../components';

// The character's state machine (Unity Animator model): a float `speed`
// parameter drives Idle↔Move, Move is a 1D blend that re-selects its clip as
// `speed` crosses a threshold (same walk clip, faster playback = run), and a
// `hop` trigger fires a non-looping clip whose end (exit time) auto-returns
// to Idle. The scene's Animator component references this by name.
const alienController: AnimatorControllerDef = {
    parameters: [
        { name: 'speed', type: 'float', default: 0 },
        { name: 'hop', type: 'trigger' },
    ],
    initialState: 'Idle',
    states: [
        {
            name: 'Idle',
            clip: CLIP_IDLE,
            transitions: [
                { to: 'Move', conditions: [{ param: 'speed', op: 'gt', value: MOVE_ENTER }] },
                { to: 'Hop', conditions: [{ param: 'hop', op: 'trigger' }] },
            ],
        },
        {
            name: 'Move',
            blend: {
                parameter: 'speed',
                thresholds: [
                    { value: 0, clip: CLIP_WALK, speed: 1.0 },
                    { value: RUN_BLEND_AT, clip: CLIP_WALK, speed: 1.9 },
                ],
            },
            transitions: [
                { to: 'Idle', conditions: [{ param: 'speed', op: 'lt', value: MOVE_EXIT }] },
                { to: 'Hop', conditions: [{ param: 'hop', op: 'trigger' }] },
            ],
        },
        {
            name: 'Hop',
            clip: CLIP_HOP,
            loop: false,
            // No conditions + exit time = advance when the clip finishes.
            transitions: [{ to: 'Idle', conditions: [], hasExitTime: true }],
        },
    ],
};

// One-time wiring that needs no assets: the controller (pure data) and the
// footstep listener (inert until events are attached below).
export const setupSystem = defineSystem(
    [Res(AnimatorController), Res(SpriteAnimation)],
    (ctrl: AnimatorControllerAPI, anim: SpriteAnimationAPI) => {
        ctrl.registerController(CONTROLLER, alienController);
        anim.onEventGlobal((event) => {
            if (event.name === 'footstep') footsteps.pending++;
        });
    },
    { name: 'SetupSystem' },
);

// Clip-dependent wiring. The scene preload streams .esanim clips in without
// blocking startup, so this retries each frame until both asset clips are
// registered, then arms once: builds the hop clip out of frames the asset
// clips already loaded (the second clip-authoring path — a code-registered
// SpriteAnimClip) and attaches the walk clip's footstep frame events.
let clipsWired = false;
export const wireClipsSystem = defineSystem(
    [Res(SpriteAnimation)],
    (anim: SpriteAnimationAPI) => {
        if (clipsWired) return;
        const idle = anim.getClip(CLIP_IDLE);
        const walk = anim.getClip(CLIP_WALK);
        if (!idle || !walk) return; // still streaming in
        clipsWired = true;

        anim.registerClip({
            name: CLIP_HOP,
            fps: 10,
            loop: false,
            frames: [
                { texture: idle.frames[3].texture, duration: 0.08 },
                { texture: walk.frames[1].texture, duration: 0.10 },
                { texture: walk.frames[3].texture, duration: 0.16 },
                { texture: idle.frames[0].texture, duration: 0.10 },
            ],
        });

        // The walk clip's contact frames announce a footstep; puffSystem turns
        // each one into a dust puff at the player's feet.
        walk.events = [
            { frame: 1, name: 'footstep' },
            { frame: 3, name: 'footstep' },
        ];
    },
    { name: 'WireClipsSystem' },
);
