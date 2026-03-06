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

interface BatchKeyframeRef {
    trackIndex: number;
    channelIndex: number;
    keyframeIndex: number;
}

export class BatchMoveKeyframesCommand extends BaseCommand {
    readonly type = 'timeline_batch_move_keyframes';
    readonly description = 'Move keyframes';
    readonly timeDelta: number;

    constructor(
        private data_: TimelineAssetData,
        private refs_: BatchKeyframeRef[],
        private oldTimes_: number[],
        timeDelta: number,
        private onChanged_: () => void,
    ) {
        super();
        this.timeDelta = timeDelta;
    }

    execute(): void {
        for (let i = 0; i < this.refs_.length; i++) {
            const ref = this.refs_[i];
            const channel = getPropertyChannel(this.data_, ref.trackIndex, ref.channelIndex);
            if (!channel) continue;
            const kf = channel.keyframes[ref.keyframeIndex];
            if (kf) kf.time = Math.max(0, this.oldTimes_[i] + this.timeDelta);
        }
        this.sortAffectedChannels();
        this.onChanged_();
    }

    undo(): void {
        for (let i = 0; i < this.refs_.length; i++) {
            const ref = this.refs_[i];
            const channel = getPropertyChannel(this.data_, ref.trackIndex, ref.channelIndex);
            if (!channel) continue;
            const kf = channel.keyframes[ref.keyframeIndex];
            if (kf) kf.time = this.oldTimes_[i];
        }
        this.sortAffectedChannels();
        this.onChanged_();
    }

