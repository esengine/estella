import { BaseCommand } from '../../commands/Command';
import type { Command } from '../../commands/Command';
import type { TimelineAssetData } from './TimelineKeyframeArea';

const MERGE_THRESHOLD_MS = 300;

interface SpineClip {
    start: number;
    duration: number;
    animation: string;
}

interface AudioEvent {
    time: number;
    clip: string;
}

interface ActivationRange {
    start: number;
    end: number;
}

function getSpineClips(data: TimelineAssetData, trackIndex: number): SpineClip[] | null {
    const track = data.tracks[trackIndex];
    if (!track || track.type !== 'spine') return null;
    if (!track.clips) track.clips = [];
    return track.clips as SpineClip[];
}

function getAudioEvents(data: TimelineAssetData, trackIndex: number): AudioEvent[] | null {
    const track = data.tracks[trackIndex];
    if (!track || track.type !== 'audio') return null;
    if (!track.events) track.events = [];
    return track.events as AudioEvent[];
}

function getActivationRanges(data: TimelineAssetData, trackIndex: number): ActivationRange[] | null {
    const track = data.tracks[trackIndex];
    if (!track || track.type !== 'activation') return null;
    if (!track.ranges) track.ranges = [];
    return track.ranges;
}

// =============================================================================
// Spine Clip Commands
// =============================================================================

export class AddSpineClipCommand extends BaseCommand {
    readonly type = 'timeline_add_spine_clip';
    readonly description = 'Add spine clip';
    private insertedIndex_ = -1;

    constructor(
        private data_: TimelineAssetData,
        private trackIndex_: number,
        private clip_: SpineClip,
        private onChanged_: () => void,
    ) {
        super();
    }

    execute(): void {
        const clips = getSpineClips(this.data_, this.trackIndex_);
        if (!clips) return;

        let idx = clips.findIndex(c => c.start > this.clip_.start);
        if (idx === -1) idx = clips.length;

        clips.splice(idx, 0, { ...this.clip_ });
        this.insertedIndex_ = idx;
        this.onChanged_();
    }

    undo(): void {
        const clips = getSpineClips(this.data_, this.trackIndex_);
        if (!clips || this.insertedIndex_ < 0) return;

        clips.splice(this.insertedIndex_, 1);
        this.insertedIndex_ = -1;
        this.onChanged_();
    }
}

export class MoveSpineClipCommand extends BaseCommand {
    readonly type = 'timeline_move_spine_clip';
    readonly description = 'Move spine clip';
    readonly newStart: number;

    constructor(
        private data_: TimelineAssetData,
        private trackIndex_: number,
        private clipIndex_: number,
        private oldStart_: number,
        newStart: number,
        private onChanged_: () => void,
    ) {
        super();
        this.newStart = newStart;
    }

    execute(): void {
        const clips = getSpineClips(this.data_, this.trackIndex_);
        if (!clips) return;

        const clip = clips[this.clipIndex_];
        if (clip) {
            clip.start = this.newStart;
        }
        this.onChanged_();
    }

    undo(): void {
        const clips = getSpineClips(this.data_, this.trackIndex_);
        if (!clips) return;

        const clip = clips[this.clipIndex_];
        if (clip) {
            clip.start = this.oldStart_;
        }
        this.onChanged_();
    }

    override canMerge(other: Command): boolean {
        if (!(other instanceof MoveSpineClipCommand)) return false;
        if (other.trackIndex_ !== this.trackIndex_) return false;
        if (other.clipIndex_ !== this.clipIndex_) return false;
        return other.timestamp - this.timestamp < MERGE_THRESHOLD_MS;
    }

    override merge(other: Command): Command {
        if (!(other instanceof MoveSpineClipCommand)) return this;
        return new MoveSpineClipCommand(
            this.data_, this.trackIndex_, this.clipIndex_,
            this.oldStart_, other.newStart, this.onChanged_,
        );
    }
}

export class ResizeSpineClipCommand extends BaseCommand {
    readonly type = 'timeline_resize_spine_clip';
    readonly description = 'Resize spine clip';

    constructor(
        private data_: TimelineAssetData,
        private trackIndex_: number,
        private clipIndex_: number,
        private oldDuration_: number,
        private newDuration_: number,
        private onChanged_: () => void,
    ) {
        super();
    }

