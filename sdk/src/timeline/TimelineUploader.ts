import type { ESEngineModule } from '../wasm';
import type { TimelineAsset, PropertyTrack, Track } from './TimelineTypes';
import { TrackType, InterpType } from './TimelineTypes';
import { withScratch } from '../wasmScratch';
export { AnimTargetField, AnimTargetComponent, FIELD_MAP, COMPONENT_MAP } from './animTargets.generated';
import { AnimTargetField, AnimTargetComponent, FIELD_MAP, COMPONENT_MAP } from './animTargets.generated';

const INTERP_TYPE_MAP: Record<string, number> = {
    [InterpType.Hermite]: 0,
    [InterpType.Linear]: 1,
    [InterpType.Step]: 2,
    [InterpType.EaseIn]: 3,
    [InterpType.EaseOut]: 4,
    [InterpType.EaseInOut]: 5,
};

function interpTypeToNum(interp?: InterpType): number {
    if (!interp) return 0;
    return INTERP_TYPE_MAP[interp] ?? 0;
}

function resolveField(component: string, property: string): AnimTargetField {
    return FIELD_MAP[component]?.[property] ?? AnimTargetField.CustomField;
}

function allocString(
    module: ESEngineModule,
    alloc: (size: number) => number,
    str: string,
): [number, number] {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    const ptr = alloc(bytes.length);
    new Uint8Array(module.HEAPU8.buffer, ptr, bytes.length).set(bytes);
    return [ptr, bytes.length];
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
    const channelCount = track.channels.length;
    const component = COMPONENT_MAP[track.component] ?? AnimTargetComponent.Custom;
    const isCustom = component === AnimTargetComponent.Custom;

    if (isCustom) {
        uploadCustomPropertyTrack(module, handle, track);
        return;
    }

    withScratch(module, alloc => {
        const [childPtr, childLen] = allocString(module, alloc, track.childPath);

        const fieldsPtr = alloc(channelCount);
        const fieldsArr = new Uint8Array(module.HEAPU8.buffer, fieldsPtr, channelCount);
        for (let i = 0; i < channelCount; i++) {
            fieldsArr[i] = resolveField(track.component, track.channels[i].property);
        }

        let totalKeyframes = 0;
        const counts: number[] = [];
        for (const ch of track.channels) {
            counts.push(ch.keyframes.length);
            totalKeyframes += ch.keyframes.length;
        }

        const countsPtr = alloc(channelCount * 4);
        new Int32Array(module.HEAPU8.buffer, countsPtr, channelCount).set(counts);

        const dataPtr = alloc(totalKeyframes * 5 * 4);
        const dataArr = new Float32Array(module.HEAPU8.buffer, dataPtr, totalKeyframes * 5);
        let offset = 0;
        for (const ch of track.channels) {
            for (const kf of ch.keyframes) {
                dataArr[offset++] = kf.time;
                dataArr[offset++] = kf.value;
                dataArr[offset++] = kf.inTangent;
                dataArr[offset++] = kf.outTangent;
                dataArr[offset++] = interpTypeToNum(kf.interpolation);
            }
        }

        module._tl_addPropertyTrack(handle, childPtr, childLen, component,
                                     fieldsPtr, channelCount, dataPtr, countsPtr);
    });
}

function uploadCustomPropertyTrack(module: ESEngineModule, handle: number, track: PropertyTrack): void {
    const channelCount = track.channels.length;

    withScratch(module, alloc => {
        const [childPtr, childLen] = allocString(module, alloc, track.childPath);
        const [compPtr, compLen] = allocString(module, alloc, track.component);

        const pathStrings = track.channels.map(c => new TextEncoder().encode(c.property));
        let totalPathBytes = 0;
        for (const p of pathStrings) totalPathBytes += p.length;

        const fieldPathsPtr = alloc(totalPathBytes);
        let pathOffset = 0;
        for (const p of pathStrings) {
            new Uint8Array(module.HEAPU8.buffer, fieldPathsPtr + pathOffset, p.length).set(p);
            pathOffset += p.length;
        }

        const fieldPathLensPtr = alloc(channelCount * 4);
        new Int32Array(module.HEAPU8.buffer, fieldPathLensPtr, channelCount).set(pathStrings.map(p => p.length));

        let totalKeyframes = 0;
        const counts: number[] = [];
        for (const ch of track.channels) {
            counts.push(ch.keyframes.length);
            totalKeyframes += ch.keyframes.length;
        }

        const countsPtr = alloc(channelCount * 4);
        new Int32Array(module.HEAPU8.buffer, countsPtr, channelCount).set(counts);

        const dataPtr = alloc(totalKeyframes * 5 * 4);
        const dataArr = new Float32Array(module.HEAPU8.buffer, dataPtr, totalKeyframes * 5);
        let dOffset = 0;
        for (const ch of track.channels) {
            for (const kf of ch.keyframes) {
                dataArr[dOffset++] = kf.time;
                dataArr[dOffset++] = kf.value;
                dataArr[dOffset++] = kf.inTangent;
                dataArr[dOffset++] = kf.outTangent;
                dataArr[dOffset++] = interpTypeToNum(kf.interpolation);
            }
        }

        module._tl_addCustomPropertyTrack(handle, childPtr, childLen, compPtr, compLen,
                                           fieldPathsPtr, fieldPathLensPtr, channelCount,
                                           dataPtr, countsPtr);
    });
}

