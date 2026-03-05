import { WrapMode, TrackType, type TimelineAsset } from './TimelineTypes';
import {
    evaluatePropertyTrack,
    evaluateSpineTrack,
    evaluateSpriteAnimTrack,
    evaluateAudioTrack,
    evaluateActivationTrack,
    type SpineTrackAction,
    type SpriteAnimTrackAction,
    type AudioTrackAction,
} from './TimelineEvaluator';

export interface WrapResult {
    time: number;
    stopped: boolean;
}

export function applyWrapMode(time: number, duration: number, mode: WrapMode): WrapResult {
    if (time < 0) {
        return { time: 0, stopped: false };
    }

    if (time < duration) {
        return { time, stopped: false };
    }

    switch (mode) {
        case WrapMode.Once:
            return { time: duration, stopped: true };

        case WrapMode.Loop:
            return { time: time % duration, stopped: false };

        case WrapMode.PingPong: {
            const cycle = duration * 2;
            const t = time % cycle;
            if (t <= duration) {
                return { time: t, stopped: false };
            }
            return { time: cycle - t, stopped: false };
        }

        default:
            return { time: duration, stopped: true };
    }
}

export interface PropertyTrackResult {
    childPath: string;
    component: string;
    values: Map<string, number>;
}

export interface SpineTrackState {
    childPath: string;
    action: SpineTrackAction;
}

export interface SpriteAnimTrackState {
    childPath: string;
    action: SpriteAnimTrackAction;
}

export interface AudioTrackState {
    childPath: string;
    actions: AudioTrackAction[];
}

export interface ActivationTrackState {
    childPath: string;
    active: boolean;
}

export class TimelineInstance {
    readonly asset: TimelineAsset;
    currentTime = 0;
    playing = false;
    speed = 1;
    private previousTime_ = 0;
    private spineClipIndices_ = new Map<number, number>();

    constructor(asset: TimelineAsset) {
        this.asset = asset;
    }

    play(): void {
        this.currentTime = 0;
        this.previousTime_ = 0;
        this.playing = true;
        this.spineClipIndices_.clear();
    }

    pause(): void {
        this.playing = false;
    }

    stop(): void {
        this.playing = false;
        this.currentTime = 0;
        this.previousTime_ = 0;
        this.spineClipIndices_.clear();
    }

    setTime(time: number): void {
        this.previousTime_ = this.currentTime;
        this.currentTime = time;
    }

    get previousTime(): number {
        return this.previousTime_;
    }

    evaluatePropertyTracks(): PropertyTrackResult[] {
        const results: PropertyTrackResult[] = [];
        for (const track of this.asset.tracks) {
            if (track.type !== TrackType.Property) continue;
            const values = evaluatePropertyTrack(track, this.currentTime);
            if (values.size > 0) {
                results.push({
                    childPath: track.childPath,
                    component: track.component,
                    values,
                });
            }
        }
        return results;
    }

    evaluateSpineTracks(): SpineTrackState[] {
        const results: SpineTrackState[] = [];
        let trackIndex = 0;
        for (const track of this.asset.tracks) {
            if (track.type !== TrackType.Spine) {
                trackIndex++;
                continue;
            }
            const prevIndex = this.spineClipIndices_.get(trackIndex) ?? -1;
            const action = evaluateSpineTrack(track, this.currentTime, prevIndex);
            if (action) {
                this.spineClipIndices_.set(trackIndex, action.clipIndex);
                results.push({ childPath: track.childPath, action });
            }
            trackIndex++;
        }
        return results;
    }

    evaluateSpriteAnimTracks(): SpriteAnimTrackState[] {
        const results: SpriteAnimTrackState[] = [];
        for (const track of this.asset.tracks) {
            if (track.type !== TrackType.SpriteAnim) continue;
            const action = evaluateSpriteAnimTrack(track, this.currentTime, this.previousTime_);
            if (action) {
                results.push({ childPath: track.childPath, action });
            }
        }
        return results;
    }

    evaluateAudioTracks(): AudioTrackState[] {
        const results: AudioTrackState[] = [];
        for (const track of this.asset.tracks) {
            if (track.type !== TrackType.Audio) continue;
            const actions = evaluateAudioTrack(track, this.currentTime, this.previousTime_);
            if (actions.length > 0) {
                results.push({ childPath: track.childPath, actions });
            }
        }
        return results;
    }

    evaluateActivationTracks(): ActivationTrackState[] {
        const results: ActivationTrackState[] = [];
        for (const track of this.asset.tracks) {
            if (track.type !== TrackType.Activation) continue;
            const active = evaluateActivationTrack(track, this.currentTime);
            results.push({ childPath: track.childPath, active });
        }
        return results;
    }
}

export function advanceTimeline(instance: TimelineInstance, deltaTime: number): void {
    if (!instance.playing) return;

    instance.setTime(instance.currentTime + deltaTime * instance.speed);

    const wrap = applyWrapMode(instance.currentTime, instance.asset.duration, instance.asset.wrapMode);
    instance.currentTime = wrap.time;
    if (wrap.stopped) {
        instance.playing = false;
    }
}
