import type { App, Plugin } from '../app';
import { defineSystem, Schedule } from '../system';
import { Res } from '../resource';
import { Time, type TimeData } from '../resource';
import { defineComponent, getComponent } from '../component';
import { isEditor, isPlayMode } from '../env';
import { WrapMode, TrackType, type TimelineAsset, type AnimFramesTrack } from './TimelineTypes';
import { parseTimelineAsset } from './TimelineLoader';
import { uploadTimelineToWasm, type UploadResult } from './TimelineUploader';
import { setTimelineHandle, setTimelineModule } from './TimelineControl';
import {
    resolveTrackTargets,
    advanceAndProcess,
} from './TimelineRuntime';
import type { ESEngineModule } from '../wasm';
import type { Entity } from '../types';

export { setNestedProperty } from './TimelineRuntime';

export interface TimelinePlayerData {
    timeline: string;
    playing: boolean;
    speed: number;
    wrapMode: string;
}

export const TimelinePlayer = defineComponent<TimelinePlayerData>('TimelinePlayer', {
    timeline: '',
    playing: false,
    speed: 1.0,
    wrapMode: 'once',
}, {
    assetFields: [{ field: 'timeline', type: 'timeline' }],
});

const loadedAssets_ = new Map<string, TimelineAsset>();

export function registerTimelineAsset(path: string, asset: TimelineAsset): void {
    loadedAssets_.set(path, asset);
}

export function getTimelineAsset(path: string): TimelineAsset | undefined {
    return loadedAssets_.get(path);
}

const textureHandles_ = new Map<string, Map<string, number>>();

export function registerTimelineTextureHandles(path: string, handles: Map<string, number>): void {
    textureHandles_.set(path, handles);
}

export function getTimelineTextureHandle(timelinePath: string, textureUuid: string): number {
    return textureHandles_.get(timelinePath)?.get(textureUuid) ?? 0;
}

const WRAP_MODE_MAP: Record<string, number> = {
    once: WrapMode.Once,
    loop: WrapMode.Loop,
    pingPong: WrapMode.PingPong,
};

interface AnimFramesState {
    tracks: AnimFramesTrack[];
    lastFrameIndices: number[];
}

export class TimelinePlugin implements Plugin {
    name = 'TimelinePlugin';

    private handles_ = new Map<number, UploadResult>();
    private animFramesStates_ = new Map<number, AnimFramesState>();

    build(app: App): void {
        const world = app.world;

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Time)],
            (time: TimeData) => {
                if (isEditor() && !isPlayMode()) return;

                const module = world.getWasmModule() as ESEngineModule;
                if (!module) return;

                setTimelineModule(module);
                const registry = world.getCppRegistry() as any;

                const entities = world.getEntitiesWithComponents([TimelinePlayer]);
                for (const entity of entities) {
                    const playerData = world.get(entity, TimelinePlayer) as TimelinePlayerData;
                    if (!playerData.timeline) continue;

                    let uploadResult = this.handles_.get(entity);
                    if (!uploadResult) {
                        const asset = loadedAssets_.get(playerData.timeline);
                        if (!asset) continue;
                        uploadResult = uploadTimelineToWasm(module, asset);
                        if (!uploadResult.handle) continue;
                        resolveTrackTargets(world, module, uploadResult, entity);
                        this.handles_.set(entity, uploadResult);
                        setTimelineHandle(entity, uploadResult.handle);

                        const afTracks = asset.tracks.filter(
                            (t): t is AnimFramesTrack => t.type === TrackType.AnimFrames,
                        );
                        if (afTracks.length > 0) {
                            this.animFramesStates_.set(entity, {
                                tracks: afTracks,
                                lastFrameIndices: afTracks.map(() => -1),
                            });
                        }
                    }

                    const handle = uploadResult.handle;

                    if (playerData.playing && !module._tl_isPlaying(handle)) {
                        const currentTime = module._tl_getTime(handle);
                        if (currentTime === 0) {
                            module._tl_play(handle);
                        } else {
                            module._tl_play(handle);
                            module._tl_setTime(handle, currentTime);
                        }
                    } else if (!playerData.playing && module._tl_isPlaying(handle)) {
                        module._tl_pause(handle);
                    }

                    const wrapModeNum = WRAP_MODE_MAP[playerData.wrapMode] ?? WrapMode.Once;
                    module._tl_setWrapMode(handle, wrapModeNum);

                    advanceAndProcess(world, module, handle, entity, time.delta, playerData.speed, uploadResult);
                    this.processAnimFrames(world, module, entity, handle, playerData.timeline);

                    if (!module._tl_isPlaying(handle) && playerData.playing) {
                        playerData.playing = false;
                        world.insert(entity, TimelinePlayer, playerData);
                    }
                }
            },
            { name: 'TimelineSystem' },
        ));
    }

    clearHandles(): void {
        this.handles_.clear();
        this.animFramesStates_.clear();
    }

    cleanup(): void {
        this.handles_.clear();
        this.animFramesStates_.clear();
        loadedAssets_.clear();
    }

    private processAnimFrames(
        world: any, module: ESEngineModule, entity: Entity, handle: number,
        timelinePath: string,
    ): void {
        const state = this.animFramesStates_.get(entity);
        if (!state) return;

        const currentTime = module._tl_getTime(handle);
        const Sprite = getComponent('Sprite');
        if (!Sprite || !world.has(entity, Sprite)) return;

        const DEFAULT_DURATION = 1.0 / 12;

        for (let t = 0; t < state.tracks.length; t++) {
            const track = state.tracks[t];
            const frames = track.frames;
            if (frames.length === 0) continue;

            let elapsed = 0;
            let frameIndex = 0;
            for (let i = 0; i < frames.length; i++) {
                const dur = frames[i].duration ?? DEFAULT_DURATION;
                if (currentTime < elapsed + dur) {
                    frameIndex = i;
                    break;
                }
                elapsed += dur;
                if (i === frames.length - 1) {
                    frameIndex = frames.length - 1;
                }
            }

            if (frameIndex !== state.lastFrameIndices[t]) {
                state.lastFrameIndices[t] = frameIndex;
                const textureUuid = frames[frameIndex].texture;
                const textureHandle = getTimelineTextureHandle(timelinePath, textureUuid);
                if (textureHandle) {
                    const sprite = world.get(entity, Sprite);
                    sprite.texture = textureHandle;
                    world.set(entity, Sprite, sprite);
                }
            }
        }
    }
}

export const timelinePlugin = new TimelinePlugin();
