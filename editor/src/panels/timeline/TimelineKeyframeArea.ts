import type { TimelineState } from './TimelineState';
import {
    RULER_HEIGHT,
    TRACK_HEIGHT,
    MIN_PIXELS_PER_SECOND,
    MAX_PIXELS_PER_SECOND,
} from './TimelineState';
import {
    AddKeyframeCommand,
    DeleteTrackCommand,
    BatchMoveKeyframesCommand,
    BatchDeleteKeyframesCommand,
    PasteKeyframesCommand,
} from './TimelineCommands';
import { showInputDialog } from '../../ui/InputDialog';
import { showObjectDialog } from '../../ui/dialog';
import {
    AddSpineClipCommand,
    MoveSpineClipCommand,
    ResizeSpineClipCommand,
    DeleteSpineClipCommand,
    AddAudioEventCommand,
    MoveAudioEventCommand,
    DeleteAudioEventCommand,
    ChangeAudioClipCommand,
    AddActivationRangeCommand,
    MoveActivationRangeCommand,
    ResizeActivationRangeCommand,
    DeleteActivationRangeCommand,
    AddMarkerCommand,
    MoveMarkerCommand,
    DeleteMarkerCommand,
    AddCustomEventCommand,
    MoveCustomEventCommand,
    DeleteCustomEventCommand,
    RenameCustomEventCommand,
    EditCustomEventPayloadCommand,
    MoveSpriteAnimStartCommand,
    RenameMarkerCommand,
    ChangeSpriteAnimClipCommand,
    DeleteAnimFrameCommand,
    ReorderAnimFrameCommand,
    ResizeAnimFrameCommand,
} from './TimelineTrackCommands';
import {
    kfKey,
    type KeyframeHit,
    type SpineClipHit,
    type AudioEventHit,
    type ActivationRangeHit,
    type MarkerHit,
    type CustomEventHit,
    type SpriteAnimHit,
    type AnimFrameHit,
    type TimelineAssetData,
    type TimelineCustomEvent,
    type AnimFrameData,
    type KeyframeSelectionCallback,
    type NonPropertyHit,
} from './TimelineTypes';
import {
    drawRuler,
    drawTracks,
    drawPlayhead,
    drawDurationEnd,
    drawRubberBand,
    type TimelineRenderContext,
} from './TimelineRenderer';
import {
    hitTestKeyframe,
    hitTestNonPropertyTrack,
    collectKeyframesInRect,
    getTrackAtY,
} from './TimelineHitTest';

export type {
    TimelineAssetData,
    TimelineKeyframe,
    TimelineChannel,
    TimelineSpineClip,
    TimelineAudioEvent,
    TimelineCustomEvent,
    TimelineActivationRange,
    TimelineMarker,
    AnimFrameData,
    TimelineTrackData,
    TimelinePanelHost,
    SelectedKeyframeInfo,
    SelectionSummary,
    KeyframeSelectionCallback,
} from './TimelineTypes';

const FRAME_STEP = 1 / 60;

export class TimelineKeyframeArea {
    private canvas_: HTMLCanvasElement;
    private ctx_: CanvasRenderingContext2D;
    private state_: TimelineState;
    private host_: import('./TimelineTypes').TimelinePanelHost | null;
    private assetData_: TimelineAssetData | null = null;
    private unsub_: (() => void) | null = null;
    private resizeObserver_: ResizeObserver | null = null;
    private selectedKeyframes_: Map<string, KeyframeHit> = new Map();
    private selectedNpItem_: { type: string; trackIndex: number; itemIndex: number } | null = null;
    private onSelectionChange_: KeyframeSelectionCallback | null = null;
    private rubberBand_: { startX: number; startY: number; endX: number; endY: number } | null = null;
    private clipboard_: { channelIndex: number; relativeTime: number; value: number; inTangent: number; outTangent: number }[] = [];
    private frameImageCache_: Map<string, HTMLImageElement> | null = null;

    constructor(container: HTMLElement, state: TimelineState, host?: import('./TimelineTypes').TimelinePanelHost) {
        this.state_ = state;
        this.host_ = host ?? null;

        this.canvas_ = document.createElement('canvas');
        this.canvas_.className = 'es-timeline-canvas';
        this.canvas_.tabIndex = 0;
        container.appendChild(this.canvas_);
        this.ctx_ = this.canvas_.getContext('2d')!;

        this.resizeObserver_ = new ResizeObserver(() => this.resizeCanvas());
        this.resizeObserver_.observe(container);

        this.unsub_ = state.onChange(() => this.draw());

        this.canvas_.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.canvas_.addEventListener('dblclick', (e) => this.onDoubleClick(e));
        this.canvas_.addEventListener('contextmenu', (e) => this.onContextMenu(e));
        this.canvas_.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
        this.canvas_.addEventListener('keydown', (e) => this.onKeyDown(e));
        this.canvas_.addEventListener('mousemove', (e) => this.onMouseMove(e));

        this.resizeCanvas();
    }

    dispose(): void {
        this.unsub_?.();
        this.resizeObserver_?.disconnect();
    }

    setAssetData(data: TimelineAssetData | null): void {
        this.assetData_ = data;
        this.clearSelection();
        this.draw();
    }

    set onKeyframeSelectionChange(cb: KeyframeSelectionCallback | null) {
        this.onSelectionChange_ = cb;
    }

    private clearSelection(): void {
        this.selectedKeyframes_.clear();
        this.selectedNpItem_ = null;
        this.notifySelectionChange();
    }

    private selectNpItem(npHit: NonPropertyHit): void {
        this.selectedKeyframes_.clear();
        const hit = npHit.hit;
        let itemIndex = -1;
        if ('clipIndex' in hit) itemIndex = hit.clipIndex;
        else if ('eventIndex' in hit) itemIndex = hit.eventIndex;
        else if ('rangeIndex' in hit) itemIndex = hit.rangeIndex;
        else if ('markerIndex' in hit) itemIndex = hit.markerIndex;
        else if ('frameIndex' in hit) itemIndex = hit.frameIndex;
        const trackIndex = hit.trackIndex;
        this.selectedNpItem_ = { type: npHit.type, trackIndex, itemIndex };
        this.draw();
    }

    private selectOnly(hit: KeyframeHit): void {
        this.selectedKeyframes_.clear();
        this.selectedKeyframes_.set(kfKey(hit.trackIndex, hit.channelIndex, hit.keyframeIndex), hit);
        this.notifySelectionChange();
    }

