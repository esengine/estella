/**
 * @file    spine.ts
 * @brief   Spine animation control API
 */

import type { Entity, Vec2 } from './types';

// =============================================================================
// Types
// =============================================================================

/**
 * Spine event types
 */
export type SpineEventType = 'start' | 'interrupt' | 'end' | 'complete' | 'dispose' | 'event';

/**
 * Spine event callback
 */
export type SpineEventCallback = (event: SpineEvent) => void;

/**
 * Spine event data
 */
export interface SpineEvent {
    type: SpineEventType;
    entity: Entity;
    track: number;
    animation: string | null;
    eventName?: string;
    intValue?: number;
    floatValue?: number;
    stringValue?: string;
}

/**
 * Track entry info for animation queries
 */
export interface TrackEntryInfo {
    animation: string;
    track: number;
    loop: boolean;
    timeScale: number;
    trackTime: number;
    animationTime: number;
    duration: number;
    isComplete: boolean;
}

// =============================================================================
// SpineController
// =============================================================================

/**
 * Controller for Spine skeletal animations
 *
 * @example
 * ```typescript
 * const spine = new SpineController(wasmModule);
 *
 * // Play animation
 * spine.play(entity, 'run', true);
 *
 * // Queue next animation
 * spine.addAnimation(entity, 'idle', true, 0.2);
 *
 * // Change skin
 * spine.setSkin(entity, 'warrior');
 *
 * // Get bone position for effects
 * const pos = spine.getBonePosition(entity, 'weapon');
 * if (pos) {
 *     spawnEffect(pos.x, pos.y);
 * }
 *
 * // Listen for events
 * spine.on(entity, 'event', (e) => {
 *     if (e.eventName === 'footstep') {
 *         playSound('footstep');
 *     }
 * });
 * ```
 */
export class SpineController {
    private module_: any;
    private listeners_: Map<Entity, Map<SpineEventType, Set<SpineEventCallback>>>;

    constructor(wasmModule: any) {
        this.module_ = wasmModule;
        this.listeners_ = new Map();
        this.setupEventBridge();
    }

    // =========================================================================
    // Animation Control
    // =========================================================================

    /**
     * Plays an animation, replacing any current animation on the track
     * @param entity Target entity
     * @param animation Animation name
     * @param loop Whether to loop the animation
     * @param track Animation track (default 0)
     * @returns True if animation was set
     */
    play(entity: Entity, animation: string, loop: boolean = true, track: number = 0): boolean {
        if (!this.module_.spinePlayAnimation) return false;
        return this.module_.spinePlayAnimation(entity, animation, loop, track);
    }

    /**
     * Adds an animation to the queue
     * @param entity Target entity
     * @param animation Animation name
     * @param loop Whether to loop
     * @param delay Delay before starting (seconds)
     * @param track Animation track (default 0)
     * @returns True if animation was queued
     */
    addAnimation(
        entity: Entity,
        animation: string,
        loop: boolean = true,
        delay: number = 0,
        track: number = 0
    ): boolean {
        if (!this.module_.spineAddAnimation) return false;
        return this.module_.spineAddAnimation(entity, animation, loop, delay, track);
    }

    /**
     * Sets an empty animation to mix out the current animation
     * @param entity Target entity
     * @param mixDuration Duration of the mix out
     * @param track Animation track (default 0)
     */
    setEmptyAnimation(entity: Entity, mixDuration: number = 0.2, track: number = 0): void {
        if (!this.module_.spineSetEmptyAnimation) return;
        this.module_.spineSetEmptyAnimation(entity, mixDuration, track);
    }

    /**
     * Clears all animations on a track
     * @param entity Target entity
     * @param track Animation track (default 0)
     */
    clearTrack(entity: Entity, track: number = 0): void {
        if (!this.module_.spineClearTrack) return;
        this.module_.spineClearTrack(entity, track);
    }

    /**
     * Clears all tracks
     * @param entity Target entity
     */
    clearTracks(entity: Entity): void {
        if (!this.module_.spineClearTracks) return;
        this.module_.spineClearTracks(entity);
    }

    // =========================================================================
    // Skin Control
    // =========================================================================

    /**
     * Sets the current skin
     * @param entity Target entity
     * @param skinName Skin name
     * @returns True if skin was set
     */
    setSkin(entity: Entity, skinName: string): boolean {
        if (!this.module_.spineSetSkin) return false;
        return this.module_.spineSetSkin(entity, skinName);
    }

    /**
     * Gets available skin names
     * @param entity Target entity
     * @returns Array of skin names
     */
    getSkins(entity: Entity): string[] {
        if (!this.module_.spineGetSkins) return [];
        return this.module_.spineGetSkins(entity) || [];
    }

    // =========================================================================
    // Queries
    // =========================================================================

