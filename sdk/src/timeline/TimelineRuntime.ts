// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { getComponent, SpineAnimation } from '../component';
import { SpriteAnimator } from '../animation/SpriteAnimator';
import type { AudioAPI } from '../audio/Audio';
import type { Entity } from '../types';

/**
 * Shared timeline runtime helpers. The timeline is a
 * pure-TS runtime now (see TimelineDrive); this module holds the pieces shared by
 * the drive and the editor: child-entity resolution, nested-path writes, and the
 * event dispatcher.
 */

export const TimelineEventType = {
    SpinePlay: 0,
    SpineStop: 1,
    SpriteAnimPlay: 2,
    AudioPlay: 3,
    ActivationSet: 4,
} as const;

export function setNestedProperty(obj: Record<string, any>, path: string, value: number): boolean {
    const parts = path.split('.');
    let target = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        target = target[parts[i]];
        if (target == null || typeof target !== 'object') return false;
    }
    const lastKey = parts[parts.length - 1];
    if (!(lastKey in target)) return false;
    target[lastKey] = value;
    return true;
}

export function resolveChildEntity(world: any, rootEntity: Entity, childPath: string): Entity | null {
    if (!childPath) return rootEntity;

    const Children = getComponent('Children');
    const Name = getComponent('Name');
    if (!Children || !Name) return null;

    let current: Entity = rootEntity;
    const segments = childPath.split('/');

    for (const segment of segments) {
        const childrenData = world.tryGet(current, Children);
        if (!childrenData) return null;

        const childEntities: Entity[] = childrenData.entities || [];
        let found: Entity | null = null;
        for (const childId of childEntities) {
            const nameData = world.tryGet(childId, Name);
            if (nameData && nameData.value === segment) {
                found = childId;
                break;
            }
        }
        if (found === null) return null;
        current = found;
    }

    return current;
}

/**
 * Apply ONE timeline event to the world (component mutations / audio). Called by
 * the pure-TS runtime (TimelineDrive) with edge-detected events.
 */
export function applyTimelineEvent(
    world: any, audio: AudioAPI | null,
    type: number, entity: Entity,
    intParam: number, floatParam: number, str: string,
): void {
    switch (type) {
        case TimelineEventType.SpinePlay: {
            if (world.has(entity, SpineAnimation)) {
                const current = world.get(entity, SpineAnimation);
                current.animation = str;
                current.playing = true;
                current.loop = intParam !== 0;
                world.set(entity, SpineAnimation, current);
            }
            break;
        }
        case TimelineEventType.SpineStop: {
            if (world.has(entity, SpineAnimation)) {
                const current = world.get(entity, SpineAnimation);
                current.playing = false;
                world.set(entity, SpineAnimation, current);
            }
            break;
        }
        case TimelineEventType.SpriteAnimPlay: {
            if (world.has(entity, SpriteAnimator)) {
                const current = world.get(entity, SpriteAnimator);
                world.insert(entity, SpriteAnimator, { ...current, clip: str, playing: true });
            }
            break;
        }
        case TimelineEventType.AudioPlay: {
            if (str && audio) audio.playSFX(str, { volume: floatParam });
            break;
        }
        case TimelineEventType.ActivationSet: {
            const active = intParam !== 0;
            if (world.has(entity, SpineAnimation)) {
                const current = world.get(entity, SpineAnimation);
                current.enabled = active;
                world.set(entity, SpineAnimation, current);
            }
            if (world.has(entity, SpriteAnimator)) {
                const current = world.get(entity, SpriteAnimator);
                world.insert(entity, SpriteAnimator, { ...current, enabled: active });
            }
            const Sprite = getComponent('Sprite');
            if (Sprite && world.has(entity, Sprite)) {
                const current = world.get(entity, Sprite);
                world.set(entity, Sprite, { ...current, enabled: active });
            }
            break;
        }
    }
}