    private sortAffectedChannels(): void {
        const seen = new Set<string>();
        for (const ref of this.refs_) {
            const key = `${ref.trackIndex}:${ref.channelIndex}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const channel = getPropertyChannel(this.data_, ref.trackIndex, ref.channelIndex);
            if (channel) channel.keyframes.sort((a, b) => a.time - b.time);
        }
    }

    override canMerge(other: Command): boolean {
        if (!(other instanceof BatchMoveKeyframesCommand)) return false;
        if (other.refs_.length !== this.refs_.length) return false;
        for (let i = 0; i < this.refs_.length; i++) {
            const a = this.refs_[i];
            const b = other.refs_[i];
            if (a.trackIndex !== b.trackIndex || a.channelIndex !== b.channelIndex || a.keyframeIndex !== b.keyframeIndex) return false;
        }
        return other.timestamp - this.timestamp < MERGE_THRESHOLD_MS;
    }

    override merge(other: Command): Command {
        if (!(other instanceof BatchMoveKeyframesCommand)) return this;
        return new BatchMoveKeyframesCommand(
            this.data_, this.refs_, this.oldTimes_,
            other.timeDelta, this.onChanged_,
        );
    }
}

export class BatchDeleteKeyframesCommand extends BaseCommand {
    readonly type = 'timeline_batch_delete_keyframes';
    readonly description = 'Delete keyframes';
    private deleted_: { ref: BatchKeyframeRef; keyframe: KeyframeData }[] = [];

    constructor(
        private data_: TimelineAssetData,
        private refs_: BatchKeyframeRef[],
        private onChanged_: () => void,
    ) {
        super();
    }

    execute(): void {
        const sorted = [...this.refs_].sort((a, b) => {
            if (a.trackIndex !== b.trackIndex) return b.trackIndex - a.trackIndex;
            if (a.channelIndex !== b.channelIndex) return b.channelIndex - a.channelIndex;
            return b.keyframeIndex - a.keyframeIndex;
        });

        this.deleted_ = [];
        for (const ref of sorted) {
            const channel = getPropertyChannel(this.data_, ref.trackIndex, ref.channelIndex);
            if (!channel || ref.keyframeIndex >= channel.keyframes.length) continue;
            const removed = channel.keyframes.splice(ref.keyframeIndex, 1)[0];
            this.deleted_.unshift({ ref: { ...ref }, keyframe: { ...removed } });
        }
        this.onChanged_();
    }

    undo(): void {
        for (const { ref, keyframe } of this.deleted_) {
            const channel = getPropertyChannel(this.data_, ref.trackIndex, ref.channelIndex);
            if (!channel) continue;
            channel.keyframes.splice(ref.keyframeIndex, 0, keyframe);
        }
        this.deleted_ = [];
        this.onChanged_();
    }
}

export class ChangeTangentCommand extends BaseCommand {
    readonly type = 'timeline_change_tangent';
    readonly description = 'Change tangent';

    constructor(
        private data_: TimelineAssetData,
        private trackIndex_: number,
        private channelIndex_: number,
        private keyframeIndex_: number,
        private handle_: 'in' | 'out',
        private oldValue_: number,
        private newValue_: number,
        private onChanged_: () => void,
    ) {
        super();
    }

    execute(): void {
        const channel = getPropertyChannel(this.data_, this.trackIndex_, this.channelIndex_);
        if (!channel) return;
        const kf = channel.keyframes[this.keyframeIndex_];
        if (!kf) return;
        if (this.handle_ === 'in') {
            kf.inTangent = this.newValue_;
        } else {
            kf.outTangent = this.newValue_;
        }
        this.onChanged_();
    }

    undo(): void {
        const channel = getPropertyChannel(this.data_, this.trackIndex_, this.channelIndex_);
        if (!channel) return;
        const kf = channel.keyframes[this.keyframeIndex_];
        if (!kf) return;
        if (this.handle_ === 'in') {
            kf.inTangent = this.oldValue_;
        } else {
            kf.outTangent = this.oldValue_;
        }
        this.onChanged_();
    }

    override canMerge(other: Command): boolean {
        if (!(other instanceof ChangeTangentCommand)) return false;
        if (other.trackIndex_ !== this.trackIndex_) return false;
        if (other.channelIndex_ !== this.channelIndex_) return false;
        if (other.keyframeIndex_ !== this.keyframeIndex_) return false;
        if (other.handle_ !== this.handle_) return false;
        return other.timestamp - this.timestamp < MERGE_THRESHOLD_MS;
    }

    override merge(other: Command): Command {
        if (!(other instanceof ChangeTangentCommand)) return this;
        return new ChangeTangentCommand(
            this.data_, this.trackIndex_, this.channelIndex_,
            this.keyframeIndex_, this.handle_,
            this.oldValue_, other.newValue_, this.onChanged_,
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

export class ReorderTrackCommand extends BaseCommand {
    readonly type = 'timeline_reorder_track';
    readonly description = 'Reorder track';

    constructor(
        private data_: TimelineAssetData,
        private fromIndex_: number,
        private toIndex_: number,
        private onChanged_: () => void,
    ) {
        super();
    }

    execute(): void {
        const [track] = this.data_.tracks.splice(this.fromIndex_, 1);
        if (track) {
            this.data_.tracks.splice(this.toIndex_, 0, track);
        }
        this.onChanged_();
    }

    undo(): void {
        const [track] = this.data_.tracks.splice(this.toIndex_, 1);
        if (track) {
            this.data_.tracks.splice(this.fromIndex_, 0, track);
        }
        this.onChanged_();
    }
}

export class RenameTrackCommand extends BaseCommand {
    readonly type = 'timeline_rename_track';
    readonly description = 'Rename track';

    constructor(
        private data_: TimelineAssetData,
        private trackIndex_: number,
        private oldName_: string,
        private newName_: string,
        private onChanged_: () => void,
    ) {
        super();
    }

    execute(): void {
        const track = this.data_.tracks[this.trackIndex_];
        if (track) track.name = this.newName_;
        this.onChanged_();
    }

    undo(): void {
        const track = this.data_.tracks[this.trackIndex_];
        if (track) track.name = this.oldName_;
        this.onChanged_();
    }
}

export class PasteKeyframesCommand extends BaseCommand {
    readonly type = 'timeline_paste_keyframes';
    readonly description = 'Paste keyframes';
    private insertedIndices_: { trackIndex: number; channelIndex: number; index: number }[] = [];

    constructor(
        private data_: TimelineAssetData,
        private entries_: { trackIndex: number; channelIndex: number; keyframe: KeyframeData }[],
        private onChanged_: () => void,
    ) {
        super();
    }

    execute(): void {
        this.insertedIndices_ = [];
        for (const entry of this.entries_) {
            const channel = getPropertyChannel(this.data_, entry.trackIndex, entry.channelIndex);
            if (!channel) continue;
            let idx = channel.keyframes.findIndex(k => k.time > entry.keyframe.time);
            if (idx === -1) idx = channel.keyframes.length;
            channel.keyframes.splice(idx, 0, { ...entry.keyframe });
            this.insertedIndices_.push({ trackIndex: entry.trackIndex, channelIndex: entry.channelIndex, index: idx });
        }
        this.onChanged_();
    }

    undo(): void {
        for (let i = this.insertedIndices_.length - 1; i >= 0; i--) {
            const { trackIndex, channelIndex, index } = this.insertedIndices_[i];
            const channel = getPropertyChannel(this.data_, trackIndex, channelIndex);
            if (channel) channel.keyframes.splice(index, 1);
        }
        this.insertedIndices_ = [];
        this.onChanged_();
    }
}
