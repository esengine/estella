import {
    defineSystem, Res,
    SpriteAnimation, SpriteAnimationAPI,
} from 'esengine';
import { CLIP_IDLE, CLIP_WALK, CLIP_HOP } from '../config';
import { footsteps } from '../components';

// The character's state machine (Idle↔Move 1D blend + a `hop` trigger) is
// authored in the editor and lives on disk as `player.esanimator`; the scene's
// Animator references it BY PATH, and the runtime asset loader registers it
// before the first tick — so there is no code-registered controller here. This
// system only wires the footstep listener (inert until events attach below).
export const setupSystem = defineSystem(
    [Res(SpriteAnimation)],
    (anim: SpriteAnimationAPI) => {
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