    execute(): void {
        const clips = getSpineClips(this.data_, this.trackIndex_);
        if (!clips) return;

        const clip = clips[this.clipIndex_];
        if (clip) {
            clip.duration = this.newDuration_;
        }
        this.onChanged_();
    }

    undo(): void {
        const clips = getSpineClips(this.data_, this.trackIndex_);
        if (!clips) return;

        const clip = clips[this.clipIndex_];
        if (clip) {
            clip.duration = this.oldDuration_;
        }
        this.onChanged_();
    }
}

export class DeleteSpineClipCommand extends BaseCommand {
    readonly type = 'timeline_delete_spine_clip';
    readonly description = 'Delete spine clip';
    private deleted_: SpineClip | null = null;

    constructor(
        private data_: TimelineAssetData,
        private trackIndex_: number,
        private clipIndex_: number,
        private onChanged_: () => void,
    ) {
        super();
    }

    execute(): void {
        const clips = getSpineClips(this.data_, this.trackIndex_);
        if (!clips) return;

        this.deleted_ = clips.splice(this.clipIndex_, 1)[0] ?? null;
        this.onChanged_();
    }

    undo(): void {
        const clips = getSpineClips(this.data_, this.trackIndex_);
        if (!clips || !this.deleted_) return;

        clips.splice(this.clipIndex_, 0, this.deleted_);
        this.deleted_ = null;
        this.onChanged_();
    }
}

// =============================================================================
// Audio Event Commands
// =============================================================================

export class AddAudioEventCommand extends BaseCommand {
    readonly type = 'timeline_add_audio_event';
    readonly description = 'Add audio event';
    private insertedIndex_ = -1;

    constructor(
        private data_: TimelineAssetData,
        private trackIndex_: number,
        private event_: AudioEvent,
        private onChanged_: () => void,
    ) {
        super();
    }

    execute(): void {
        const events = getAudioEvents(this.data_, this.trackIndex_);
        if (!events) return;

        let idx = events.findIndex(e => e.time > this.event_.time);
        if (idx === -1) idx = events.length;

        events.splice(idx, 0, { ...this.event_ });
        this.insertedIndex_ = idx;
        this.onChanged_();
    }

    undo(): void {
        const events = getAudioEvents(this.data_, this.trackIndex_);
        if (!events || this.insertedIndex_ < 0) return;

        events.splice(this.insertedIndex_, 1);
        this.insertedIndex_ = -1;
        this.onChanged_();
    }
}

export class MoveAudioEventCommand extends BaseCommand {
    readonly type = 'timeline_move_audio_event';
    readonly description = 'Move audio event';
    readonly newTime: number;

    constructor(
        private data_: TimelineAssetData,
        private trackIndex_: number,
        private eventIndex_: number,
        private oldTime_: number,
        newTime: number,
        private onChanged_: () => void,
    ) {
        super();
        this.newTime = newTime;
    }

    execute(): void {
        const events = getAudioEvents(this.data_, this.trackIndex_);
        if (!events) return;

        const event = events[this.eventIndex_];
        if (event) event.time = this.newTime;
        this.onChanged_();
    }

    undo(): void {
        const events = getAudioEvents(this.data_, this.trackIndex_);
        if (!events) return;

        const event = events[this.eventIndex_];
        if (event) event.time = this.oldTime_;
        this.onChanged_();
    }

    override canMerge(other: Command): boolean {
        if (!(other instanceof MoveAudioEventCommand)) return false;
        if (other.trackIndex_ !== this.trackIndex_) return false;
        if (other.eventIndex_ !== this.eventIndex_) return false;
        return other.timestamp - this.timestamp < MERGE_THRESHOLD_MS;
    }

    override merge(other: Command): Command {
        if (!(other instanceof MoveAudioEventCommand)) return this;
        return new MoveAudioEventCommand(
            this.data_, this.trackIndex_, this.eventIndex_,
            this.oldTime_, other.newTime, this.onChanged_,
        );
    }
}

export class DeleteAudioEventCommand extends BaseCommand {
    readonly type = 'timeline_delete_audio_event';
    readonly description = 'Delete audio event';
    private deleted_: AudioEvent | null = null;

