import type { ESEngineModule } from '../wasm';
import type { TimelineAsset, PropertyTrack, Track } from './TimelineTypes';
import { TrackType } from './TimelineTypes';

export enum AnimTargetField {
    PositionX = 0, PositionY, PositionZ,
    ScaleX, ScaleY, ScaleZ,
    RotationZ,
    ColorR, ColorG, ColorB, ColorA,
    SpriteOpacity,
    SpriteSizeX, SpriteSizeY,
    OffsetMinX, OffsetMinY,
    OffsetMaxX, OffsetMaxY,
    AnchorMinX, AnchorMinY,
    AnchorMaxX, AnchorMaxY,
    PivotX, PivotY,
    CameraOrthoSize,
    CustomField,
}

enum AnimTargetComponent {
    Transform = 0,
    Sprite,
    UIRect,
    Camera,
    Custom,
}

const FIELD_MAP: Record<string, Record<string, AnimTargetField>> = {
    Transform: {
        'position.x': AnimTargetField.PositionX,
        'position.y': AnimTargetField.PositionY,
        'position.z': AnimTargetField.PositionZ,
        'scale.x': AnimTargetField.ScaleX,
        'scale.y': AnimTargetField.ScaleY,
        'scale.z': AnimTargetField.ScaleZ,
        'rotation': AnimTargetField.RotationZ,
    },
    Sprite: {
        'color.r': AnimTargetField.ColorR,
        'color.g': AnimTargetField.ColorG,
        'color.b': AnimTargetField.ColorB,
        'color.a': AnimTargetField.ColorA,
        'opacity': AnimTargetField.SpriteOpacity,
        'size.x': AnimTargetField.SpriteSizeX,
        'size.y': AnimTargetField.SpriteSizeY,
    },
    UIRect: {
        'offsetMin.x': AnimTargetField.OffsetMinX,
        'offsetMin.y': AnimTargetField.OffsetMinY,
        'offsetMax.x': AnimTargetField.OffsetMaxX,
        'offsetMax.y': AnimTargetField.OffsetMaxY,
        'anchorMin.x': AnimTargetField.AnchorMinX,
        'anchorMin.y': AnimTargetField.AnchorMinY,
        'anchorMax.x': AnimTargetField.AnchorMaxX,
        'anchorMax.y': AnimTargetField.AnchorMaxY,
        'pivot.x': AnimTargetField.PivotX,
        'pivot.y': AnimTargetField.PivotY,
    },
    Camera: {
        'orthoSize': AnimTargetField.CameraOrthoSize,
    },
};

const COMPONENT_MAP: Record<string, AnimTargetComponent> = {
    Transform: AnimTargetComponent.Transform,
    Sprite: AnimTargetComponent.Sprite,
    UIRect: AnimTargetComponent.UIRect,
    Camera: AnimTargetComponent.Camera,
};

function resolveField(component: string, property: string): AnimTargetField {
    return FIELD_MAP[component]?.[property] ?? AnimTargetField.CustomField;
}

function allocString(module: ESEngineModule, str: string): [number, number] {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    const ptr = (module as any)._malloc(bytes.length);
    new Uint8Array((module as any).HEAPU8.buffer, ptr, bytes.length).set(bytes);
    return [ptr, bytes.length];
}

function freePtr(module: ESEngineModule, ptr: number): void {
    (module as any)._free(ptr);
}

export interface UploadedTrackInfo {
    type: string;
    component?: string;
    childPath: string;
    channelProperties?: string[];
}

export interface UploadResult {
    handle: number;
    tracks: UploadedTrackInfo[];
    totalPropertyChannels: number;
}

export function uploadTimelineToWasm(module: ESEngineModule, asset: TimelineAsset): UploadResult {
    const handle = module._tl_create(asset.duration, asset.wrapMode);
    if (!handle) return { handle: 0, tracks: [], totalPropertyChannels: 0 };

    const trackInfos: UploadedTrackInfo[] = [];
    let totalPropertyChannels = 0;

    for (const track of asset.tracks) {
        switch (track.type) {
            case TrackType.Property:
                uploadPropertyTrack(module, handle, track);
                trackInfos.push({
                    type: 'property',
                    component: track.component,
                    childPath: track.childPath,
                    channelProperties: track.channels.map(c => c.property),
                });
                totalPropertyChannels += track.channels.length;
                break;
            case TrackType.Spine:
                uploadSpineTrack(module, handle, track);
                trackInfos.push({ type: 'spine', childPath: track.childPath });
                break;
            case TrackType.Audio:
                uploadAudioTrack(module, handle, track);
                trackInfos.push({ type: 'audio', childPath: track.childPath });
                break;
            case TrackType.Activation:
                uploadActivationTrack(module, handle, track);
                trackInfos.push({ type: 'activation', childPath: track.childPath });
                break;
            case TrackType.SpriteAnim:
                uploadSpriteAnimTrack(module, handle, track);
                trackInfos.push({ type: 'spriteAnim', childPath: track.childPath });
                break;
        }
    }

    return { handle, tracks: trackInfos, totalPropertyChannels };
}