    private toggleSelect(hit: KeyframeHit): void {
        const key = kfKey(hit.trackIndex, hit.channelIndex, hit.keyframeIndex);
        if (this.selectedKeyframes_.has(key)) {
            this.selectedKeyframes_.delete(key);
        } else {
            this.selectedKeyframes_.set(key, hit);
        }
        this.notifySelectionChange();
    }

    private addToSelection(hit: KeyframeHit): void {
        this.selectedKeyframes_.set(kfKey(hit.trackIndex, hit.channelIndex, hit.keyframeIndex), hit);
    }

    private isKeyframeSelected(trackIndex: number, channelIndex: number, keyframeIndex: number): boolean {
        return this.selectedKeyframes_.has(kfKey(trackIndex, channelIndex, keyframeIndex));
    }

    private notifySelectionChange(): void {
        if (!this.onSelectionChange_) return;
        const count = this.selectedKeyframes_.size;
        if (count === 0) {
            this.onSelectionChange_({ count: 0, single: null });
            return;
        }
        if (count === 1) {
            const hit = this.selectedKeyframes_.values().next().value!;
            const track = this.assetData_?.tracks[hit.trackIndex];
            const kf = track?.channels?.[hit.channelIndex]?.keyframes[hit.keyframeIndex];
            if (kf) {
                this.onSelectionChange_({
                    count: 1,
                    single: {
                        trackIndex: hit.trackIndex,
                        channelIndex: hit.channelIndex,
                        keyframeIndex: hit.keyframeIndex,
                        time: kf.time,
                        value: kf.value,
                    },
                });
                return;
            }
        }
        this.onSelectionChange_({ count, single: null });
    }

    private shiftSelect(hit: KeyframeHit): void {
        if (this.selectedKeyframes_.size === 0) {
            this.selectOnly(hit);
            return;
        }

        const last = [...this.selectedKeyframes_.values()].pop()!;
        if (last.trackIndex !== hit.trackIndex || last.channelIndex !== hit.channelIndex) {
            this.selectOnly(hit);
            return;
        }

        const minIdx = Math.min(last.keyframeIndex, hit.keyframeIndex);
        const maxIdx = Math.max(last.keyframeIndex, hit.keyframeIndex);
        const track = this.assetData_?.tracks[hit.trackIndex];
        const channel = track?.channels?.[hit.channelIndex];
        if (!channel) return;

        for (let i = minIdx; i <= maxIdx; i++) {
            const kf = channel.keyframes[i];
            if (kf) {
                this.addToSelection({ trackIndex: hit.trackIndex, channelIndex: hit.channelIndex, keyframeIndex: i, time: kf.time });
            }
        }
        this.notifySelectionChange();
    }

    updateKeyframeValue(trackIndex: number, channelIndex: number, keyframeIndex: number, value: number): void {
        if (!this.assetData_) return;
        const kf = this.assetData_.tracks[trackIndex]?.channels?.[channelIndex]?.keyframes[keyframeIndex];
        if (!kf) return;
        kf.value = value;
        this.host_?.onAssetDataChanged();
    }

    private resizeCanvas(): void {
        const rect = this.canvas_.parentElement!.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.canvas_.width = rect.width * dpr;
        this.canvas_.height = rect.height * dpr;
        this.canvas_.style.width = `${rect.width}px`;
        this.canvas_.style.height = `${rect.height}px`;
        this.ctx_.scale(dpr, dpr);
        this.draw();
    }

    private createRenderContext(): TimelineRenderContext {
        return {
            state: this.state_,
            assetData: this.assetData_,
            canvasWidth: this.canvas_.clientWidth,
            isKeyframeSelected: (ti, ci, ki) => this.isKeyframeSelected(ti, ci, ki),
            isNpItemSelected: (type, ti, ii) => this.isNpItemSelected(type, ti, ii),
            frameImageCache: this.frameImageCache_,
            setFrameImageCache: (cache) => { this.frameImageCache_ = cache; },
            requestRedraw: () => this.draw(),
        };
    }

    private isNpItemSelected(type: string, trackIndex: number, itemIndex: number): boolean {
        const sel = this.selectedNpItem_;
        return sel != null && sel.type === type && sel.trackIndex === trackIndex && sel.itemIndex === itemIndex;
    }

    draw(): void {
        const ctx = this.ctx_;
        const w = this.canvas_.clientWidth;
        const h = this.canvas_.clientHeight;
        const dpr = window.devicePixelRatio || 1;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        const rc = this.createRenderContext();
        drawRuler(ctx, w, rc);
        drawTracks(ctx, w, h, rc);
        drawDurationEnd(ctx, w, h, rc);
        drawPlayhead(ctx, w, h, rc);
        drawRubberBand(ctx, this.rubberBand_);
    }

    private onMouseDown(e: MouseEvent): void {
        if (e.button === 1) {
            e.preventDefault();
            this.startMiddleButtonPan(e);
            return;
        }

        const rect = this.canvas_.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (y < RULER_HEIGHT) {
            this.startPlayheadDrag(e, rect);
            return;
        }

        const hit = hitTestKeyframe(x, y, this.state_, this.assetData_);

        if (hit) {
            const key = kfKey(hit.trackIndex, hit.channelIndex, hit.keyframeIndex);

            if (e.ctrlKey || e.metaKey) {
                this.toggleSelect(hit);
            } else if (e.shiftKey) {
                this.shiftSelect(hit);
            } else {
                if (!this.selectedKeyframes_.has(key)) {
                    this.selectOnly(hit);
                }
            }

            this.draw();
            this.canvas_.focus();
            this.startKeyframeDrag(e, rect);
            return;
        }

        const npHit = hitTestNonPropertyTrack(x, y, this.state_, this.assetData_);
        if (npHit) {
            this.clearSelection();
            this.selectNpItem(npHit);
            this.canvas_.focus();
            if (npHit.type === 'spine') {
                this.startSpineClipDrag(e, rect, npHit.hit as SpineClipHit);
            } else if (npHit.type === 'audio') {
                this.startAudioEventDrag(e, rect, npHit.hit as AudioEventHit);
            } else if (npHit.type === 'activation') {
                this.startActivationRangeDrag(e, rect, npHit.hit as ActivationRangeHit);
            } else if (npHit.type === 'marker') {
                this.startMarkerDrag(e, rect, npHit.hit as MarkerHit);
            } else if (npHit.type === 'customEvent') {
                this.startCustomEventDrag(e, rect, npHit.hit as CustomEventHit);
            } else if (npHit.type === 'spriteAnim') {
                this.startSpriteAnimDrag(e, rect, npHit.hit as SpriteAnimHit);
            } else if (npHit.type === 'animFrames') {
                this.startAnimFrameDrag(e, rect, npHit.hit as AnimFrameHit);
            }
            return;
        }

        if (!e.ctrlKey && !e.metaKey) {
            this.clearSelection();
        }
        this.draw();

        const trackInfo = getTrackAtY(y, this.state_);
        if (trackInfo) {
            this.state_.selectedTrackIndex = trackInfo.trackIndex;
            this.state_.notify();
        }

        this.startRubberBand(e, rect);
    }

