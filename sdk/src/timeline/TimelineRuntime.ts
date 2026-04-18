import { getComponent, SpineAnimation } from '../component';
import { SpriteAnimator } from '../animation/SpriteAnimator';
import type { AudioAPI } from '../audio/Audio';
import { uploadTimelineToWasm, type UploadResult } from './TimelineUploader';
import type { TimelineAsset } from './TimelineTypes';
import type { ESEngineModule } from '../wasm';
import type { Entity } from '../types';

const TimelineEventType = {
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

export function resolveTrackTargets(
    world: any, module: ESEngineModule,
    uploadResult: UploadResult, rootEntity: Entity,
): void {
    let propertyIndex = 0;
    let eventIndex = 0;

    for (const track of uploadResult.tracks) {
        if (!track.childPath) {
            if (track.type === 'property') propertyIndex++;
            else eventIndex++;
            continue;
        }

        const resolved = resolveChildEntity(world, rootEntity, track.childPath);
        if (resolved !== null) {
            const isEvent = track.type !== 'property';
            const index = isEvent ? eventIndex : propertyIndex;
            module._tl_setTrackTarget(uploadResult.handle, isEvent ? 1 : 0, index, resolved as number);
        }

        if (track.type === 'property') propertyIndex++;
        else eventIndex++;
    }
}

export function createTimelineHandle(
    module: ESEngineModule, asset: TimelineAsset,
): UploadResult {
    return uploadTimelineToWasm(module, asset);
}

export function destroyTimelineHandle(module: ESEngineModule, handle: number): void {
    if (handle) module._tl_destroy(handle);
}

function decodeEventString(module: ESEngineModule, index: number): string {
    const ptr = module._tl_getEventString(index);
    const len = module._tl_getEventStringLen(index);
    if (!ptr || len <= 0) return '';
    const bytes = new Uint8Array((module as any).HEAPU8.buffer, ptr, len);
    return new TextDecoder().decode(bytes);
}

export function processTimelineEvents(world: any, module: ESEngineModule, audio: AudioAPI | null = null): void {
    const count = module._tl_getEventCount();
    for (let i = 0; i < count; i++) {
        const type = module._tl_getEventType(i);
        const entity = module._tl_getEventEntity(i);

        switch (type) {
            case TimelineEventType.SpinePlay: {
                const animName = decodeEventString(module, i);
                const loop = module._tl_getEventIntParam(i) !== 0;
                if (world.has(entity, SpineAnimation)) {
                    const current = world.get(entity, SpineAnimation);
                    current.animation = animName;
                    current.playing = true;
                    current.loop = loop;
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
                const clipName = decodeEventString(module, i);
                if (world.has(entity, SpriteAnimator)) {
                    const current = world.get(entity, SpriteAnimator);
                    world.insert(entity, SpriteAnimator, {
                        ...current,
                        clip: clipName,
                        playing: true,
                    });
                }
                break;
            }
            case TimelineEventType.AudioPlay: {
                const clipPath = decodeEventString(module, i);
                const volume = module._tl_getEventFloatParam(i);
                if (clipPath && audio) {
                    audio.playSFX(clipPath, { volume });
                }
                break;
            }
            case TimelineEventType.ActivationSet: {
                const active = module._tl_getEventIntParam(i) !== 0;
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
}

export function processCustomProperties(
    world: any, module: ESEngineModule, uploadResult: UploadResult,
): void {
    const count = module._tl_getCustomPropertyCount();
    if (count === 0) return;

    for (let i = 0; i < count; i++) {
        const entity = module._tl_getCustomPropertyEntity(i);
        const trackIndex = module._tl_getCustomPropertyTrackIndex(i);
        const channelIndex = module._tl_getCustomPropertyChannelIndex(i);
        const value = module._tl_getCustomPropertyValue(i);

        const trackInfo = uploadResult.tracks.filter(t => t.type === 'property')[trackIndex];
        if (!trackInfo?.component || !trackInfo.channelProperties) continue;

        const componentDef = getComponent(trackInfo.component);
        if (!componentDef || !world.has(entity, componentDef)) continue;

        const data = world.get(entity, componentDef);
        const propPath = trackInfo.channelProperties[channelIndex];
        if (propPath && setNestedProperty(data, propPath, value)) {
            world.set(entity, componentDef, data);
        }
    }
}

export function advanceAndProcess(
    world: any, module: ESEngineModule,
    handle: number, entity: Entity,
    dt: number, speed: number,
    uploadResult: UploadResult,
    audio: AudioAPI | null = null,
): void {
    module._tl_advance(
        world.getCppRegistry() as any,
        handle, entity, dt, speed,
    );
    processTimelineEvents(world, module, audio);
    processCustomProperties(world, module, uploadResult);
    module._tl_clearResults();
}