function uploadPropertyTrack(module: ESEngineModule, handle: number, track: PropertyTrack): void {
    const mod = module as any;
    const channelCount = track.channels.length;
    const component = COMPONENT_MAP[track.component] ?? AnimTargetComponent.Custom;
    const isCustom = component === AnimTargetComponent.Custom;

    if (isCustom) {
        uploadCustomPropertyTrack(module, handle, track);
        return;
    }

    const [childPtr, childLen] = allocString(module, track.childPath);

    const fieldsPtr = mod._malloc(channelCount);
    const fieldsArr = new Uint8Array(mod.HEAPU8.buffer, fieldsPtr, channelCount);
    for (let i = 0; i < channelCount; i++) {
        fieldsArr[i] = resolveField(track.component, track.channels[i].property);
    }

    let totalKeyframes = 0;
    const counts: number[] = [];
    for (const ch of track.channels) {
        counts.push(ch.keyframes.length);
        totalKeyframes += ch.keyframes.length;
    }

    const countsPtr = mod._malloc(channelCount * 4);
    new Int32Array(mod.HEAPU8.buffer, countsPtr, channelCount).set(counts);

    const dataPtr = mod._malloc(totalKeyframes * 4 * 4);
    const dataArr = new Float32Array(mod.HEAPU8.buffer, dataPtr, totalKeyframes * 4);
    let offset = 0;
    for (const ch of track.channels) {
        for (const kf of ch.keyframes) {
            dataArr[offset++] = kf.time;
            dataArr[offset++] = kf.value;
            dataArr[offset++] = kf.inTangent;
            dataArr[offset++] = kf.outTangent;
        }
    }

    module._tl_addPropertyTrack(handle, childPtr, childLen, component,
                                 fieldsPtr, channelCount, dataPtr, countsPtr);

    freePtr(module, childPtr);
    freePtr(module, fieldsPtr);
    freePtr(module, countsPtr);
    freePtr(module, dataPtr);
}

function uploadCustomPropertyTrack(module: ESEngineModule, handle: number, track: PropertyTrack): void {
    const mod = module as any;
    const channelCount = track.channels.length;

    const [childPtr, childLen] = allocString(module, track.childPath);
    const [compPtr, compLen] = allocString(module, track.component);

    const pathStrings = track.channels.map(c => new TextEncoder().encode(c.property));
    let totalPathBytes = 0;
    for (const p of pathStrings) totalPathBytes += p.length;

    const fieldPathsPtr = mod._malloc(totalPathBytes);
    let pathOffset = 0;
    for (const p of pathStrings) {
        new Uint8Array(mod.HEAPU8.buffer, fieldPathsPtr + pathOffset, p.length).set(p);
        pathOffset += p.length;
    }

    const fieldPathLensPtr = mod._malloc(channelCount * 4);
    new Int32Array(mod.HEAPU8.buffer, fieldPathLensPtr, channelCount).set(pathStrings.map(p => p.length));

    let totalKeyframes = 0;
    const counts: number[] = [];
    for (const ch of track.channels) {
        counts.push(ch.keyframes.length);
        totalKeyframes += ch.keyframes.length;
    }

    const countsPtr = mod._malloc(channelCount * 4);
    new Int32Array(mod.HEAPU8.buffer, countsPtr, channelCount).set(counts);

    const dataPtr = mod._malloc(totalKeyframes * 4 * 4);
    const dataArr = new Float32Array(mod.HEAPU8.buffer, dataPtr, totalKeyframes * 4);
    let dOffset = 0;
    for (const ch of track.channels) {
        for (const kf of ch.keyframes) {
            dataArr[dOffset++] = kf.time;
            dataArr[dOffset++] = kf.value;
            dataArr[dOffset++] = kf.inTangent;
            dataArr[dOffset++] = kf.outTangent;
        }
    }

    module._tl_addCustomPropertyTrack(handle, childPtr, childLen, compPtr, compLen,
                                       fieldPathsPtr, fieldPathLensPtr, channelCount,
                                       dataPtr, countsPtr);

    freePtr(module, childPtr);
    freePtr(module, compPtr);
    freePtr(module, fieldPathsPtr);
    freePtr(module, fieldPathLensPtr);
    freePtr(module, countsPtr);
    freePtr(module, dataPtr);
}

