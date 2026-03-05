import type {
    PropertyChannel,
    PropertyTrack,
    SpineTrack,
    SpriteAnimTrack,
    AudioTrack,
    ActivationTrack,
} from './TimelineTypes';

export function hermiteInterpolate(
    p0: number,
    p1: number,
    m0: number,
    m1: number,
    t: number,
): number {
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1;
}

export function evaluateChannel(channel: PropertyChannel, time: number): number | undefined {
    const kfs = channel.keyframes;
    if (kfs.length === 0) return undefined;
    if (kfs.length === 1) return kfs[0].value;

    if (time <= kfs[0].time) return kfs[0].value;
    if (time >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].value;

    let i = 0;
    while (i < kfs.length - 1 && kfs[i + 1].time <= time) {
        i++;
    }

    const k0 = kfs[i];
    const k1 = kfs[i + 1];
    const dt = k1.time - k0.time;
    const t = (time - k0.time) / dt;
    return hermiteInterpolate(k0.value, k1.value, k0.outTangent * dt, k1.inTangent * dt, t);
}

export function evaluatePropertyTrack(track: PropertyTrack, time: number): Map<string, number> {
    const result = new Map<string, number>();
    for (const channel of track.channels) {
        const value = evaluateChannel(channel, time);
        if (value !== undefined) {
            result.set(channel.property, value);
        }
    }
    return result;
}

export interface SpineTrackAction {
    action: 'play' | 'stop';
    animation: string;
    loop: boolean;
    speed: number;
    clipIndex: number;
}

function findActiveClipIndex(track: SpineTrack, time: number): number {
    for (let i = track.clips.length - 1; i >= 0; i--) {
        const clip = track.clips[i];
        if (time >= clip.start && time < clip.start + clip.duration) {
            return i;
        }
    }
    return -1;
}

export function evaluateSpineTrack(
    track: SpineTrack,
    time: number,
    previousClipIndex: number,
): SpineTrackAction | null {
    if (track.clips.length === 0) return null;

    const currentIndex = findActiveClipIndex(track, time);

    if (currentIndex === previousClipIndex) return null;

    if (currentIndex === -1) {
        if (previousClipIndex >= 0) {
            return { action: 'stop', animation: '', loop: false, speed: 1, clipIndex: -1 };
        }
        return null;
    }

    const clip = track.clips[currentIndex];
    return {
        action: 'play',
        animation: clip.animation,
        loop: clip.loop,
        speed: clip.speed,
        clipIndex: currentIndex,
    };
}

export interface SpriteAnimTrackAction {
    action: 'play';
    clip: string;
}

export function evaluateSpriteAnimTrack(
    track: SpriteAnimTrack,
    time: number,
    previousTime: number,
): SpriteAnimTrackAction | null {
    if (previousTime <= track.startTime && time >= track.startTime && time > previousTime) {
        return { action: 'play', clip: track.clip };
    }
    return null;
}

export interface AudioTrackAction {
    clip: string;
    volume: number;
}

export function evaluateAudioTrack(
    track: AudioTrack,
    time: number,
    previousTime: number,
): AudioTrackAction[] {
    const triggered: AudioTrackAction[] = [];
    for (const event of track.events) {
        if (event.time > previousTime && event.time <= time) {
            triggered.push({ clip: event.clip, volume: event.volume });
        }
    }
    return triggered;
}

export function evaluateActivationTrack(track: ActivationTrack, time: number): boolean {
    for (const range of track.ranges) {
        if (time >= range.start && time < range.end) {
            return true;
        }
    }
    return false;
}