function uploadSpineTrack(module: ESEngineModule, handle: number, track: Track): void {
    if (track.type !== TrackType.Spine) return;
    withScratch(module, alloc => {
        const [childPtr, childLen] = allocString(module, alloc, track.childPath);
        const clipCount = track.clips.length;

        const floatsPtr = alloc(clipCount * 4 * 4);
        const floats = new Float32Array(module.HEAPU8.buffer, floatsPtr, clipCount * 4);
        const animPtrsPtr = alloc(clipCount * 4);
        const animPtrs = new Uint32Array(module.HEAPU8.buffer, animPtrsPtr, clipCount);
        const animLensPtr = alloc(clipCount * 4);
        const animLens = new Int32Array(module.HEAPU8.buffer, animLensPtr, clipCount);

        for (let i = 0; i < clipCount; i++) {
            const clip = track.clips[i];
            floats[i * 4] = clip.start;
            floats[i * 4 + 1] = clip.duration;
            floats[i * 4 + 2] = clip.speed;
            floats[i * 4 + 3] = clip.loop ? 1.0 : 0.0;
            const [aPtr, aLen] = allocString(module, alloc, clip.animation);
            animPtrs[i] = aPtr;
            animLens[i] = aLen;
        }

        module._tl_addSpineTrack(handle, childPtr, childLen,
                                  floatsPtr, animPtrsPtr, animLensPtr, clipCount, track.blendIn);
    });
}

function uploadAudioTrack(module: ESEngineModule, handle: number, track: Track): void {
    if (track.type !== TrackType.Audio) return;
    withScratch(module, alloc => {
        const [childPtr, childLen] = allocString(module, alloc, track.childPath);
        const eventCount = track.events.length;

        const floatsPtr = alloc(eventCount * 2 * 4);
        const floats = new Float32Array(module.HEAPU8.buffer, floatsPtr, eventCount * 2);
        const clipPtrsPtr = alloc(eventCount * 4);
        const clipPtrs = new Uint32Array(module.HEAPU8.buffer, clipPtrsPtr, eventCount);
        const clipLensPtr = alloc(eventCount * 4);
        const clipLens = new Int32Array(module.HEAPU8.buffer, clipLensPtr, eventCount);

        for (let i = 0; i < eventCount; i++) {
            const evt = track.events[i];
            floats[i * 2] = evt.time;
            floats[i * 2 + 1] = evt.volume;
            const [cPtr, cLen] = allocString(module, alloc, evt.clip);
            clipPtrs[i] = cPtr;
            clipLens[i] = cLen;
        }

        module._tl_addAudioTrack(handle, childPtr, childLen,
                                  floatsPtr, clipPtrsPtr, clipLensPtr, eventCount);
    });
}

function uploadActivationTrack(module: ESEngineModule, handle: number, track: Track): void {
    if (track.type !== TrackType.Activation) return;
    withScratch(module, alloc => {
        const [childPtr, childLen] = allocString(module, alloc, track.childPath);

        const rangesPtr = alloc(track.ranges.length * 2 * 4);
        const rangesArr = new Float32Array(module.HEAPU8.buffer, rangesPtr, track.ranges.length * 2);
        for (let i = 0; i < track.ranges.length; i++) {
            rangesArr[i * 2] = track.ranges[i].start;
            rangesArr[i * 2 + 1] = track.ranges[i].end;
        }

        module._tl_addActivationTrack(handle, childPtr, childLen,
                                       rangesPtr, track.ranges.length);
    });
}

function uploadSpriteAnimTrack(module: ESEngineModule, handle: number, track: Track): void {
    if (track.type !== TrackType.SpriteAnim) return;
    withScratch(module, alloc => {
        const [childPtr, childLen] = allocString(module, alloc, track.childPath);
        const [clipPtr, clipLen] = allocString(module, alloc, track.clip);

        module._tl_addSpriteAnimTrack(handle, childPtr, childLen,
                                       clipPtr, clipLen, track.startTime);
    });
}