function uploadSpineTrack(module: ESEngineModule, handle: number, track: Track): void {
    if (track.type !== TrackType.Spine) return;
    const mod = module as any;
    const [childPtr, childLen] = allocString(module, track.childPath);
    const clipCount = track.clips.length;

    const floatsPtr = mod._malloc(clipCount * 4 * 4);
    const floats = new Float32Array(mod.HEAPU8.buffer, floatsPtr, clipCount * 4);
    const animPtrsPtr = mod._malloc(clipCount * 4);
    const animPtrs = new Uint32Array(mod.HEAPU8.buffer, animPtrsPtr, clipCount);
    const animLensPtr = mod._malloc(clipCount * 4);
    const animLens = new Int32Array(mod.HEAPU8.buffer, animLensPtr, clipCount);

    const animStrPtrs: number[] = [];
    for (let i = 0; i < clipCount; i++) {
        const clip = track.clips[i];
        floats[i * 4] = clip.start;
        floats[i * 4 + 1] = clip.duration;
        floats[i * 4 + 2] = clip.speed;
        floats[i * 4 + 3] = clip.loop ? 1.0 : 0.0;
        const [aPtr, aLen] = allocString(module, clip.animation);
        animPtrs[i] = aPtr;
        animLens[i] = aLen;
        animStrPtrs.push(aPtr);
    }

    module._tl_addSpineTrack(handle, childPtr, childLen,
                              floatsPtr, animPtrsPtr, animLensPtr, clipCount, track.blendIn);

    freePtr(module, childPtr);
    freePtr(module, floatsPtr);
    freePtr(module, animPtrsPtr);
    freePtr(module, animLensPtr);
    for (const p of animStrPtrs) freePtr(module, p);
}

function uploadAudioTrack(module: ESEngineModule, handle: number, track: Track): void {
    if (track.type !== TrackType.Audio) return;
    const mod = module as any;
    const [childPtr, childLen] = allocString(module, track.childPath);
    const eventCount = track.events.length;

    const floatsPtr = mod._malloc(eventCount * 2 * 4);
    const floats = new Float32Array(mod.HEAPU8.buffer, floatsPtr, eventCount * 2);
    const clipPtrsPtr = mod._malloc(eventCount * 4);
    const clipPtrs = new Uint32Array(mod.HEAPU8.buffer, clipPtrsPtr, eventCount);
    const clipLensPtr = mod._malloc(eventCount * 4);
    const clipLens = new Int32Array(mod.HEAPU8.buffer, clipLensPtr, eventCount);

    const strPtrs: number[] = [];
    for (let i = 0; i < eventCount; i++) {
        const evt = track.events[i];
        floats[i * 2] = evt.time;
        floats[i * 2 + 1] = evt.volume;
        const [cPtr, cLen] = allocString(module, evt.clip);
        clipPtrs[i] = cPtr;
        clipLens[i] = cLen;
        strPtrs.push(cPtr);
    }

    module._tl_addAudioTrack(handle, childPtr, childLen,
                              floatsPtr, clipPtrsPtr, clipLensPtr, eventCount);

    freePtr(module, childPtr);
    freePtr(module, floatsPtr);
    freePtr(module, clipPtrsPtr);
    freePtr(module, clipLensPtr);
    for (const p of strPtrs) freePtr(module, p);
}

function uploadActivationTrack(module: ESEngineModule, handle: number, track: Track): void {
    if (track.type !== TrackType.Activation) return;
    const mod = module as any;
    const [childPtr, childLen] = allocString(module, track.childPath);

    const rangesPtr = mod._malloc(track.ranges.length * 2 * 4);
    const rangesArr = new Float32Array(mod.HEAPU8.buffer, rangesPtr, track.ranges.length * 2);
    for (let i = 0; i < track.ranges.length; i++) {
        rangesArr[i * 2] = track.ranges[i].start;
        rangesArr[i * 2 + 1] = track.ranges[i].end;
    }

    module._tl_addActivationTrack(handle, childPtr, childLen,
                                   rangesPtr, track.ranges.length);

    freePtr(module, childPtr);
    freePtr(module, rangesPtr);
}

function uploadSpriteAnimTrack(module: ESEngineModule, handle: number, track: Track): void {
    if (track.type !== TrackType.SpriteAnim) return;
    const [childPtr, childLen] = allocString(module, track.childPath);
    const [clipPtr, clipLen] = allocString(module, track.clip);

    module._tl_addSpriteAnimTrack(handle, childPtr, childLen,
                                   clipPtr, clipLen, track.startTime);

    freePtr(module, childPtr);
    freePtr(module, clipPtr);
}