    constructor(
        private data_: TimelineAssetData,
        private trackIndex_: number,
        private eventIndex_: number,
        private onChanged_: () => void,
    ) {
        super();
    }

    execute(): void {
        const events = getAudioEvents(this.data_, this.trackIndex_);
        if (!events) return;

        this.deleted_ = events.splice(this.eventIndex_, 1)[0] ?? null;
        this.onChanged_();
    }

    undo(): void {
        const events = getAudioEvents(this.data_, this.trackIndex_);
        if (!events || !this.deleted_) return;

        events.splice(this.eventIndex_, 0, this.deleted_);
        this.deleted_ = null;
        this.onChanged_();
    }
}

// =============================================================================
// Activation Range Commands
// =============================================================================

export class AddActivationRangeCommand extends BaseCommand {
    readonly type = 'timeline_add_activation_range';
    readonly description = 'Add activation range';

    constructor(
        private data_: TimelineAssetData,
        private trackIndex_: number,
        private range_: ActivationRange,
        private onChanged_: () => void,
    ) {
        super();
    }

    execute(): void {
        const ranges = getActivationRanges(this.data_, this.trackIndex_);
        if (!ranges) return;

        ranges.push({ ...this.range_ });
        this.onChanged_();
    }

    undo(): void {
        const ranges = getActivationRanges(this.data_, this.trackIndex_);
        if (!ranges) return;

        ranges.pop();
        this.onChanged_();
    }
}

export class MoveActivationRangeCommand extends BaseCommand {
    readonly type = 'timeline_move_activation_range';
    readonly description = 'Move activation range';
    readonly newStart: number;
    readonly newEnd: number;

    constructor(
        private data_: TimelineAssetData,
        private trackIndex_: number,
        private rangeIndex_: number,
        private oldStart_: number,
        private oldEnd_: number,
        newStart: number,
        newEnd: number,
        private onChanged_: () => void,
    ) {
        super();
        this.newStart = newStart;
        this.newEnd = newEnd;
    }

    execute(): void {
        const ranges = getActivationRanges(this.data_, this.trackIndex_);
        if (!ranges) return;

        const range = ranges[this.rangeIndex_];
        if (range) {
            range.start = this.newStart;
            range.end = this.newEnd;
        }
        this.onChanged_();
    }

    undo(): void {
        const ranges = getActivationRanges(this.data_, this.trackIndex_);
        if (!ranges) return;

        const range = ranges[this.rangeIndex_];
        if (range) {
            range.start = this.oldStart_;
            range.end = this.oldEnd_;
        }
        this.onChanged_();
    }

    override canMerge(other: Command): boolean {
        if (!(other instanceof MoveActivationRangeCommand)) return false;
        if (other.trackIndex_ !== this.trackIndex_) return false;
        if (other.rangeIndex_ !== this.rangeIndex_) return false;
        return other.timestamp - this.timestamp < MERGE_THRESHOLD_MS;
    }

    override merge(other: Command): Command {
        if (!(other instanceof MoveActivationRangeCommand)) return this;
        return new MoveActivationRangeCommand(
            this.data_, this.trackIndex_, this.rangeIndex_,
            this.oldStart_, this.oldEnd_,
            other.newStart, other.newEnd, this.onChanged_,
        );
    }
}

export class DeleteActivationRangeCommand extends BaseCommand {
    readonly type = 'timeline_delete_activation_range';
    readonly description = 'Delete activation range';
    private deleted_: ActivationRange | null = null;

    constructor(
        private data_: TimelineAssetData,
        private trackIndex_: number,
        private rangeIndex_: number,
        private onChanged_: () => void,
    ) {
        super();
    }

    execute(): void {
        const ranges = getActivationRanges(this.data_, this.trackIndex_);
        if (!ranges) return;

        this.deleted_ = ranges.splice(this.rangeIndex_, 1)[0] ?? null;
        this.onChanged_();
    }

    undo(): void {
        const ranges = getActivationRanges(this.data_, this.trackIndex_);
        if (!ranges || !this.deleted_) return;

        ranges.splice(this.rangeIndex_, 0, this.deleted_);
        this.deleted_ = null;
        this.onChanged_();
    }
}
