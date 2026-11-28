// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SpriteAnimator.ts
 * @brief   Sprite frame animation component and system (pure TypeScript)
 */

import { registeredAssetFields } from '../asset/registeredAssetFields';
import { defineComponent, getComponent, type ComponentDef } from '../ecs/component';
import { defineResource } from '../ecs/resource';
import { getDefaultContext } from '../ecs/context';
import type { Entity, TextureHandle } from '../types';
import type { World } from '../ecs/world';
import { Sprite, type SpriteData } from '../ecs/component';
import { writeProjection } from '../ecs/componentProjection';
import {
    copySpriteFrameField, restoredSpriteFramePose, sameSpriteFrameField, setSpriteFrameTexture, SPRITE_FRAME_FIELDS,
    type SpriteFrameField, type SpriteFramePose,
} from './spriteFrameProjection';
import { spriteFrameDuration } from './spriteFrameTiming';

// =============================================================================
// Sprite Animation Clip
// =============================================================================

export interface SpriteAnimFrame {
    texture: TextureHandle;
    duration?: number;
    uvOffset?: { x: number; y: number };
    uvScale?: { x: number; y: number };
    /**
     * The anchor this frame renders with, in `Sprite.pivot`'s own space — resolved
     * at load time from the clip's per-frame/clip-wide anchors. Absent on EVERY
     * frame of a clip that authors no anchors, which is what keeps playback from
     * touching a pivot the entity owns.
     */
    pivot?: { x: number; y: number };
    /**
     * The size this frame renders at, in world units — resolved at load time from
     * the clip's sizing mode and the frame's natural size. Absent on EVERY frame of
     * a clip that does not own size, which is what keeps playback from resizing a
     * sprite the entity sized itself.
     */
    size?: { x: number; y: number };
}

export interface SpriteAnimEvent {
    frame: number;
    name: string;
    data?: unknown;
}

export type SpriteAnimEventHandler = (event: SpriteAnimEvent, entity: Entity) => void;

export interface SpriteAnimClip {
    name: string;
    frames: SpriteAnimFrame[];
    fps: number;
    loop: boolean;
    labels?: Record<string, number>;
    events?: SpriteAnimEvent[];
}

function frameDurationOf(clip: SpriteAnimClip, index: number, speed: number, fallback: number): number {
    return Math.max(Number.MIN_VALUE, spriteFrameDuration(clip.frames[index]?.duration, fallback) / speed);
}

// A paused player which restored its sprite still needs to apply the next populated clip.
const EMPTY_CLIP_POSE = {};

interface SpritePoseTracking {
    base: SpriteFramePose;
    projected: SpriteFramePose;
}

/** Reuse vectors owned by the snapshot. Live sprite fields never alias them. */
function rememberSpriteField<K extends SpriteFrameField>(pose: SpriteFramePose, key: K, value: SpriteFramePose[K]): void {
    const stored = pose[key];
    if (stored && typeof stored === 'object' && value && typeof value === 'object') {
        stored.x = value.x;
        stored.y = value.y;
    } else copySpriteFrameField(pose, key, value);
}

export function shouldFireEvent(eventFrame: number, prevFrame: number, newFrame: number, _totalFrames: number, loop: boolean): boolean {
    // Frame-0 initial apply only. Without the `=== 0`, the completion clamp
    // (currentFrame overflows → clamped to last, so prev === new === last) re-fires
    // the last frame's event a second time.
    if (prevFrame === newFrame && eventFrame === newFrame && newFrame === 0) return true;
    if (newFrame > prevFrame) {
        return eventFrame > prevFrame && eventFrame <= newFrame;
    }
    if (loop && newFrame < prevFrame) {
        return eventFrame > prevFrame || eventFrame <= newFrame;
    }
    return false;
}

// =============================================================================
// SpriteAnimation — per-App clip registry + frame-event listeners + system
// =============================================================================

/**
 * Owns one App's sprite-animation clip registry and frame-event listeners,
 * advances SpriteAnimator components, and drives goto-frame/label. Published as
 * the {@link SpriteAnimation} resource; read it as
 * `app.getResource(SpriteAnimation)`.
 */