    private startSpineClipDrag(_e: MouseEvent, rect: DOMRect, hit: SpineClipHit): void {
        if (!this.assetData_ || !this.host_) return;
        const track = this.assetData_.tracks[hit.trackIndex];
        if (!track?.clips) return;
        const clip = track.clips[hit.clipIndex];
        if (!clip) return;

        if (hit.zone === 'resize') {
            const oldDuration = clip.duration;
            const onMove = (ev: MouseEvent) => {
                const mx = ev.clientX - rect.left;
                const endTime = Math.max(clip.start + 0.05, this.state_.snapTime(this.state_.xToTime(mx)));
                const newDuration = endTime - clip.start;
                const cmd = new ResizeSpineClipCommand(
                    this.assetData_!, hit.trackIndex, hit.clipIndex,
                    oldDuration, newDuration,
                    () => this.host_!.onAssetDataChanged(),
                );
                this.host_!.executeCommand(cmd);
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        } else {
            const oldStart = clip.start;
            const offsetX = _e.clientX - rect.left - this.state_.timeToX(clip.start);
            const onMove = (ev: MouseEvent) => {
                const mx = ev.clientX - rect.left - offsetX;
                const newStart = this.state_.snapTime(Math.max(0, this.state_.xToTime(mx)));
                const cmd = new MoveSpineClipCommand(
                    this.assetData_!, hit.trackIndex, hit.clipIndex,
                    oldStart, newStart,
                    () => this.host_!.onAssetDataChanged(),
                );
                this.host_!.executeCommand(cmd);
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        }
    }

    private startAudioEventDrag(_e: MouseEvent, rect: DOMRect, hit: AudioEventHit): void {
        if (!this.assetData_ || !this.host_) return;
        const track = this.assetData_.tracks[hit.trackIndex];
        if (!track?.events) return;
        const event = track.events[hit.eventIndex];
        if (!event) return;

        const oldTime = event.time;
        const onMove = (ev: MouseEvent) => {
            const mx = ev.clientX - rect.left;
            const newTime = this.state_.snapTime(Math.max(0, this.state_.xToTime(mx)));
            const cmd = new MoveAudioEventCommand(
                this.assetData_!, hit.trackIndex, hit.eventIndex,
                oldTime, newTime,
                () => this.host_!.onAssetDataChanged(),
            );
            this.host_!.executeCommand(cmd);
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    private startActivationRangeDrag(_e: MouseEvent, rect: DOMRect, hit: ActivationRangeHit): void {
        if (!this.assetData_ || !this.host_) return;
        const track = this.assetData_.tracks[hit.trackIndex];
        if (!track?.ranges) return;
        const range = track.ranges[hit.rangeIndex];
        if (!range) return;

        const oldStart = range.start;
        const oldEnd = range.end;

        if (hit.zone === 'left') {
            const onMove = (ev: MouseEvent) => {
                const mx = ev.clientX - rect.left;
                const newStart = Math.max(0, Math.min(this.state_.snapTime(this.state_.xToTime(mx)), oldEnd - 0.05));
                const cmd = new ResizeActivationRangeCommand(
                    this.assetData_!, hit.trackIndex, hit.rangeIndex,
                    oldStart, oldEnd, newStart, oldEnd,
                    () => this.host_!.onAssetDataChanged(),
                );
                this.host_!.executeCommand(cmd);
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        } else if (hit.zone === 'right') {
            const onMove = (ev: MouseEvent) => {
                const mx = ev.clientX - rect.left;
                const newEnd = Math.max(oldStart + 0.05, this.state_.snapTime(this.state_.xToTime(mx)));
                const cmd = new ResizeActivationRangeCommand(
                    this.assetData_!, hit.trackIndex, hit.rangeIndex,
                    oldStart, oldEnd, oldStart, newEnd,
                    () => this.host_!.onAssetDataChanged(),
                );
                this.host_!.executeCommand(cmd);
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        } else {
            const duration = oldEnd - oldStart;
            const offsetX = _e.clientX - rect.left - this.state_.timeToX(oldStart);
            const onMove = (ev: MouseEvent) => {
                const mx = ev.clientX - rect.left - offsetX;
                const newStart = this.state_.snapTime(Math.max(0, this.state_.xToTime(mx)));
                const newEnd = newStart + duration;
                const cmd = new MoveActivationRangeCommand(
                    this.assetData_!, hit.trackIndex, hit.rangeIndex,
                    oldStart, oldEnd, newStart, newEnd,
                    () => this.host_!.onAssetDataChanged(),
                );
                this.host_!.executeCommand(cmd);
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        }
    }

    private startSpriteAnimDrag(_e: MouseEvent, rect: DOMRect, hit: SpriteAnimHit): void {
        if (!this.assetData_ || !this.host_) return;
        const track = this.assetData_.tracks[hit.trackIndex];
        if (!track || track.startTime == null) return;

        const oldTime = track.startTime;
        const onMove = (ev: MouseEvent) => {
            const mx = ev.clientX - rect.left;
            const newTime = this.state_.snapTime(Math.max(0, this.state_.xToTime(mx)));
            const cmd = new MoveSpriteAnimStartCommand(
                this.assetData_!, hit.trackIndex,
                oldTime, newTime,
                () => this.host_!.onAssetDataChanged(),
            );
            this.host_!.executeCommand(cmd);
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    private startAnimFrameDrag(_e: MouseEvent, rect: DOMRect, hit: AnimFrameHit): void {
        if (!this.assetData_ || !this.host_) return;
        const track = this.assetData_.tracks[hit.trackIndex];
        if (!track?.animFrames) return;
        const frames = track.animFrames as AnimFrameData[];
        const frame = frames[hit.frameIndex];
        if (!frame) return;

        const fps = this.state_.animClipFps;
        const defaultDur = 1 / fps;

        if (hit.zone === 'resize') {
            const oldDuration = frame.duration ?? defaultDur;
            const onMove = (ev: MouseEvent) => {
                const mx = ev.clientX - rect.left;
                let startTime = 0;
                for (let i = 0; i < hit.frameIndex; i++) {
                    startTime += frames[i].duration ?? defaultDur;
                }
                const endTime = Math.max(startTime + 0.01, this.state_.xToTime(mx));
                const newDuration = endTime - startTime;
                const cmd = new ResizeAnimFrameCommand(
                    this.assetData_!, hit.trackIndex, hit.frameIndex,
                    oldDuration, newDuration,
                    () => this.host_!.onAssetDataChanged(),
                );
                this.host_!.executeCommand(cmd);
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                this.updateAnimClipDuration();
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        } else {
            const startX = _e.clientX;
            let dragged = false;
            const onMove = (ev: MouseEvent) => {
                if (Math.abs(ev.clientX - startX) > 5) dragged = true;
                if (!dragged) return;
                const mx = ev.clientX - rect.left;
                const targetTime = this.state_.xToTime(mx);
                let time = 0;
                let targetIndex = frames.length - 1;
                for (let i = 0; i < frames.length; i++) {
                    const dur = frames[i].duration ?? defaultDur;
                    if (targetTime < time + dur / 2) {
                        targetIndex = i;
                        break;
                    }
                    time += dur;
                }
                if (targetIndex !== hit.frameIndex) {
                    const cmd = new ReorderAnimFrameCommand(
                        this.assetData_!, hit.trackIndex,
                        hit.frameIndex, targetIndex,
                        () => this.host_!.onAssetDataChanged(),
                    );
                    this.host_!.executeCommand(cmd);
                    hit.frameIndex = targetIndex;
                }
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        }
    }

    private updateAnimClipDuration(): void {
        if (!this.assetData_) return;
        const track = this.assetData_.tracks[0];
        if (!track?.animFrames) return;
        const fps = this.state_.animClipFps;
        const defaultDur = 1 / fps;
        let total = 0;
        for (const f of track.animFrames as AnimFrameData[]) {
            total += f.duration ?? defaultDur;
        }
        this.state_.duration = total;
        this.assetData_.duration = total;
        this.state_.notify();
    }

    private startCustomEventDrag(_e: MouseEvent, rect: DOMRect, hit: CustomEventHit): void {
        if (!this.assetData_ || !this.host_) return;
        const track = this.assetData_.tracks[hit.trackIndex];
        if (!track?.events) return;
        const event = track.events[hit.eventIndex];
        if (!event) return;

        const oldTime = event.time;
        const onMove = (ev: MouseEvent) => {
            const mx = ev.clientX - rect.left;
            const newTime = this.state_.snapTime(Math.max(0, this.state_.xToTime(mx)));
            const cmd = new MoveCustomEventCommand(
                this.assetData_!, hit.trackIndex, hit.eventIndex,
                oldTime, newTime,
                () => this.host_!.onAssetDataChanged(),
            );
            this.host_!.executeCommand(cmd);
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    private startMarkerDrag(_e: MouseEvent, rect: DOMRect, hit: MarkerHit): void {
        if (!this.assetData_ || !this.host_) return;
        const track = this.assetData_.tracks[hit.trackIndex];
        if (!track?.markers) return;
        const marker = track.markers[hit.markerIndex];
        if (!marker) return;

        const oldTime = marker.time;
        const onMove = (ev: MouseEvent) => {
            const mx = ev.clientX - rect.left;
            const newTime = this.state_.snapTime(Math.max(0, this.state_.xToTime(mx)));
            const cmd = new MoveMarkerCommand(
                this.assetData_!, hit.trackIndex, hit.markerIndex,
                oldTime, newTime,
                () => this.host_!.onAssetDataChanged(),
            );
            this.host_!.executeCommand(cmd);
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    private startRubberBand(e: MouseEvent, rect: DOMRect): void {
        const startX = e.clientX - rect.left;
        const startY = e.clientY - rect.top;
        const isAdditive = e.ctrlKey || e.metaKey;

        this.rubberBand_ = { startX, startY, endX: startX, endY: startY };

        const onMove = (ev: MouseEvent) => {
            this.rubberBand_!.endX = ev.clientX - rect.left;
            this.rubberBand_!.endY = ev.clientY - rect.top;
            this.draw();
        };

        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);

            if (!this.rubberBand_) return;
            const rb = this.rubberBand_;
            const w = Math.abs(rb.endX - rb.startX);
            const h = Math.abs(rb.endY - rb.startY);

            if (w > 3 || h > 3) {
                const hits = collectKeyframesInRect(rb.startX, rb.startY, rb.endX, rb.endY, this.state_, this.assetData_);
                if (!isAdditive) {
                    this.selectedKeyframes_.clear();
                }
                for (const hit of hits) {
                    this.addToSelection(hit);
                }
                this.notifySelectionChange();
            }

            this.rubberBand_ = null;
            this.draw();
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    private async onDoubleClick(e: MouseEvent): Promise<void> {
        if (!this.assetData_ || !this.host_) return;

        const rect = this.canvas_.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (y < RULER_HEIGHT) return;

        const hit = hitTestKeyframe(x, y, this.state_, this.assetData_);
        if (hit) return;

        const npHit = hitTestNonPropertyTrack(x, y, this.state_, this.assetData_);
        if (npHit) return;

        const trackInfo = getTrackAtY(y, this.state_);
        if (!trackInfo) return;

        const assetTrack = this.assetData_.tracks[trackInfo.trackIndex];
        if (!assetTrack) return;

        const time = this.state_.snapTime(Math.max(0, this.state_.xToTime(x)));

        switch (assetTrack.type) {
            case 'property': {
                const channelIndex = trackInfo.isChannel ? trackInfo.channelIndex : 0;
                if (!assetTrack.channels || channelIndex < 0 || channelIndex >= assetTrack.channels.length) return;
                const value = this.host_.readPropertyValue(trackInfo.trackIndex, channelIndex);
                const cmd = new AddKeyframeCommand(
                    this.assetData_, trackInfo.trackIndex, channelIndex,
                    { time, value },
                    () => this.host_!.onAssetDataChanged(),
                );
                this.host_.executeCommand(cmd);
                break;
            }
            case 'spine': {
                const animName = await showInputDialog({
                    title: 'Spine Animation',
                    defaultValue: 'idle',
                    placeholder: 'Animation name',
                });
                if (animName == null) return;
                const cmd = new AddSpineClipCommand(
                    this.assetData_, trackInfo.trackIndex,
                    { start: time, duration: 1, animation: animName },
                    () => this.host_!.onAssetDataChanged(),
                );
                this.host_.executeCommand(cmd);
                break;
            }
            case 'audio': {
                const clipPath = await showInputDialog({
                    title: 'Audio Clip',
                    defaultValue: '',
                    placeholder: 'Audio asset path or UUID',
                });
                if (clipPath == null) return;
                const cmd = new AddAudioEventCommand(
                    this.assetData_, trackInfo.trackIndex,
                    { time, clip: clipPath },
                    () => this.host_!.onAssetDataChanged(),
                );
                this.host_.executeCommand(cmd);
                break;
            }
            case 'activation': {
                const cmd = new AddActivationRangeCommand(
                    this.assetData_, trackInfo.trackIndex,
                    { start: time, end: Math.min(time + 1, this.state_.duration) },
                    () => this.host_!.onAssetDataChanged(),
                );
                this.host_.executeCommand(cmd);
                break;
            }
            case 'marker': {
                const cmd = new AddMarkerCommand(
                    this.assetData_, trackInfo.trackIndex,
                    { time, name: 'marker' },
                    () => this.host_!.onAssetDataChanged(),
                );
                this.host_.executeCommand(cmd);
                break;
            }
            case 'customEvent': {
                const cmd = new AddCustomEventCommand(
                    this.assetData_, trackInfo.trackIndex,
                    { time, name: 'event', payload: {} },
                    () => this.host_!.onAssetDataChanged(),
                );
                this.host_.executeCommand(cmd);
                break;
            }
        }
    }

    private startKeyframeDrag(e: MouseEvent, rect: DOMRect): void {
        if (!this.assetData_ || !this.host_) return;
        if (this.selectedKeyframes_.size === 0) return;

        const startX = e.clientX - rect.left;
        const startTime = this.state_.xToTime(startX);

        const refs = [...this.selectedKeyframes_.values()].map(hit => ({
            trackIndex: hit.trackIndex,
            channelIndex: hit.channelIndex,
            keyframeIndex: hit.keyframeIndex,
        }));
        const oldTimes = refs.map(ref => {
            const channel = this.assetData_!.tracks[ref.trackIndex]?.channels?.[ref.channelIndex];
            return channel?.keyframes[ref.keyframeIndex]?.time ?? 0;
        });

        let lastDelta = 0;

        const onMove = (ev: MouseEvent) => {
            const currentX = ev.clientX - rect.left;
            const currentTime = this.state_.xToTime(currentX);
            const rawDelta = currentTime - startTime;
            const snappedFirst = this.state_.snapTime(oldTimes[0] + rawDelta);
            const timeDelta = snappedFirst - oldTimes[0];

            if (timeDelta === lastDelta) return;
            lastDelta = timeDelta;

            const cmd = new BatchMoveKeyframesCommand(
                this.assetData_!, refs, oldTimes, timeDelta,
                () => this.host_!.onAssetDataChanged(),
            );
            this.host_!.executeCommand(cmd);
        };

        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    private onKeyDown(e: KeyboardEvent): void {
        if (e.key === ',' || e.key === '<') {
            e.preventDefault();
            this.state_.setPlayhead(this.state_.playheadTime - FRAME_STEP);
            return;
        }
        if (e.key === '.' || e.key === '>') {
            e.preventDefault();
            this.state_.setPlayhead(this.state_.playheadTime + FRAME_STEP);
            return;
        }

        if (!this.assetData_ || !this.host_) return;

        if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedKeyframes_.size > 0) {
            e.preventDefault();
            e.stopPropagation();
            const refs = [...this.selectedKeyframes_.values()].map(hit => ({
                trackIndex: hit.trackIndex,
                channelIndex: hit.channelIndex,
                keyframeIndex: hit.keyframeIndex,
            }));
            const cmd = new BatchDeleteKeyframesCommand(
                this.assetData_, refs,
                () => this.host_!.onAssetDataChanged(),
            );
            this.host_.executeCommand(cmd);
            this.clearSelection();
            return;
        }

        if (e.key === 'k' || e.key === 'K') {
            e.preventDefault();
            this.addKeyframeAtPlayhead();
            return;
        }

        if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            this.selectAllInTrack();
            return;
        }

        if (e.key === 'f' || e.key === 'F') {
            e.preventDefault();
            this.zoomToFit();
            return;
        }

        if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            this.copySelectedKeyframes();
            return;
        }

        if (e.key === 'v' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            this.pasteKeyframes();
            return;
        }
    }

    private copySelectedKeyframes(): void {
        if (!this.assetData_ || this.selectedKeyframes_.size === 0) return;

        const hits = [...this.selectedKeyframes_.values()];
        let minTime = Infinity;
        for (const hit of hits) {
            if (hit.time < minTime) minTime = hit.time;
        }

        this.clipboard_ = hits.map(hit => {
            const channel = this.assetData_!.tracks[hit.trackIndex]?.channels?.[hit.channelIndex];
            const kf = channel?.keyframes[hit.keyframeIndex];
            return {
                channelIndex: hit.channelIndex,
                relativeTime: hit.time - minTime,
                value: kf?.value ?? 0,
                inTangent: kf?.inTangent ?? 0,
                outTangent: kf?.outTangent ?? 0,
            };
        });
    }

    private pasteKeyframes(): void {
        if (!this.assetData_ || !this.host_ || this.clipboard_.length === 0) return;

        const trackIndex = this.state_.selectedTrackIndex;
        if (trackIndex < 0) return;
        const assetTrack = this.assetData_.tracks[trackIndex];
        if (!assetTrack || assetTrack.type !== 'property' || !assetTrack.channels) return;

        const baseTime = this.state_.playheadTime;
        const entries = this.clipboard_
            .filter(entry => entry.channelIndex < assetTrack.channels!.length)
            .map(entry => ({
                trackIndex,
                channelIndex: entry.channelIndex,
                keyframe: {
                    time: baseTime + entry.relativeTime,
                    value: entry.value,
                    inTangent: entry.inTangent,
                    outTangent: entry.outTangent,
                },
            }));

        if (entries.length === 0) return;

        const cmd = new PasteKeyframesCommand(
            this.assetData_, entries,
            () => this.host_!.onAssetDataChanged(),
        );
        this.host_.executeCommand(cmd);
    }

    private zoomToFit(): void {
        const width = this.canvas_.clientWidth;
        if (width <= 0 || this.state_.duration <= 0) return;

        const margin = 40;
        this.state_.pixelsPerSecond = Math.max(
            MIN_PIXELS_PER_SECOND,
            Math.min(MAX_PIXELS_PER_SECOND, (width - margin * 2) / this.state_.duration),
        );
        this.state_.scrollX = 0;
        this.state_.notify();
    }

    private selectAllInTrack(): void {
        if (!this.assetData_) return;
        const trackIndex = this.state_.selectedTrackIndex;
        if (trackIndex < 0) return;

        const assetTrack = this.assetData_.tracks[trackIndex];
        if (!assetTrack || assetTrack.type !== 'property' || !assetTrack.channels) return;

        this.selectedKeyframes_.clear();
        for (let c = 0; c < assetTrack.channels.length; c++) {
            for (let ki = 0; ki < assetTrack.channels[c].keyframes.length; ki++) {
                const kf = assetTrack.channels[c].keyframes[ki];
                this.addToSelection({ trackIndex, channelIndex: c, keyframeIndex: ki, time: kf.time });
            }
        }
        this.notifySelectionChange();
        this.draw();
    }

    private addKeyframeAtPlayhead(): void {
        if (!this.assetData_ || !this.host_) return;

        const trackIndex = this.state_.selectedTrackIndex;
        if (trackIndex < 0) return;

        const assetTrack = this.assetData_.tracks[trackIndex];
        if (!assetTrack || assetTrack.type !== 'property' || !assetTrack.channels) return;

        const time = this.state_.playheadTime;

        for (let c = 0; c < assetTrack.channels.length; c++) {
            const exists = assetTrack.channels[c].keyframes.some(
                k => Math.abs(k.time - time) < 0.001
            );
            if (exists) continue;

            const value = this.host_.readPropertyValue(trackIndex, c);
            const cmd = new AddKeyframeCommand(
                this.assetData_,
                trackIndex,
                c,
                { time, value },
                () => this.host_!.onAssetDataChanged(),
            );
            this.host_.executeCommand(cmd);
        }
    }

    private onContextMenu(e: MouseEvent): void {
        e.preventDefault();
        if (!this.assetData_ || !this.host_) return;

        const rect = this.canvas_.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        if (y < RULER_HEIGHT) return;

        const hit = hitTestKeyframe(x, y, this.state_, this.assetData_);
        const trackInfo = getTrackAtY(y, this.state_);

        const menu = document.createElement('div');
        menu.className = 'es-timeline-dropdown';
        menu.style.position = 'fixed';
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;

        const npHit = hitTestNonPropertyTrack(x, y, this.state_, this.assetData_);

        if (hit) {
            const key = kfKey(hit.trackIndex, hit.channelIndex, hit.keyframeIndex);
            if (!this.selectedKeyframes_.has(key)) {
                this.selectOnly(hit);
            }
            this.draw();

            const count = this.selectedKeyframes_.size;
            const deleteLabel = count > 1 ? `Delete ${count} Keyframes` : 'Delete Keyframe';
            const deleteItem = document.createElement('div');
            deleteItem.className = 'es-timeline-dropdown-item';
            deleteItem.textContent = deleteLabel;
            deleteItem.addEventListener('click', () => {
                menu.remove();
                const refs = [...this.selectedKeyframes_.values()].map(h => ({
                    trackIndex: h.trackIndex,
                    channelIndex: h.channelIndex,
                    keyframeIndex: h.keyframeIndex,
                }));
                const cmd = new BatchDeleteKeyframesCommand(
                    this.assetData_!, refs,
                    () => this.host_!.onAssetDataChanged(),
                );
                this.host_!.executeCommand(cmd);
                this.clearSelection();
            });
            menu.appendChild(deleteItem);
        } else if (npHit) {
            this.selectNpItem(npHit);
            this.buildNonPropertyContextMenu(menu, npHit);
        } else if (trackInfo) {
            const assetTrack = this.assetData_.tracks[trackInfo.trackIndex];
            if (assetTrack?.type === 'property' && assetTrack.channels) {
                const time = Math.max(0, this.state_.xToTime(x));
                const channelIdx = trackInfo.isChannel ? trackInfo.channelIndex : -1;

                const addItem = document.createElement('div');
                addItem.className = 'es-timeline-dropdown-item';
                addItem.textContent = channelIdx >= 0 ? 'Add Keyframe Here' : 'Add Keyframe (all channels)';
                addItem.addEventListener('click', () => {
                    menu.remove();
                    if (channelIdx >= 0) {
                        const val = this.host_!.readPropertyValue(trackInfo.trackIndex, channelIdx);
                        const cmd = new AddKeyframeCommand(
                            this.assetData_!,
                            trackInfo.trackIndex,
                            channelIdx,
                            { time, value: val },
                            () => this.host_!.onAssetDataChanged(),
                        );
                        this.host_!.executeCommand(cmd);
                    } else {
                        for (let c = 0; c < assetTrack.channels!.length; c++) {
                            const val = this.host_!.readPropertyValue(trackInfo.trackIndex, c);
                            const cmd = new AddKeyframeCommand(
                                this.assetData_!,
                                trackInfo.trackIndex,
                                c,
                                { time, value: val },
                                () => this.host_!.onAssetDataChanged(),
                            );
                            this.host_!.executeCommand(cmd);
                        }
                    }
                });
                menu.appendChild(addItem);
            }

            const deleteTrackItem = document.createElement('div');
            deleteTrackItem.className = 'es-timeline-dropdown-item';
            deleteTrackItem.textContent = 'Delete Track';
            deleteTrackItem.addEventListener('click', () => {
                menu.remove();
                const cmd = new DeleteTrackCommand(
                    this.assetData_!,
                    trackInfo.trackIndex,
                    () => this.host_!.onAssetDataChanged(),
                );
                this.host_!.executeCommand(cmd);
            });
            menu.appendChild(deleteTrackItem);
        }

        if (menu.children.length === 0) return;

        document.body.appendChild(menu);

        const dismiss = (ev: MouseEvent) => {
            if (!menu.contains(ev.target as Node)) {
                menu.remove();
                document.removeEventListener('mousedown', dismiss, true);
            }
        };
        setTimeout(() => document.addEventListener('mousedown', dismiss, true), 0);
    }

    private buildNonPropertyContextMenu(
        menu: HTMLElement,
        npHit: NonPropertyHit,
    ): void {
        if (!this.assetData_ || !this.host_) return;

        if (npHit.type === 'spine') {
            const hit = npHit.hit as SpineClipHit;
            const item = document.createElement('div');
            item.className = 'es-timeline-dropdown-item';
            item.textContent = 'Delete Clip';
            item.addEventListener('click', () => {
                menu.remove();
                const cmd = new DeleteSpineClipCommand(
                    this.assetData_!, hit.trackIndex, hit.clipIndex,
                    () => this.host_!.onAssetDataChanged(),
                );
                this.host_!.executeCommand(cmd);
            });
            menu.appendChild(item);
        } else if (npHit.type === 'audio') {
            const hit = npHit.hit as AudioEventHit;
            const track = this.assetData_!.tracks[hit.trackIndex];
            const events = (track?.events ?? []) as { time: number; clip: string }[];
            const audioEv = events[hit.eventIndex];

            const changeClipItem = document.createElement('div');
            changeClipItem.className = 'es-timeline-dropdown-item';
            changeClipItem.textContent = 'Change Clip';
            changeClipItem.addEventListener('click', async () => {
                menu.remove();
                if (!audioEv) return;
                const newClip = await showInputDialog({
                    title: 'Audio Clip',
                    defaultValue: audioEv.clip ?? '',
                    placeholder: 'Audio asset path or UUID',
                });
                if (newClip != null && newClip !== audioEv.clip) {
                    const cmd = new ChangeAudioClipCommand(
                        this.assetData_!, hit.trackIndex, hit.eventIndex,
                        audioEv.clip ?? '', newClip,
                        () => this.host_!.onAssetDataChanged(),
                    );
                    this.host_!.executeCommand(cmd);
                }
            });
            menu.appendChild(changeClipItem);

            const sep = document.createElement('div');
            sep.className = 'es-timeline-dropdown-separator';
            menu.appendChild(sep);

            const deleteItem = document.createElement('div');
            deleteItem.className = 'es-timeline-dropdown-item';
            deleteItem.textContent = 'Delete Event';
            deleteItem.addEventListener('click', () => {
                menu.remove();
                const cmd = new DeleteAudioEventCommand(
                    this.assetData_!, hit.trackIndex, hit.eventIndex,
                    () => this.host_!.onAssetDataChanged(),
                );
                this.host_!.executeCommand(cmd);
            });
            menu.appendChild(deleteItem);
        } else if (npHit.type === 'activation') {
            const hit = npHit.hit as ActivationRangeHit;
            const item = document.createElement('div');
            item.className = 'es-timeline-dropdown-item';
            item.textContent = 'Delete Range';
            item.addEventListener('click', () => {
                menu.remove();
                const cmd = new DeleteActivationRangeCommand(
                    this.assetData_!, hit.trackIndex, hit.rangeIndex,
                    () => this.host_!.onAssetDataChanged(),
                );
                this.host_!.executeCommand(cmd);
            });
            menu.appendChild(item);
        } else if (npHit.type === 'marker') {
            const hit = npHit.hit as MarkerHit;
            const track = this.assetData_!.tracks[hit.trackIndex];
            const markers = (track?.markers ?? []) as { time: number; name: string }[];
            const marker = markers[hit.markerIndex];

            const renameItem = document.createElement('div');
            renameItem.className = 'es-timeline-dropdown-item';
            renameItem.textContent = 'Rename';
            renameItem.addEventListener('click', async () => {
                menu.remove();
                if (!marker) return;
                const newName = await showInputDialog({
                    title: 'Rename Marker',
                    defaultValue: marker.name,
                    placeholder: 'Marker name',
                });
                if (newName != null && newName !== marker.name) {
                    const cmd = new RenameMarkerCommand(
                        this.assetData_!, hit.trackIndex, hit.markerIndex,
                        marker.name, newName,
                        () => this.host_!.onAssetDataChanged(),
                    );
                    this.host_!.executeCommand(cmd);
                }
            });
            menu.appendChild(renameItem);

            const sep = document.createElement('div');
            sep.className = 'es-timeline-dropdown-separator';
            menu.appendChild(sep);

            const deleteItem = document.createElement('div');
            deleteItem.className = 'es-timeline-dropdown-item';
            deleteItem.textContent = 'Delete Marker';
            deleteItem.addEventListener('click', () => {
                menu.remove();
                const cmd = new DeleteMarkerCommand(
                    this.assetData_!, hit.trackIndex, hit.markerIndex,
                    () => this.host_!.onAssetDataChanged(),
                );
                this.host_!.executeCommand(cmd);
            });
            menu.appendChild(deleteItem);
        } else if (npHit.type === 'customEvent') {
            const hit = npHit.hit as CustomEventHit;
            const track = this.assetData_!.tracks[hit.trackIndex];
            const events = (track?.events ?? []) as TimelineCustomEvent[];
            const ev = events[hit.eventIndex];

            const renameItem = document.createElement('div');
            renameItem.className = 'es-timeline-dropdown-item';
            renameItem.textContent = 'Rename';
            renameItem.addEventListener('click', async () => {
                menu.remove();
                if (!ev) return;
                const newName = await showInputDialog({
                    title: 'Rename Event',
                    defaultValue: ev.name,
                    placeholder: 'Event name',
                });
                if (newName != null && newName !== ev.name) {
                    const cmd = new RenameCustomEventCommand(
                        this.assetData_!, hit.trackIndex, hit.eventIndex,
                        ev.name, newName,
                        () => this.host_!.onAssetDataChanged(),
                    );
                    this.host_!.executeCommand(cmd);
                }
            });
            menu.appendChild(renameItem);

            const payloadItem = document.createElement('div');
            payloadItem.className = 'es-timeline-dropdown-item';
            payloadItem.textContent = 'Edit Payload';
            payloadItem.addEventListener('click', async () => {
                menu.remove();
                if (!ev) return;
                const newPayload = await showObjectDialog({
                    title: `Edit Payload — ${ev.name}`,
                    value: ev.payload ?? {},
                });
                if (newPayload == null) return;
                const cmd = new EditCustomEventPayloadCommand(
                    this.assetData_!, hit.trackIndex, hit.eventIndex,
                    { ...ev.payload }, newPayload,
                    () => this.host_!.onAssetDataChanged(),
                );
                this.host_!.executeCommand(cmd);
            });
            menu.appendChild(payloadItem);

            const sep = document.createElement('div');
            sep.className = 'es-timeline-dropdown-separator';
            menu.appendChild(sep);

            const deleteItem = document.createElement('div');
            deleteItem.className = 'es-timeline-dropdown-item';
            deleteItem.textContent = 'Delete Event';
            deleteItem.addEventListener('click', () => {
                menu.remove();
                const cmd = new DeleteCustomEventCommand(
                    this.assetData_!, hit.trackIndex, hit.eventIndex,
                    () => this.host_!.onAssetDataChanged(),
                );
                this.host_!.executeCommand(cmd);
            });
            menu.appendChild(deleteItem);
        } else if (npHit.type === 'spriteAnim') {
            const hit = npHit.hit as SpriteAnimHit;
            const track = this.assetData_!.tracks[hit.trackIndex];
            const currentClip = track?.clip as string ?? '';

            const changeItem = document.createElement('div');
            changeItem.className = 'es-timeline-dropdown-item';
            changeItem.textContent = 'Change Clip';
            changeItem.addEventListener('click', async () => {
                menu.remove();
                const newClip = await showInputDialog({
                    title: 'Sprite Anim Clip',
                    defaultValue: currentClip,
                    placeholder: 'Asset path or UUID',
                });
                if (newClip != null && newClip !== currentClip) {
                    const cmd = new ChangeSpriteAnimClipCommand(
                        this.assetData_!, hit.trackIndex,
                        currentClip, newClip,
                        () => this.host_!.onAssetDataChanged(),
                    );
                    this.host_!.executeCommand(cmd);
                }
            });
            menu.appendChild(changeItem);

            if (currentClip) {
                const clearItem = document.createElement('div');
                clearItem.className = 'es-timeline-dropdown-item';
                clearItem.textContent = 'Clear Clip';
                clearItem.addEventListener('click', () => {
                    menu.remove();
                    const cmd = new ChangeSpriteAnimClipCommand(
                        this.assetData_!, hit.trackIndex,
                        currentClip, '',
                        () => this.host_!.onAssetDataChanged(),
                    );
                    this.host_!.executeCommand(cmd);
                });
                menu.appendChild(clearItem);
            }
        } else if (npHit.type === 'animFrames') {
            const hit = npHit.hit as AnimFrameHit;
            const track = this.assetData_!.tracks[hit.trackIndex];
            const frames = (track?.animFrames ?? []) as AnimFrameData[];
            const frame = frames[hit.frameIndex];

            const durationItem = document.createElement('div');
            durationItem.className = 'es-timeline-dropdown-item';
            durationItem.textContent = 'Set Duration';
            durationItem.addEventListener('click', async () => {
                menu.remove();
                if (!frame) return;
                const fps = this.state_.animClipFps;
                const currentMs = Math.round((frame.duration ?? (1 / fps)) * 1000);
                const result = await showInputDialog({
                    title: 'Frame Duration (ms)',
                    defaultValue: String(currentMs),
                    placeholder: 'Duration in milliseconds',
                });
                if (result == null) return;
                const ms = parseInt(result, 10);
                if (isNaN(ms) || ms <= 0) return;
                const newDur = ms / 1000;
                const oldDur = frame.duration ?? (1 / fps);
                if (newDur !== oldDur) {
                    const cmd = new ResizeAnimFrameCommand(
                        this.assetData_!, hit.trackIndex, hit.frameIndex,
                        oldDur, newDur,
                        () => this.host_!.onAssetDataChanged(),
                    );
                    this.host_!.executeCommand(cmd);
                    this.updateAnimClipDuration();
                }
            });
            menu.appendChild(durationItem);

            const sep = document.createElement('div');
            sep.className = 'es-timeline-dropdown-separator';
            menu.appendChild(sep);

            const deleteItem = document.createElement('div');
            deleteItem.className = 'es-timeline-dropdown-item';
            deleteItem.textContent = 'Delete Frame';
            deleteItem.addEventListener('click', () => {
                menu.remove();
                const cmd = new DeleteAnimFrameCommand(
                    this.assetData_!, hit.trackIndex, hit.frameIndex,
                    () => this.host_!.onAssetDataChanged(),
                );
                this.host_!.executeCommand(cmd);
                this.updateAnimClipDuration();
            });
            menu.appendChild(deleteItem);
        }
    }

    private startPlayheadDrag(e: MouseEvent, rect: DOMRect): void {
        const setPlayhead = (clientX: number) => {
            const x = clientX - rect.left;
            const time = this.state_.xToTime(x);
            this.state_.setPlayhead(time);
        };

        setPlayhead(e.clientX);

        const onMove = (ev: MouseEvent) => setPlayhead(ev.clientX);
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    private startMiddleButtonPan(e: MouseEvent): void {
        let lastX = e.clientX;
        const onMove = (ev: MouseEvent) => {
            const dx = ev.clientX - lastX;
            lastX = ev.clientX;
            this.state_.scrollX = Math.max(0, this.state_.scrollX - dx);
            this.state_.notify();
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    private onMouseMove(e: MouseEvent): void {
        const rect = this.canvas_.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (y < RULER_HEIGHT) {
            this.canvas_.style.cursor = 'col-resize';
            return;
        }

        const npHit = hitTestNonPropertyTrack(x, y, this.state_, this.assetData_);
        if (npHit) {
            if (npHit.type === 'animFrames' && (npHit.hit as AnimFrameHit).zone === 'resize') {
                this.canvas_.style.cursor = 'ew-resize';
                return;
            }
            if (npHit.type === 'spine' && (npHit.hit as SpineClipHit).zone === 'resize') {
                this.canvas_.style.cursor = 'ew-resize';
                return;
            }
            if (npHit.type === 'activation') {
                const zone = (npHit.hit as ActivationRangeHit).zone;
                if (zone !== 'body') {
                    this.canvas_.style.cursor = 'ew-resize';
                    return;
                }
            }
        }

        this.canvas_.style.cursor = 'default';
    }

    private onWheel(e: WheelEvent): void {
        e.preventDefault();
        if (e.shiftKey) {
            const scrollDelta = e.deltaY;
            this.state_.scrollX = Math.max(0, this.state_.scrollX + scrollDelta);
            this.state_.notify();
        } else {
            const rect = this.canvas_.getBoundingClientRect();
            const pivotX = e.clientX - rect.left;
            this.state_.zoom(-e.deltaY, pivotX);
        }
    }
}
