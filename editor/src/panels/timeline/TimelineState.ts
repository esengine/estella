export const TRACK_HEIGHT = 28;
export const HEADER_HEIGHT = 24;
export const RULER_HEIGHT = 24;
export const TRACK_LIST_WIDTH = 200;
export const MIN_PIXELS_PER_SECOND = 20;
export const MAX_PIXELS_PER_SECOND = 500;
export const DEFAULT_PIXELS_PER_SECOND = 100;
export const KEYFRAME_SIZE = 8;
export const SNAP_THRESHOLD = 5;

export type TrackType = 'property' | 'spine' | 'spriteAnim' | 'audio' | 'activation';

export interface TimelineTrackState {
    index: number;
    name: string;
    type: TrackType;
    expanded: boolean;
    channelCount: number;
}

export class TimelineState {
    pixelsPerSecond = DEFAULT_PIXELS_PER_SECOND;
    scrollX = 0;
    scrollY = 0;
    playheadTime = 0;
    duration = 5;
    playing = false;
    recording = false;
    selectedTrackIndex = -1;
    selectedKeyframes: Set<string> = new Set();
    tracks: TimelineTrackState[] = [];
    private listeners_: (() => void)[] = [];

    onChange(fn: () => void): () => void {
        this.listeners_.push(fn);
        return () => {
            this.listeners_ = this.listeners_.filter(l => l !== fn);
        };
    }

    notify(): void {
        for (const fn of this.listeners_) fn();
    }

    timeToX(time: number): number {
        return time * this.pixelsPerSecond - this.scrollX;
    }

    xToTime(x: number): number {
        return (x + this.scrollX) / this.pixelsPerSecond;
    }

    zoom(delta: number, pivotX: number): void {
        const timeBefore = this.xToTime(pivotX);
        this.pixelsPerSecond = Math.min(
            MAX_PIXELS_PER_SECOND,
            Math.max(MIN_PIXELS_PER_SECOND, this.pixelsPerSecond * (1 + delta * 0.001)),
        );
        this.scrollX = timeBefore * this.pixelsPerSecond - pivotX;
        if (this.scrollX < 0) this.scrollX = 0;
        this.notify();
    }

    setPlayhead(time: number): void {
        this.playheadTime = Math.max(0, Math.min(time, this.duration));
        this.notify();
    }

    formatTime(seconds: number): string {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toFixed(2).padStart(5, '0')}`;
    }

    getTrackY(trackIndex: number): number {
        let y = 0;
        for (let i = 0; i < trackIndex && i < this.tracks.length; i++) {
            y += TRACK_HEIGHT;
            if (this.tracks[i].expanded) {
                y += this.tracks[i].channelCount * TRACK_HEIGHT;
            }
        }
        return y - this.scrollY;
    }

    getTotalTracksHeight(): number {
        let h = 0;
        for (const track of this.tracks) {
            h += TRACK_HEIGHT;
            if (track.expanded) {
                h += track.channelCount * TRACK_HEIGHT;
            }
        }
        return h;
    }
}