export class SpriteAnimationAPI {
    private readonly clips = new Map<string, SpriteAnimClip>();
    private assetClips_: ((ref: string, entity?: Entity) => SpriteAnimClip | undefined) | null = null;
    private readonly playerEntities = new WeakMap<SpriteAnimatorData, Entity>();
    private readonly entityListeners = new Map<Entity, SpriteAnimEventHandler[]>();
    private globalListeners: SpriteAnimEventHandler[] = [];
    // Remember the applied source without retaining an unloaded clip's frames.
    private readonly clipTokens = new WeakMap<SpriteAnimClip, object>();
    private readonly appliedAnimators = new WeakMap<SpriteAnimatorData, object>();
    private readonly spritePoses = new WeakMap<SpriteAnimatorData, SpritePoseTracking>();
    private readonly pendingApplies = new WeakSet<SpriteAnimatorData>();
    private updating = false;

    // -- clip registry --------------------------------------------------------

    registerClip(clip: SpriteAnimClip): void {
        this.clips.set(clip.name, clip);
    }

    /**
     * Register an EXISTING clip object under an additional lookup name. Loaders
     * register a clip under its resolved load path, which in some realms is an
     * absolute URL — components reference the serialized project-relative ref,
     * so the two must alias to the SAME object (events attached through one
     * name fire for the other).
     */
    aliasClip(name: string, clip: SpriteAnimClip): void {
        this.clips.set(name, clip);
    }

    unregisterClip(name: string): void {
        this.clips.delete(name);
    }

    /**
     * @internal Where a clip loaded from a `.esanim` comes from: this app's
     * realm. A code registration wins, as it always did — what changes is that
     * the asset half is no longer a second copy kept in the map above.
     */
    useAssetClips(source: (ref: string, entity?: Entity) => SpriteAnimClip | undefined): void {
        this.assetClips_ = source;
    }

    getClip(name: string, entity?: Entity): SpriteAnimClip | undefined {
        return this.clips.get(name) ?? this.assetClips_?.(name, entity);
    }

    clearClips(): void {
        this.clips.clear();
    }

    // -- frame-event listeners ------------------------------------------------

    onEvent(entity: Entity, handler: SpriteAnimEventHandler): () => void {
        this.entityListeners.set(entity, [...(this.entityListeners.get(entity) ?? []), handler]);
        return () => {
            const arr = this.entityListeners.get(entity);
            if (arr) {
                const idx = arr.indexOf(handler);
                if (idx < 0) return;
                if (arr.length === 1) this.entityListeners.delete(entity);
                else this.entityListeners.set(entity, [...arr.slice(0, idx), ...arr.slice(idx + 1)]);
            }
        };
    }

    onEventGlobal(handler: SpriteAnimEventHandler): () => void {
        this.globalListeners = [...this.globalListeners, handler];
        return () => {
            const idx = this.globalListeners.indexOf(handler);
            if (idx >= 0) this.globalListeners = [...this.globalListeners.slice(0, idx), ...this.globalListeners.slice(idx + 1)];
        };
    }

    removeEntityListeners(entity: Entity): void {
        this.entityListeners.delete(entity);
    }

    private isCurrentAnimator(world: World, entity: Entity, animator: SpriteAnimatorData, clipName: string, clip: SpriteAnimClip, frames: SpriteAnimFrame[], frameCount: number): boolean {
        if (!world.isEntityActive(entity) || !animator.enabled) {
            this.pendingApplies.add(animator);
            return false;
        }
        const motion = world.tryGet(entity, SpriteMotionPlayback);
        const current = world.tryGet(entity, SpriteAnimator) ?? motion?.player;
        if (current !== animator || (motion && (motion.restart || !motionOwnerEnabled(world, entity)))
            || animator.clip !== clipName || this.getClip(clipName, entity) !== clip
            || this.pendingApplies.has(animator)) return false;
        if (clip.frames !== frames || frames.length !== frameCount
            || !Number.isInteger(animator.currentFrame) || animator.currentFrame < 0 || animator.currentFrame >= frameCount) {
            this.appliedAnimators.delete(animator);
            return false;
        }
        return true;
    }