    /**
     * Gets available animation names
     * @param entity Target entity
     * @returns Array of animation names
     */
    getAnimations(entity: Entity): string[] {
        if (!this.module_.spineGetAnimations) return [];
        return this.module_.spineGetAnimations(entity) || [];
    }

    /**
     * Gets the current animation on a track
     * @param entity Target entity
     * @param track Animation track (default 0)
     * @returns Animation name or null
     */
    getCurrentAnimation(entity: Entity, track: number = 0): string | null {
        if (!this.module_.spineGetCurrentAnimation) return null;
        return this.module_.spineGetCurrentAnimation(entity, track);
    }

    /**
     * Gets the duration of an animation
     * @param entity Target entity
     * @param animation Animation name
     * @returns Duration in seconds, or 0 if not found
     */
    getAnimationDuration(entity: Entity, animation: string): number {
        if (!this.module_.spineGetAnimationDuration) return 0;
        return this.module_.spineGetAnimationDuration(entity, animation);
    }

    /**
     * Gets detailed track entry info
     * @param entity Target entity
     * @param track Animation track (default 0)
     * @returns Track entry info or null
     */
    getTrackEntry(entity: Entity, track: number = 0): TrackEntryInfo | null {
        if (!this.module_.spineGetTrackEntry) return null;
        return this.module_.spineGetTrackEntry(entity, track);
    }

    // =========================================================================
    // Bone/Slot Access
    // =========================================================================

    /**
     * Gets world position of a bone
     * @param entity Target entity
     * @param boneName Bone name
     * @returns Position or null if not found
     */
    getBonePosition(entity: Entity, boneName: string): Vec2 | null {
        if (!this.module_.spineGetBonePosition) return null;
        const result = this.module_.spineGetBonePosition(entity, boneName);
        if (!result) return null;
        return { x: result.x, y: result.y };
    }

    /**
     * Gets world rotation of a bone in degrees
     * @param entity Target entity
     * @param boneName Bone name
     * @returns Rotation in degrees or null
     */
    getBoneRotation(entity: Entity, boneName: string): number | null {
        if (!this.module_.spineGetBoneRotation) return null;
        return this.module_.spineGetBoneRotation(entity, boneName);
    }

    /**
     * Sets the attachment for a slot
     * @param entity Target entity
     * @param slotName Slot name
     * @param attachmentName Attachment name (null to clear)
     */
    setAttachment(entity: Entity, slotName: string, attachmentName: string | null): void {
        if (!this.module_.spineSetAttachment) return;
        this.module_.spineSetAttachment(entity, slotName, attachmentName || '');
    }

    // =========================================================================
    // Events
    // =========================================================================

    /**
     * Registers an event callback
     * @param entity Target entity
     * @param type Event type
     * @param callback Callback function
     */
    on(entity: Entity, type: SpineEventType, callback: SpineEventCallback): void {
        if (!this.listeners_.has(entity)) {
            this.listeners_.set(entity, new Map());
        }
        const entityListeners = this.listeners_.get(entity)!;
        if (!entityListeners.has(type)) {
            entityListeners.set(type, new Set());
        }
        entityListeners.get(type)!.add(callback);
    }

    /**
     * Unregisters an event callback
     * @param entity Target entity
     * @param type Event type
     * @param callback Callback function
     */
    off(entity: Entity, type: SpineEventType, callback: SpineEventCallback): void {
        const entityListeners = this.listeners_.get(entity);
        if (!entityListeners) return;
        const typeListeners = entityListeners.get(type);
        if (!typeListeners) return;
        typeListeners.delete(callback);
    }

    /**
     * Removes all event listeners for an entity
     * @param entity Target entity
     */
    removeAllListeners(entity: Entity): void {
        this.listeners_.delete(entity);
    }

    // =========================================================================
    // Private
    // =========================================================================

    private setupEventBridge(): void {
        if (typeof window !== 'undefined') {
            window.__esengine_spineEvent = (entity: Entity, eventData: any) => {
                this.dispatchEvent(entity, eventData);
            };
        }
    }

    private dispatchEvent(entity: Entity, eventData: any): void {
        const entityListeners = this.listeners_.get(entity);
        if (!entityListeners) return;

        const event: SpineEvent = {
            type: eventData.type as SpineEventType,
            entity,
            track: eventData.track ?? 0,
            animation: eventData.animation ?? null,
            eventName: eventData.eventName,
            intValue: eventData.intValue,
            floatValue: eventData.floatValue,
            stringValue: eventData.stringValue,
        };

        const typeListeners = entityListeners.get(event.type);
        if (typeListeners) {
            typeListeners.forEach(callback => {
                try {
                    callback(event);
                } catch (e) {
                    console.error('Error in Spine event callback:', e);
                }
            });
        }
    }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a SpineController instance
 * @param wasmModule The ESEngine WASM module
 * @returns SpineController instance
 */
export function createSpineController(wasmModule: any): SpineController {
    return new SpineController(wasmModule);
}
