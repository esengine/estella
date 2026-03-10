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

interface MarkerData {
    time: number;
    name: string;
}

function getMarkers(data: TimelineAssetData, trackIndex: number): MarkerData[] | null {
    const track = data.tracks[trackIndex];
    if (!track || track.type !== 'marker') return null;
    if (!track.markers) track.markers = [];
    return track.markers as MarkerData[];
}

interface CustomEventData {
    time: number;
    name: string;
    payload: Record<string, unknown>;
}

function getCustomEvents(data: TimelineAssetData, trackIndex: number): CustomEventData[] | null {
    const track = data.tracks[trackIndex];
    if (!track || track.type !== 'customEvent') return null;
    if (!track.customEvents) track.customEvents = [];
    return track.customEvents as CustomEventData[];
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

export class ResizeActivationRangeCommand extends BaseCommand {
    readonly type = 'timeline_resize_activation_range';
    readonly description = 'Resize activation range';
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
        if (!(other instanceof ResizeActivationRangeCommand)) return false;
        if (other.trackIndex_ !== this.trackIndex_) return false;
        if (other.rangeIndex_ !== this.rangeIndex_) return false;
        return other.timestamp - this.timestamp < MERGE_THRESHOLD_MS;
    }

    override merge(other: Command): Command {
        if (!(other instanceof ResizeActivationRangeCommand)) return this;
        return new ResizeActivationRangeCommand(
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

// =============================================================================
// Marker Commands
// =============================================================================

export class AddMarkerCommand extends BaseCommand {
    readonly type = 'timeline_add_marker';
    readonly description = 'Add marker';
    private insertedIndex_ = -1;

    constructor(
        private data_: TimelineAssetData,
        private trackIndex_: number,
        private marker_: MarkerData,
        private onChanged_: () => void,
    ) {
        super();
    }

    execute(): void {
        const markers = getMarkers(this.data_, this.trackIndex_);
        if (!markers) return;
        let idx = markers.findIndex(m => m.time > this.marker_.time);
        if (idx === -1) idx = markers.length;
        markers.splice(idx, 0, { ...this.marker_ });
        this.insertedIndex_ = idx;
        this.onChanged_();
    }

    undo(): void {
        const markers = getMarkers(this.data_, this.trackIndex_);
        if (!markers || this.insertedIndex_ < 0) return;
        markers.splice(this.insertedIndex_, 1);
        this.insertedIndex_ = -1;
        this.onChanged_();
    }
}

export class MoveMarkerCommand extends BaseCommand {
    readonly type = 'timeline_move_marker';
    readonly description = 'Move marker';
    readonly newTime: number;

    constructor(
        private data_: TimelineAssetData,
        private trackIndex_: number,
        private markerIndex_: number,
        private oldTime_: number,
        newTime: number,
        private onChanged_: () => void,
    ) {
        super();
        this.newTime = newTime;
    }

    execute(): void {
        const markers = getMarkers(this.data_, this.trackIndex_);
        if (!markers) return;
        const m = markers[this.markerIndex_];
        if (m) {
            m.time = this.newTime;
            markers.sort((a, b) => a.time - b.time);
        }
        this.onChanged_();
    }

    undo(): void {
        const markers = getMarkers(this.data_, this.trackIndex_);
        if (!markers) return;
        const m = markers.find(mk => mk.time === this.newTime);
        if (m) {
            m.time = this.oldTime_;
            markers.sort((a, b) => a.time - b.time);
        }
        this.onChanged_();
    }

    override canMerge(other: Command): boolean {
        if (!(other instanceof MoveMarkerCommand)) return false;
        if (other.trackIndex_ !== this.trackIndex_) return false;
        if (other.markerIndex_ !== this.markerIndex_) return false;
        return other.timestamp - this.timestamp < MERGE_THRESHOLD_MS;
    }

    override merge(other: Command): Command {
        if (!(other instanceof MoveMarkerCommand)) return this;
        return new MoveMarkerCommand(
            this.data_, this.trackIndex_, this.markerIndex_,
            this.oldTime_, other.newTime, this.onChanged_,
        );
    }
}

export class DeleteMarkerCommand extends BaseCommand {
    readonly type = 'timeline_delete_marker';
    readonly description = 'Delete marker';
    private deleted_: MarkerData | null = null;

    constructor(
        private data_: TimelineAssetData,
        private trackIndex_: number,
        private markerIndex_: number,
        private onChanged_: () => void,
    ) {
        super();
    }

    execute(): void {
        const markers = getMarkers(this.data_, this.trackIndex_);
        if (!markers) return;
        this.deleted_ = markers.splice(this.markerIndex_, 1)[0] ?? null;
        this.onChanged_();
    }

    undo(): void {
        const markers = getMarkers(this.data_, this.trackIndex_);
        if (!markers || !this.deleted_) return;
        markers.splice(this.markerIndex_, 0, this.deleted_);
        this.deleted_ = null;
        this.onChanged_();
    }
}

// =============================================================================
// Custom Event Commands
// =============================================================================

export class AddCustomEventCommand extends BaseCommand {
    readonly type = 'timeline_add_custom_event';
    readonly description = 'Add custom event';
    private insertedIndex_ = -1;

    constructor(
        private data_: TimelineAssetData,
        private trackIndex_: number,
        private event_: CustomEventData,
        private onChanged_: () => void,
    ) {
        super();
    }

    execute(): void {
        const events = getCustomEvents(this.data_, this.trackIndex_);
        if (!events) return;
        let idx = events.findIndex(e => e.time > this.event_.time);
        if (idx === -1) idx = events.length;
        events.splice(idx, 0, { ...this.event_ });
        this.insertedIndex_ = idx;
        this.onChanged_();
    }

    undo(): void {
        const events = getCustomEvents(this.data_, this.trackIndex_);
        if (!events || this.insertedIndex_ < 0) return;
        events.splice(this.insertedIndex_, 1);
        this.insertedIndex_ = -1;
        this.onChanged_();
    }
}

export class MoveCustomEventCommand extends BaseCommand {
    readonly type = 'timeline_move_custom_event';
    readonly description = 'Move custom event';
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
        const events = getCustomEvents(this.data_, this.trackIndex_);
        if (!events) return;
        const ev = events[this.eventIndex_];
        if (ev) {
            ev.time = this.newTime;
            events.sort((a, b) => a.time - b.time);
        }
        this.onChanged_();
    }

    undo(): void {
        const events = getCustomEvents(this.data_, this.trackIndex_);
        if (!events) return;
        const ev = events.find(e => e.time === this.newTime);
        if (ev) {
            ev.time = this.oldTime_;
            events.sort((a, b) => a.time - b.time);
        }
        this.onChanged_();
    }

    override canMerge(other: Command): boolean {
        if (!(other instanceof MoveCustomEventCommand)) return false;
        if (other.trackIndex_ !== this.trackIndex_) return false;
        if (other.eventIndex_ !== this.eventIndex_) return false;
        return other.timestamp - this.timestamp < MERGE_THRESHOLD_MS;
    }

    override merge(other: Command): Command {
        if (!(other instanceof MoveCustomEventCommand)) return this;
        return new MoveCustomEventCommand(
            this.data_, this.trackIndex_, this.eventIndex_,
            this.oldTime_, other.newTime, this.onChanged_,
        );
    }
}

export class DeleteCustomEventCommand extends BaseCommand {
    readonly type = 'timeline_delete_custom_event';
    readonly description = 'Delete custom event';
    private deleted_: CustomEventData | null = null;

    constructor(
        private data_: TimelineAssetData,
        private trackIndex_: number,
        private eventIndex_: number,
        private onChanged_: () => void,
    ) {
        super();
    }

    execute(): void {
        const events = getCustomEvents(this.data_, this.trackIndex_);
        if (!events) return;
        this.deleted_ = events.splice(this.eventIndex_, 1)[0] ?? null;
        this.onChanged_();
    }

    undo(): void {
        const events = getCustomEvents(this.data_, this.trackIndex_);
        if (!events || !this.deleted_) return;
        events.splice(this.eventIndex_, 0, this.deleted_);
        this.deleted_ = null;
        this.onChanged_();
    }
}

// =============================================================================
// SpriteAnim Commands
// =============================================================================

export class MoveSpriteAnimStartCommand extends BaseCommand {
    readonly type = 'timeline_move_sprite_anim_start';
    readonly description = 'Move sprite anim start';
    readonly newTime: number;

    constructor(
        private data_: TimelineAssetData,
        private trackIndex_: number,
        private oldTime_: number,
        newTime: number,
        private onChanged_: () => void,
    ) {
        super();
        this.newTime = newTime;
    }

    execute(): void {
        const track = this.data_.tracks[this.trackIndex_];
        if (!track || track.type !== 'spriteAnim') return;
        track.startTime = this.newTime;
        this.onChanged_();
    }

    undo(): void {
        const track = this.data_.tracks[this.trackIndex_];
        if (!track || track.type !== 'spriteAnim') return;
        track.startTime = this.oldTime_;
        this.onChanged_();
    }

    override canMerge(other: Command): boolean {
        if (!(other instanceof MoveSpriteAnimStartCommand)) return false;
        if (other.trackIndex_ !== this.trackIndex_) return false;
        return other.timestamp - this.timestamp < MERGE_THRESHOLD_MS;
    }

    override merge(other: Command): Command {
        if (!(other instanceof MoveSpriteAnimStartCommand)) return this;
        return new MoveSpriteAnimStartCommand(
            this.data_, this.trackIndex_,
            this.oldTime_, other.newTime, this.onChanged_,
        );
    }
}