    private fireEvents(world: World, entity: Entity, animator: SpriteAnimatorData, clipName: string, clip: SpriteAnimClip, prevFrame: number, advanced: number, initial: boolean, looping: boolean): boolean {
        if (!clip.events || clip.events.length === 0) return true;
        if (!this.entityListeners.get(entity)?.length && !this.globalListeners.length) return true;
        const frames = clip.frames;
        const frameCount = frames.length;
        let first: SpriteAnimEvent | undefined;
        let firstDistance = 0;
        let ordered: { event: SpriteAnimEvent; distance: number }[] | undefined;
        for (const evt of clip.events) {
            if (!Number.isInteger(evt.frame) || evt.frame < 0 || evt.frame >= clip.frames.length) continue;
            const offset = evt.frame - prevFrame;
            const distance = initial && offset === 0 ? 0
                : looping ? ((offset + clip.frames.length) % clip.frames.length || clip.frames.length) : offset;
            if (!(distance === 0 && initial) && !(distance > 0 && distance <= advanced)) continue;
            if (!first) { first = evt; firstDistance = distance; }
            else {
                ordered ??= [{ event: first, distance: firstDistance }];
                ordered.push({ event: evt, distance });
            }
        }
        // Most updates cross one event: avoid an allocation on that hot path.
        // Long updates coalesce each declared event once, in playback order.
        if (ordered) ordered.sort((a, b) => a.distance - b.distance);
        const count = ordered?.length ?? (first ? 1 : 0);
        for (let i = 0; i < count; i++) {
            const evt = ordered ? ordered[i].event : first!;
            const listeners = this.entityListeners.get(entity);
            // Registration uses copy-on-write: these event snapshots stay
            // stable without allocating listener arrays on every frame.
            const globals = this.globalListeners;
            if (listeners) {
                for (const handler of listeners) {
                    handler(evt, entity);
                    if (!this.isCurrentAnimator(world, entity, animator, clipName, clip, frames, frameCount)) return false;
                }
            }
            for (const handler of globals) {
                handler(evt, entity);
                if (!this.isCurrentAnimator(world, entity, animator, clipName, clip, frames, frameCount)) return false;
            }
        }
        return true;
    }

    // -- per-frame system -----------------------------------------------------

    update(world: World, deltaTime: number): void {
        // A frame callback may control playback, but cannot recursively advance
        // this API's current animation pass. Always release the guard on error.
        if (this.updating) return;
        this.updating = true;
        try {
            this.updatePlayers(world, deltaTime, SpriteMotionPlayback);
            this.updatePlayers(world, deltaTime, SpriteAnimator);
        } finally { this.updating = false; }
    }

