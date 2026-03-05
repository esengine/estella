import { BaseCommand } from '../../commands/Command';
import type { Command } from '../../commands/Command';
import type { TimelineAssetData, TimelineTrackData } from './TimelineKeyframeArea';

const MERGE_THRESHOLD_MS = 300;

interface KeyframeData {
    time: number;
    value: number;
    inTangent?: number;
    outTangent?: number;
}

interface ChannelData {
    property: string;
    keyframes: KeyframeData[];
}

function getPropertyChannel(data: TimelineAssetData, trackIndex: number, channelIndex: number): ChannelData | null {
    const track = data.tracks[trackIndex];
    if (!track || track.type !== 'property') return null;
    return track.channels?.[channelIndex] ?? null;
}

export class AddKeyframeCommand extends BaseCommand {
    readonly type = 'timeline_add_keyframe';
    readonly description = 'Add keyframe';
    private insertedIndex_ = -1;

    constructor(
        private data_: TimelineAssetData,
        private trackIndex_: number,
        private channelIndex_: number,
        private keyframe_: KeyframeData,
        private onChanged_: () => void,
    ) {
        super();
    }

    execute(): void {
        const channel = getPropertyChannel(this.data_, this.trackIndex_, this.channelIndex_);
        if (!channel) return;

        const kfs = channel.keyframes;
        let idx = kfs.findIndex(k => k.time > this.keyframe_.time);
        if (idx === -1) idx = kfs.length;

        kfs.splice(idx, 0, {
            time: this.keyframe_.time,
            value: this.keyframe_.value,
            inTangent: this.keyframe_.inTangent ?? 0,
            outTangent: this.keyframe_.outTangent ?? 0,
        });
        this.insertedIndex_ = idx;
        this.onChanged_();
    }

    undo(): void {
        const channel = getPropertyChannel(this.data_, this.trackIndex_, this.channelIndex_);
        if (!channel || this.insertedIndex_ < 0) return;

        channel.keyframes.splice(this.insertedIndex_, 1);
        this.insertedIndex_ = -1;
        this.onChanged_();
    }
}

export class DeleteKeyframeCommand extends BaseCommand {
    readonly type = 'timeline_delete_keyframe';
    readonly description = 'Delete keyframe';
    private deleted_: { index: number; keyframe: KeyframeData }[] = [];

    constructor(
        private data_: TimelineAssetData,
        private trackIndex_: number,
        private channelIndex_: number,
        private keyframeIndices_: number[],
        private onChanged_: () => void,
    ) {
        super();
    }

    execute(): void {
        const channel = getPropertyChannel(this.data_, this.trackIndex_, this.channelIndex_);
        if (!channel) return;

        const sorted = [...this.keyframeIndices_].sort((a, b) => b - a);
        this.deleted_ = [];

        for (const idx of sorted) {
            if (idx >= 0 && idx < channel.keyframes.length) {
                const removed = channel.keyframes.splice(idx, 1)[0];
                this.deleted_.unshift({ index: idx, keyframe: { ...removed } });
            }
        }

        this.onChanged_();
    }

    undo(): void {
        const channel = getPropertyChannel(this.data_, this.trackIndex_, this.channelIndex_);
        if (!channel) return;

        for (const { index, keyframe } of this.deleted_) {
            channel.keyframes.splice(index, 0, keyframe);
        }

        this.deleted_ = [];
        this.onChanged_();
    }
}

export class MoveKeyframeCommand extends BaseCommand {
    readonly type = 'timeline_move_keyframe';
    readonly description = 'Move keyframe';
    readonly newTime: number;

    constructor(
        private data_: TimelineAssetData,
        private trackIndex_: number,
        private channelIndex_: number,
        private keyframeIndex_: number,
        private oldTime_: number,
        newTime: number,
        private onChanged_: () => void,
    ) {
        super();
        this.newTime = newTime;
    }

    execute(): void {
        const channel = getPropertyChannel(this.data_, this.trackIndex_, this.channelIndex_);
        if (!channel) return;

        const kf = channel.keyframes[this.keyframeIndex_];
        if (kf) {
            kf.time = this.newTime;
            channel.keyframes.sort((a, b) => a.time - b.time);
        }

        this.onChanged_();
    }

    undo(): void {
        const channel = getPropertyChannel(this.data_, this.trackIndex_, this.channelIndex_);
        if (!channel) return;

        const kf = channel.keyframes.find(k => k.time === this.newTime);
        if (kf) {
            kf.time = this.oldTime_;
            channel.keyframes.sort((a, b) => a.time - b.time);
        }

        this.onChanged_();
    }

    override canMerge(other: Command): boolean {
        if (!(other instanceof MoveKeyframeCommand)) return false;
        if (other.trackIndex_ !== this.trackIndex_) return false;
        if (other.channelIndex_ !== this.channelIndex_) return false;
        if (other.keyframeIndex_ !== this.keyframeIndex_) return false;
        return other.timestamp - this.timestamp < MERGE_THRESHOLD_MS;
    }

    override merge(other: Command): Command {
        if (!(other instanceof MoveKeyframeCommand)) return this;
        return new MoveKeyframeCommand(
            this.data_,
            this.trackIndex_,
            this.channelIndex_,
            this.keyframeIndex_,
            this.oldTime_,
            other.newTime,
            this.onChanged_,
        );
    }
}

export class AddTrackCommand extends BaseCommand {
    readonly type = 'timeline_add_track';
    readonly description = 'Add track';

    constructor(
        private data_: TimelineAssetData,
        private track_: TimelineTrackData,
        private onChanged_: () => void,
    ) {
        super();
    }

    execute(): void {
        this.data_.tracks.push({ ...this.track_ });
        this.onChanged_();
    }

    undo(): void {
        this.data_.tracks.pop();
        this.onChanged_();
    }
}

export class DeleteTrackCommand extends BaseCommand {
    readonly type = 'timeline_delete_track';
    readonly description = 'Delete track';
    private deletedTrack_: TimelineTrackData | null = null;

    constructor(
        private data_: TimelineAssetData,
        private trackIndex_: number,
        private onChanged_: () => void,
    ) {
        super();
    }

    execute(): void {
        this.deletedTrack_ = this.data_.tracks.splice(this.trackIndex_, 1)[0];
        this.onChanged_();
    }

    undo(): void {
        if (this.deletedTrack_) {
            this.data_.tracks.splice(this.trackIndex_, 0, this.deletedTrack_);
            this.deletedTrack_ = null;
        }
        this.onChanged_();
    }
}