    private updatePlayers(world: World, deltaTime: number, source: typeof SpriteAnimator | typeof SpriteMotionPlayback): void {
        const entities = source === SpriteMotionPlayback
            ? world.getEntitiesWithComponents([SpriteMotionPlayback])
            : world.getEntitiesWithComponents([SpriteAnimator], [], [SpriteMotionPlayback]);
        if (entities.length === 0) return;
        const registry = world.getCppRegistry(), module = world.getWasmModule();
        const readSprite = world.resolveGetter(Sprite), writeSprite = world.resolveSetter(Sprite);

        for (const entity of entities) {
            // An earlier entity's event can remove a later entity/component
            // from the query snapshot we are currently walking.
            if (!world.isEntityActive(entity)) continue;
            const motion = world.tryGet(entity, SpriteMotionPlayback);
            if (source === SpriteMotionPlayback) {
                if (!motion) continue;
                const enabled = motionOwnerEnabled(world, entity);
                if (!motion.requested || !enabled) {
                    motion.requested = false;
                    // A disabled controller resumes at the same frame. Leaving the
                    // sprite state or removing the controller releases its playhead.
                    if (enabled === false) continue;
                    world.remove(entity, SpriteMotionPlayback);
                    continue;
                }
                motion.requested = false;
            } else if (motion) {
                // The controlled pass already advanced this authored player.
                continue;
            }
            const authored = world.tryGet(entity, SpriteAnimator);
            const animator = authored ?? motion?.player;
            if (!animator) continue;
            if (this.playerEntities.get(animator) !== entity) this.playerEntities.set(animator, entity);
            if (!animator.enabled || !animator.clip) continue;
            if (motion?.restart) {
                this.appliedAnimators.delete(animator);
                motion.restart = false;
            }
            const applied = this.appliedAnimators.get(animator);
            if (!animator.playing && !this.pendingApplies.has(animator) && !applied) continue;

            const clipName = animator.clip;
            const clip = this.getClip(clipName, entity);
            if (!clip) continue;
            if (clip.frames.length === 0) {
                const pose = this.spritePoses.get(animator);
                if (pose) {
                    this.spritePoses.delete(animator);
                    this.appliedAnimators.set(animator, EMPTY_CLIP_POSE);
                    if (world.has(entity, Sprite)) {
                        const restored = restoredSpriteFramePose(world.get(entity, Sprite), pose.base, pose.projected);
                        if (restored) writeProjection(world, entity, Sprite, restored);
                    }
                }
                continue;
            }

            // playing raised on a finished one-shot = replay from the top
            // (TimelinePlayer's flag contract).
            if (animator.finished && animator.playing) {
                animator.finished = false;
                animator.currentFrame = 0;
                animator.frameTimer = 0;
                this.appliedAnimators.delete(animator);
            }

            let token = this.clipTokens.get(clip);
            if (!token) { token = {}; this.clipTokens.set(clip, token); }
            const needsInitialApply = this.appliedAnimators.get(animator) !== token;
            if (!animator.playing && !this.pendingApplies.has(animator) && !needsInitialApply) continue;
            // Speed scales EVERY frame's duration (not just the fps fallback), and
            // is guarded: 0/negative would otherwise freeze (Infinity) or run the
            // timer backward.
            const speed = Number.isFinite(animator.speed) ? Math.max(animator.speed, 1e-4) : 1;
            const fallback = 1 / (Number.isFinite(clip.fps) && clip.fps > 0 ? clip.fps : 12);
            animator.currentFrame = Number.isFinite(animator.currentFrame)
                ? Math.max(0, Math.min(Math.floor(animator.currentFrame), clip.frames.length - 1)) : 0;
            const prevFrame = animator.currentFrame;
            const wasPlaying = animator.playing;
            const looping = motion?.loopOverride ?? (animator.loop && clip.loop);
            const elapsed = wasPlaying && Number.isFinite(deltaTime) ? Math.max(0, deltaTime) : 0;
            animator.frameTimer = Math.min(Number.MAX_VALUE,
                (Number.isFinite(animator.frameTimer) ? Math.max(0, animator.frameTimer) : 0) + elapsed);

            let frameChanged = needsInitialApply || this.pendingApplies.has(animator);
            // Accumulate one cycle while walking it, then skip whole extra cycles
            // in constant time. At most two cycles are inspected, with no backlog.
            let steps = 0;
            let advanced = 0;
            let cycleDuration = 0;
            while (animator.playing && steps < clip.frames.length * 2) {
                if (looping && steps === clip.frames.length) animator.frameTimer %= cycleDuration;
                const frameDuration = frameDurationOf(clip, animator.currentFrame, speed, fallback);
                if (animator.frameTimer < frameDuration) break;
                animator.frameTimer -= frameDuration;
                if (steps < clip.frames.length) cycleDuration += frameDuration;
                steps++;
                animator.currentFrame++;
                if (animator.currentFrame >= clip.frames.length) {
                    if (looping) {
                        animator.currentFrame = 0;
                        advanced++;
                    } else {
                        animator.currentFrame = clip.frames.length - 1;
                        animator.playing = false;
                        animator.finished = true;
                        animator.frameTimer = 0;
                    }
                } else advanced++;
                frameChanged = true;
            }

            this.pendingApplies.delete(animator);
            if (needsInitialApply) this.appliedAnimators.set(animator, token);
            if (frameChanged) {
                if (!this.fireEvents(world, entity, animator, clipName, clip, prevFrame, advanced, needsInitialApply && wasPlaying, looping)) continue;
            }

            if (frameChanged && world.has(entity, Sprite)) {
                const frame = clip.frames[animator.currentFrame];
                // Borrow only after event callbacks. Speculation and editor
                // observers use the full mutation seam; a rebound world cannot
                // use accessors resolved against its previous registry.
                const direct = readSprite && writeSprite && !world.speculating && !getDefaultContext().editorBridge
                    && registry === world.getCppRegistry() && module === world.getWasmModule();
                const sprite = (direct ? readSprite(entity) : world.get(entity, Sprite)) as SpriteData;
                let pose = this.spritePoses.get(animator);
                if (!pose) {
                    pose = { base: {}, projected: {} };
                    this.spritePoses.set(animator, pose);
                }
                for (const key of SPRITE_FRAME_FIELDS) {
                    if (!sameSpriteFrameField(sprite[key], pose.projected[key])) rememberSpriteField(pose.base, key, sprite[key]);
                }
                setSpriteFrameTexture(sprite, frame.texture, frame.uvOffset, frame.uvScale);
                // No reset branch on either: the loader gives EVERY frame of an
                // owning clip both, so absent here means the clip owns neither and
                // what the entity authored stands.
                if (frame.size) {
                    sprite.size = { x: frame.size.x, y: frame.size.y };
                }
                if (frame.pivot) {
                    sprite.pivot = { x: frame.pivot.x, y: frame.pivot.y };
                }
                pose.projected.texture = sprite.texture;
                rememberSpriteField(pose.projected, 'uvOffset', sprite.uvOffset);
                rememberSpriteField(pose.projected, 'uvScale', sprite.uvScale);
                if (frame.size) rememberSpriteField(pose.projected, 'size', sprite.size);
                if (frame.pivot) rememberSpriteField(pose.projected, 'pivot', sprite.pivot);
                if (direct) {
                    writeSprite(entity, sprite);
                    world.markChanged(entity, Sprite);
                } else writeProjection(world, entity, Sprite, sprite);
            }

            if (frameChanged) {
                // These are complete existing values: stamp their changes without
                // rebuilding defaults or allocating a replacement component.
                if (authored) world.set(entity, SpriteAnimator, animator);
                this.appliedAnimators.set(animator, token);
            }
        }
    }

    // -- goto frame / label ---------------------------------------------------

    gotoFrame(animator: SpriteAnimatorData, frameIndex: number, andPlay: boolean = true, entity: Entity | undefined = this.playerEntities.get(animator)): void {
        const clip = this.getClip(animator.clip, entity);
        if (!clip || clip.frames.length === 0) return;

        animator.currentFrame = Math.max(0, Math.min(frameIndex, clip.frames.length - 1));
        animator.frameTimer = 0;
        animator.playing = andPlay;
        animator.finished = false;
        this.appliedAnimators.delete(animator);
        this.pendingApplies.add(animator);
    }

    gotoLabel(animator: SpriteAnimatorData, label: string, andPlay: boolean = true, entity: Entity | undefined = this.playerEntities.get(animator)): void {
        const clip = this.getClip(animator.clip, entity);
        if (!clip || !clip.labels) return;

        const frameIndex = clip.labels[label];
        if (frameIndex === undefined) return;

        this.gotoFrame(animator, frameIndex, andPlay, entity);
    }
}

/**
 * Per-App sprite-animation resource (clip registry + frame-event listeners),
 * published by `AnimationPlugin`. Read as `app.getResource(SpriteAnimation)`.
 */
export const SpriteAnimation = defineResource<SpriteAnimationAPI>(null!, 'SpriteAnimation');

// =============================================================================
// SpriteAnimator Component
// =============================================================================

/** The fields of the `SpriteAnimator` component, whose tier this shape carries.
 *  @beta */
export interface SpriteAnimatorData {
    clip: string;
    speed: number;
    playing: boolean;
    loop: boolean;
    enabled: boolean;
    currentFrame: number;
    frameTimer: number;
    /** Latched when a one-shot clip completes; runtime-only, do not author.
     *  Raising `playing` on a finished animator replays from frame 0 — the
     *  same flag contract as TimelinePlayer. */
    finished: boolean;
}

/**
 * Frame playback on an entity: which clip, how fast, and where in it. The clip is
 * named rather than referenced, so a project registers clips from code or ships
 * them as `.esanim` and this stays the same either way.
 *
 * @beta
 */
export const SpriteAnimator: ComponentDef<SpriteAnimatorData> = defineComponent('SpriteAnimator', {
    clip: '',
    speed: 1.0,
    playing: true,
    loop: true,
    enabled: true,
    currentFrame: 0,
    frameTimer: 0,
    finished: false,
}, {
    assetFields: [registeredAssetFields.SpriteAnimator],
});

// Animator lives in an optional entry point. Resolving it only for an active
// sprite motion keeps standalone sprite playback independent of the graph.
function motionOwnerEnabled(world: World, entity: Entity): boolean | undefined {
    const controller = getComponent('Animator');
    return controller && world.tryGet(entity, controller)?.enabled;
}

/** @internal A sprite state's request for this update. The optional playhead is
 * used only on an entity without an authored SpriteAnimator. Scene saves omit
 * the entire request and the state machine recreates it on playback. */
export const SpriteMotionPlayback = defineComponent<{
    player: SpriteAnimatorData | null;
    requested: boolean;
    restart: boolean;
    speed: number;
    loopOverride: boolean | null;
}>('AnimatorSpritePlayback', {
    player: null, requested: false, restart: false, speed: 1, loopOverride: null,
}, { transient: true });
