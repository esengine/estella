import type { TimelineState } from './TimelineState';
import {
    RULER_HEIGHT,
    TRACK_HEIGHT,
    KEYFRAME_SIZE,
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
import {
    AddSpineClipCommand,
    MoveSpineClipCommand,
    ResizeSpineClipCommand,
    DeleteSpineClipCommand,
    AddAudioEventCommand,
    MoveAudioEventCommand,
    DeleteAudioEventCommand,
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
    MoveSpriteAnimStartCommand,
} from './TimelineTrackCommands';

const RULER_BG = '#1e1e1e';
const RULER_TEXT = '#888888';
const RULER_LINE = '#333333';
const TRACK_BG_EVEN = '#252525';
const TRACK_BG_ODD = '#2a2a2a';
const TRACK_SELECTED_BG = '#2c3e50';
const KEYFRAME_COLOR = '#e5c07b';
const KEYFRAME_SELECTED = '#61afef';
const PLAYHEAD_COLOR = '#e06c75';
const SPINE_CLIP_COLOR = 'rgba(97, 175, 239, 0.3)';
const SPINE_CLIP_BORDER = '#61afef';
const ACTIVATION_COLOR = 'rgba(152, 195, 121, 0.3)';
const ACTIVATION_BORDER = '#98c379';
const AUDIO_EVENT_COLOR = '#d19a66';
const CHANNEL_BG = '#1e1e1e';
const KEYFRAME_HIT_RADIUS = 6;
const EDGE_RESIZE_ZONE = 8;
const FRAME_STEP = 1 / 60;
const RUBBERBAND_COLOR = 'rgba(97, 175, 239, 0.2)';
const RUBBERBAND_BORDER = 'rgba(97, 175, 239, 0.6)';
const MARKER_COLOR = '#c678dd';
const CUSTOM_EVENT_COLOR = '#56b6c2';
const SPRITE_ANIM_COLOR = 'rgba(229, 192, 123, 0.3)';
const SPRITE_ANIM_BORDER = '#e5c07b';
const DURATION_LINE_COLOR = '#e5c07b';
const BEYOND_DURATION_COLOR = 'rgba(0, 0, 0, 0.2)';

interface SpineClipHit {
    trackIndex: number;
    clipIndex: number;
    zone: 'body' | 'resize';
}

interface AudioEventHit {
    trackIndex: number;
    eventIndex: number;
}

interface ActivationRangeHit {
    trackIndex: number;
    rangeIndex: number;
    zone: 'body' | 'left' | 'right';
}

interface MarkerHit {
    trackIndex: number;
    markerIndex: number;
}

interface CustomEventHit {
    trackIndex: number;
    eventIndex: number;
}

interface SpriteAnimHit {
    trackIndex: number;
}

export interface TimelineAssetData {
    tracks: TimelineTrackData[];
    duration: number;
}

export interface TimelineTrackData {
    type: string;
    name: string;
    childPath?: string;
    component?: string;
    channels?: { property: string; keyframes: { time: number; value: number; inTangent?: number; outTangent?: number; interpolation?: string }[] }[];
    clips?: { start: number; duration: number; animation: string }[];
    events?: { time: number; clip: string }[];
    ranges?: { start: number; end: number }[];
    markers?: { time: number; name: string }[];
    customEvents?: { time: number; name: string; payload: Record<string, unknown> }[];
    clip?: string;
    startTime?: number;
}

interface KeyframeHit {
    trackIndex: number;
    channelIndex: number;
    keyframeIndex: number;
    time: number;
}

export interface TimelinePanelHost {
    get assetData(): TimelineAssetData | null;
    executeCommand(cmd: import('../../commands/Command').Command): void;
    onAssetDataChanged(): void;
    readPropertyValue(trackIndex: number, channelIndex: number): number;
}

export interface SelectedKeyframeInfo {
    trackIndex: number;
    channelIndex: number;
    keyframeIndex: number;
    time: number;
    value: number;
}

export interface SelectionSummary {
    count: number;
    single: SelectedKeyframeInfo | null;
}

export type KeyframeSelectionCallback = (summary: SelectionSummary) => void;

function kfKey(trackIndex: number, channelIndex: number, keyframeIndex: number): string {
    return `${trackIndex}:${channelIndex}:${keyframeIndex}`;
}

export class TimelineKeyframeArea {
    private canvas_: HTMLCanvasElement;
    private ctx_: CanvasRenderingContext2D;
    private state_: TimelineState;
    private host_: TimelinePanelHost | null;
    private assetData_: TimelineAssetData | null = null;
    private unsub_: (() => void) | null = null;
    private resizeObserver_: ResizeObserver | null = null;
    private selectedKeyframes_: Map<string, KeyframeHit> = new Map();
    private onSelectionChange_: KeyframeSelectionCallback | null = null;
    private rubberBand_: { startX: number; startY: number; endX: number; endY: number } | null = null;
    private clipboard_: { channelIndex: number; relativeTime: number; value: number; inTangent: number; outTangent: number }[] = [];

    constructor(container: HTMLElement, state: TimelineState, host?: TimelinePanelHost) {
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
        this.notifySelectionChange();
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

    draw(): void {
        const ctx = this.ctx_;
        const w = this.canvas_.clientWidth;
        const h = this.canvas_.clientHeight;
        const dpr = window.devicePixelRatio || 1;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        this.drawRuler(ctx, w);
        this.drawTracks(ctx, w, h);
        this.drawDurationEnd(ctx, w, h);
        this.drawPlayhead(ctx, w, h);
        this.drawRubberBand(ctx);
    }

    private drawRuler(ctx: CanvasRenderingContext2D, width: number): void {
        ctx.fillStyle = RULER_BG;
        ctx.fillRect(0, 0, width, RULER_HEIGHT);

        ctx.strokeStyle = RULER_LINE;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, RULER_HEIGHT - 0.5);
        ctx.lineTo(width, RULER_HEIGHT - 0.5);
        ctx.stroke();

        const pps = this.state_.pixelsPerSecond;
        const startTime = this.state_.scrollX / pps;
        const endTime = startTime + width / pps;

        const step = this.calculateRulerStep(pps);
        const firstTick = Math.floor(startTime / step) * step;

        ctx.fillStyle = RULER_TEXT;
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';

        for (let t = firstTick; t <= endTime; t += step) {
            const x = this.state_.timeToX(t);
            if (x < -50 || x > width + 50) continue;

            ctx.strokeStyle = RULER_LINE;
            ctx.beginPath();
            ctx.moveTo(Math.round(x) + 0.5, RULER_HEIGHT - 8);
            ctx.lineTo(Math.round(x) + 0.5, RULER_HEIGHT);
            ctx.stroke();

            ctx.fillText(this.state_.formatTime(Math.max(0, t)), x, RULER_HEIGHT - 10);

            const subStep = step / 5;
            for (let st = t + subStep; st < t + step - subStep / 2; st += subStep) {
                const sx = this.state_.timeToX(st);
                if (sx < 0 || sx > width) continue;
                ctx.strokeStyle = RULER_LINE;
                ctx.beginPath();
                ctx.moveTo(Math.round(sx) + 0.5, RULER_HEIGHT - 4);
                ctx.lineTo(Math.round(sx) + 0.5, RULER_HEIGHT);
                ctx.stroke();
            }
        }
    }

    private calculateRulerStep(pps: number): number {
        const minPixelsBetweenLabels = 80;
        const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60];
        for (const s of steps) {
            if (s * pps >= minPixelsBetweenLabels) return s;
        }
        return 60;
    }

    private drawTracks(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        const tracks = this.state_.tracks;
        let y = RULER_HEIGHT;

        for (let i = 0; i < tracks.length; i++) {
            if (y > height) break;
            const track = tracks[i];

            const bg = track.index === this.state_.selectedTrackIndex
                ? TRACK_SELECTED_BG
                : i % 2 === 0 ? TRACK_BG_EVEN : TRACK_BG_ODD;

            ctx.fillStyle = bg;
            ctx.fillRect(0, y, width, TRACK_HEIGHT);

            ctx.strokeStyle = RULER_LINE;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, y + TRACK_HEIGHT - 0.5);
            ctx.lineTo(width, y + TRACK_HEIGHT - 0.5);
            ctx.stroke();

            this.drawTrackContent(ctx, track, y, width);
            y += TRACK_HEIGHT;

            if (track.expanded && track.channelCount > 0) {
                const assetTrack = this.assetData_?.tracks[track.index];
                const channels = (assetTrack as any)?.channels ?? [];
                for (let c = 0; c < track.channelCount; c++) {
                    if (y > height) break;
                    ctx.fillStyle = CHANNEL_BG;
                    ctx.fillRect(0, y, width, TRACK_HEIGHT);

                    ctx.strokeStyle = RULER_LINE;
                    ctx.beginPath();
                    ctx.moveTo(0, y + TRACK_HEIGHT - 0.5);
                    ctx.lineTo(width, y + TRACK_HEIGHT - 0.5);
                    ctx.stroke();

                    const channel = channels[c];
                    if (channel) {
                        this.drawKeyframes(ctx, channel.keyframes, y, track.index, c);
                    }
                    y += TRACK_HEIGHT;
                }
            }
        }
    }

    private drawTrackContent(
        ctx: CanvasRenderingContext2D,
        track: { type: string; index: number },
        y: number,
        width: number,
    ): void {
        if (!this.assetData_) return;
        const assetTrack = this.assetData_.tracks[track.index];
        if (!assetTrack) return;

        switch (assetTrack.type) {
            case 'property':
                if (!track.type) break;
                for (let c = 0; c < (assetTrack.channels ?? []).length; c++) {
                    this.drawKeyframes(ctx, assetTrack.channels![c].keyframes, y, track.index, c);
                }
                break;

            case 'spine':
                this.drawSpineClips(ctx, assetTrack.clips ?? [], y, width);
                break;

            case 'spriteAnim':
                if (assetTrack.startTime != null) {
                    this.drawSpriteAnimClip(ctx, assetTrack.startTime, assetTrack.clip ?? '', y, width);
                }
                break;

            case 'audio':
                this.drawAudioEvents(ctx, assetTrack.events ?? [], y);
                break;

            case 'activation':
                this.drawActivationRanges(ctx, assetTrack.ranges ?? [], y, width);
                break;

            case 'marker':
                this.drawMarkers(ctx, assetTrack.markers ?? [], y);
                break;

            case 'customEvent':
                this.drawCustomEvents(ctx, assetTrack.customEvents ?? [], y);
                break;
        }
    }

    private drawCustomEvents(
        ctx: CanvasRenderingContext2D,
        events: { time: number; name: string }[],
        y: number,
    ): void {
        for (const event of events) {
            const x = this.state_.timeToX(event.time);
            ctx.fillStyle = CUSTOM_EVENT_COLOR;
            ctx.fillRect(x - 1, y + 2, 3, TRACK_HEIGHT - 4);

            ctx.beginPath();
            ctx.arc(x, y + 6, 4, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#cccccc';
            ctx.font = '9px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(event.name, x + 6, y + TRACK_HEIGHT / 2 + 3);
        }
    }

    private drawMarkers(
        ctx: CanvasRenderingContext2D,
        markers: { time: number; name: string }[],
        y: number,
    ): void {
        for (const marker of markers) {
            const x = this.state_.timeToX(marker.time);
            ctx.fillStyle = MARKER_COLOR;
            ctx.fillRect(x - 1, y + 2, 3, TRACK_HEIGHT - 4);

            ctx.beginPath();
            ctx.moveTo(x - 5, y + 2);
            ctx.lineTo(x + 5, y + 2);
            ctx.lineTo(x, y + 8);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = '#cccccc';
            ctx.font = '9px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(marker.name, x + 6, y + TRACK_HEIGHT / 2 + 3);
        }
    }

    private drawKeyframes(
        ctx: CanvasRenderingContext2D,
        keyframes: { time: number }[],
        y: number,
        trackIndex: number,
        channelIndex: number,
    ): void {
        const cy = y + TRACK_HEIGHT / 2;
        const half = KEYFRAME_SIZE / 2;

        for (let ki = 0; ki < keyframes.length; ki++) {
            const kf = keyframes[ki];
            const x = this.state_.timeToX(kf.time);
            if (x < -KEYFRAME_SIZE || x > this.canvas_.clientWidth + KEYFRAME_SIZE) continue;

            const isSelected = this.isKeyframeSelected(trackIndex, channelIndex, ki);

            ctx.fillStyle = isSelected ? KEYFRAME_SELECTED : KEYFRAME_COLOR;
            ctx.beginPath();
            ctx.moveTo(x, cy - half);
            ctx.lineTo(x + half, cy);
            ctx.lineTo(x, cy + half);
            ctx.lineTo(x - half, cy);
            ctx.closePath();
            ctx.fill();
        }
    }

    private drawSpineClips(
        ctx: CanvasRenderingContext2D,
        clips: { start: number; duration: number; animation: string }[],
        y: number,
        _width: number,
    ): void {
        const clipY = y + 3;
        const clipH = TRACK_HEIGHT - 6;

        for (const clip of clips) {
            const x1 = this.state_.timeToX(clip.start);
            const x2 = this.state_.timeToX(clip.start + clip.duration);
            const w = x2 - x1;
            if (w < 1) continue;

            ctx.fillStyle = SPINE_CLIP_COLOR;
            ctx.fillRect(x1, clipY, w, clipH);
            ctx.strokeStyle = SPINE_CLIP_BORDER;
            ctx.lineWidth = 1;
            ctx.strokeRect(x1 + 0.5, clipY + 0.5, w - 1, clipH - 1);

            ctx.fillStyle = '#cccccc';
            ctx.font = '10px monospace';
            ctx.textAlign = 'left';
            const textX = Math.max(x1 + 4, 4);
            ctx.save();
            ctx.beginPath();
            ctx.rect(x1, clipY, w, clipH);
            ctx.clip();
            ctx.fillText(clip.animation, textX, clipY + clipH / 2 + 3);
            ctx.restore();
        }
    }

    private drawSpriteAnimClip(
        ctx: CanvasRenderingContext2D,
        startTime: number,
        clipName: string,
        y: number,
        width: number,
    ): void {
        const x1 = this.state_.timeToX(startTime);
        const x2 = Math.min(this.state_.timeToX(this.state_.duration), width);
        const clipY = y + 3;
        const clipH = TRACK_HEIGHT - 6;

        if (x2 > x1) {
            ctx.fillStyle = SPRITE_ANIM_COLOR;
            ctx.fillRect(x1, clipY, x2 - x1, clipH);
            ctx.strokeStyle = SPRITE_ANIM_BORDER;
            ctx.lineWidth = 1;
            ctx.strokeRect(x1 + 0.5, clipY + 0.5, x2 - x1 - 1, clipH - 1);
        }

        ctx.fillStyle = SPRITE_ANIM_BORDER;
        ctx.fillRect(x1 - 1, y + 2, 3, TRACK_HEIGHT - 4);

        if (clipName) {
            ctx.fillStyle = '#cccccc';
            ctx.font = '10px monospace';
            ctx.textAlign = 'left';
            const textX = Math.max(x1 + 6, 6);
            ctx.save();
            if (x2 > x1) {
                ctx.beginPath();
                ctx.rect(x1, clipY, x2 - x1, clipH);
                ctx.clip();
            }
            ctx.fillText(clipName, textX, clipY + clipH / 2 + 3);
            ctx.restore();
        }
    }

    private drawAudioEvents(
        ctx: CanvasRenderingContext2D,
        events: { time: number }[],
        y: number,
    ): void {
        for (const event of events) {
            const x = this.state_.timeToX(event.time);
            ctx.fillStyle = AUDIO_EVENT_COLOR;
            ctx.fillRect(x - 1, y + 2, 3, TRACK_HEIGHT - 4);

            ctx.beginPath();
            ctx.moveTo(x - 4, y + 2);
            ctx.lineTo(x + 4, y + 2);
            ctx.lineTo(x, y + 8);
            ctx.closePath();
            ctx.fill();
        }
    }

    private drawActivationRanges(
        ctx: CanvasRenderingContext2D,
        ranges: { start: number; end: number }[],
        y: number,
        _width: number,
    ): void {
        const rangeY = y + 4;
        const rangeH = TRACK_HEIGHT - 8;

        for (const range of ranges) {
            const x1 = this.state_.timeToX(range.start);
            const x2 = this.state_.timeToX(range.end);
            const w = x2 - x1;
            if (w < 1) continue;

            ctx.fillStyle = ACTIVATION_COLOR;
            ctx.fillRect(x1, rangeY, w, rangeH);
            ctx.strokeStyle = ACTIVATION_BORDER;
            ctx.lineWidth = 1;
            ctx.strokeRect(x1 + 0.5, rangeY + 0.5, w - 1, rangeH - 1);
        }
    }

    private drawPlayhead(ctx: CanvasRenderingContext2D, _width: number, height: number): void {
        const x = this.state_.timeToX(this.state_.playheadTime);
        if (x < -10 || x > this.canvas_.clientWidth + 10) return;

        ctx.strokeStyle = PLAYHEAD_COLOR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, 0);
        ctx.lineTo(Math.round(x) + 0.5, height);
        ctx.stroke();

        ctx.fillStyle = PLAYHEAD_COLOR;
        ctx.beginPath();
        ctx.moveTo(x - 5, 0);
        ctx.lineTo(x + 5, 0);
        ctx.lineTo(x, 8);
        ctx.closePath();
        ctx.fill();
    }

    private drawDurationEnd(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        const x = this.state_.timeToX(this.state_.duration);
        if (x < 0) return;

        if (x < width) {
            ctx.strokeStyle = DURATION_LINE_COLOR;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(Math.round(x) + 0.5, RULER_HEIGHT);
            ctx.lineTo(Math.round(x) + 0.5, height);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        const overlayX = Math.max(x, 0);
        if (overlayX < width) {
            ctx.fillStyle = BEYOND_DURATION_COLOR;
            ctx.fillRect(overlayX, RULER_HEIGHT, width - overlayX, height - RULER_HEIGHT);
        }
    }

    private drawRubberBand(ctx: CanvasRenderingContext2D): void {
        if (!this.rubberBand_) return;
        const rb = this.rubberBand_;
        const x = Math.min(rb.startX, rb.endX);
        const y = Math.min(rb.startY, rb.endY);
        const w = Math.abs(rb.endX - rb.startX);
        const h = Math.abs(rb.endY - rb.startY);

        ctx.fillStyle = RUBBERBAND_COLOR;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = RUBBERBAND_BORDER;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }

    private hitTestKeyframe(x: number, y: number): KeyframeHit | null {
        if (!this.assetData_) return null;

        const tracks = this.state_.tracks;
        let rowY = RULER_HEIGHT;

        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            const assetTrack = this.assetData_.tracks[track.index];

            if (assetTrack?.type === 'property' && assetTrack.channels) {
                if (y >= rowY && y < rowY + TRACK_HEIGHT) {
                    const hit = this.hitTestChannelKeyframes(assetTrack.channels, x, rowY, track.index);
                    if (hit) return hit;
                }
            }
            rowY += TRACK_HEIGHT;

            if (track.expanded && track.channelCount > 0 && assetTrack?.type === 'property') {
                for (let c = 0; c < track.channelCount; c++) {
                    if (y >= rowY && y < rowY + TRACK_HEIGHT) {
                        const channel = assetTrack.channels?.[c];
                        if (channel) {
                            const hit = this.hitTestSingleChannel(channel.keyframes, x, rowY, track.index, c);
                            if (hit) return hit;
                        }
                    }
                    rowY += TRACK_HEIGHT;
                }
            }
        }

        return null;
    }

    private hitTestChannelKeyframes(
        channels: { keyframes: { time: number }[] }[],
        x: number,
        rowY: number,
        trackIndex: number,
    ): KeyframeHit | null {
        for (let c = 0; c < channels.length; c++) {
            const hit = this.hitTestSingleChannel(channels[c].keyframes, x, rowY, trackIndex, c);
            if (hit) return hit;
        }
        return null;
    }

    private hitTestSingleChannel(
        keyframes: { time: number }[],
        x: number,
        rowY: number,
        trackIndex: number,
        channelIndex: number,
    ): KeyframeHit | null {
        const cy = rowY + TRACK_HEIGHT / 2;

        for (let ki = 0; ki < keyframes.length; ki++) {
            const kf = keyframes[ki];
            const kx = this.state_.timeToX(kf.time);
            const dx = x - kx;
            const dy = (rowY + TRACK_HEIGHT / 2) - cy;

            if (Math.abs(dx) <= KEYFRAME_HIT_RADIUS && Math.abs(dy) <= KEYFRAME_HIT_RADIUS) {
                return { trackIndex, channelIndex, keyframeIndex: ki, time: kf.time };
            }
        }
        return null;
    }

    private hitTestSpineClip(x: number, y: number, trackIndex: number, rowY: number): SpineClipHit | null {
        if (!this.assetData_) return null;
        const track = this.assetData_.tracks[trackIndex];
        if (!track || track.type !== 'spine' || !track.clips) return null;
        if (y < rowY || y >= rowY + TRACK_HEIGHT) return null;

        for (let i = 0; i < track.clips.length; i++) {
            const clip = track.clips[i];
            const x1 = this.state_.timeToX(clip.start);
            const x2 = this.state_.timeToX(clip.start + clip.duration);
            if (x >= x1 && x <= x2) {
                const zone = (x2 - x) <= EDGE_RESIZE_ZONE ? 'resize' : 'body';
                return { trackIndex, clipIndex: i, zone };
            }
        }
        return null;
    }

    private hitTestAudioEvent(x: number, y: number, trackIndex: number, rowY: number): AudioEventHit | null {
        if (!this.assetData_) return null;
        const track = this.assetData_.tracks[trackIndex];
        if (!track || track.type !== 'audio' || !track.events) return null;
        if (y < rowY || y >= rowY + TRACK_HEIGHT) return null;

        for (let i = 0; i < track.events.length; i++) {
            const ex = this.state_.timeToX(track.events[i].time);
            if (Math.abs(x - ex) <= KEYFRAME_HIT_RADIUS) {
                return { trackIndex, eventIndex: i };
            }
        }
        return null;
    }

    private hitTestActivationRange(x: number, y: number, trackIndex: number, rowY: number): ActivationRangeHit | null {
        if (!this.assetData_) return null;
        const track = this.assetData_.tracks[trackIndex];
        if (!track || track.type !== 'activation' || !track.ranges) return null;
        if (y < rowY || y >= rowY + TRACK_HEIGHT) return null;

        for (let i = 0; i < track.ranges.length; i++) {
            const range = track.ranges[i];
            const x1 = this.state_.timeToX(range.start);
            const x2 = this.state_.timeToX(range.end);
            if (x >= x1 && x <= x2) {
                const zone = (x - x1) <= EDGE_RESIZE_ZONE ? 'left'
                    : (x2 - x) <= EDGE_RESIZE_ZONE ? 'right'
                    : 'body';
                return { trackIndex, rangeIndex: i, zone };
            }
        }
        return null;
    }

    private hitTestMarker(x: number, trackIndex: number): MarkerHit | null {
        if (!this.assetData_) return null;
        const track = this.assetData_.tracks[trackIndex];
        if (!track || track.type !== 'marker' || !track.markers) return null;

        for (let i = 0; i < track.markers.length; i++) {
            const mx = this.state_.timeToX(track.markers[i].time);
            if (Math.abs(x - mx) <= KEYFRAME_HIT_RADIUS) {
                return { trackIndex, markerIndex: i };
            }
        }
        return null;
    }

    private hitTestCustomEvent(x: number, trackIndex: number): CustomEventHit | null {
        if (!this.assetData_) return null;
        const track = this.assetData_.tracks[trackIndex];
        if (!track || track.type !== 'customEvent' || !track.customEvents) return null;

        for (let i = 0; i < track.customEvents.length; i++) {
            const ex = this.state_.timeToX(track.customEvents[i].time);
            if (Math.abs(x - ex) <= KEYFRAME_HIT_RADIUS) {
                return { trackIndex, eventIndex: i };
            }
        }
        return null;
    }

    private hitTestSpriteAnim(x: number, trackIndex: number): SpriteAnimHit | null {
        if (!this.assetData_) return null;
        const track = this.assetData_.tracks[trackIndex];
        if (!track || track.type !== 'spriteAnim' || track.startTime == null) return null;

        const sx = this.state_.timeToX(track.startTime);
        if (Math.abs(x - sx) <= KEYFRAME_HIT_RADIUS) {
            return { trackIndex };
        }
        return null;
    }

    private hitTestNonPropertyTrack(x: number, y: number): { type: string; hit: SpineClipHit | AudioEventHit | ActivationRangeHit | MarkerHit | CustomEventHit | SpriteAnimHit } | null {
        if (!this.assetData_) return null;

        const tracks = this.state_.tracks;
        let rowY = RULER_HEIGHT;

        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            const assetTrack = this.assetData_.tracks[track.index];

            if (y >= rowY && y < rowY + TRACK_HEIGHT && assetTrack) {
                if (assetTrack.type === 'spine') {
                    const hit = this.hitTestSpineClip(x, y, track.index, rowY);
                    if (hit) return { type: 'spine', hit };
                } else if (assetTrack.type === 'audio') {
                    const hit = this.hitTestAudioEvent(x, y, track.index, rowY);
                    if (hit) return { type: 'audio', hit };
                } else if (assetTrack.type === 'activation') {
                    const hit = this.hitTestActivationRange(x, y, track.index, rowY);
                    if (hit) return { type: 'activation', hit };
                } else if (assetTrack.type === 'marker') {
                    const hit = this.hitTestMarker(x, track.index);
                    if (hit) return { type: 'marker', hit };
                } else if (assetTrack.type === 'customEvent') {
                    const hit = this.hitTestCustomEvent(x, track.index);
                    if (hit) return { type: 'customEvent', hit };
                } else if (assetTrack.type === 'spriteAnim') {
                    const hit = this.hitTestSpriteAnim(x, track.index);
                    if (hit) return { type: 'spriteAnim', hit };
                }
            }
            rowY += TRACK_HEIGHT;

            if (track.expanded && track.channelCount > 0) {
                rowY += track.channelCount * TRACK_HEIGHT;
            }
        }
        return null;
    }

    private collectKeyframesInRect(
        x1: number, y1: number, x2: number, y2: number,
    ): KeyframeHit[] {
        if (!this.assetData_) return [];

        const minX = Math.min(x1, x2);
        const maxX = Math.max(x1, x2);
        const minY = Math.min(y1, y2);
        const maxY = Math.max(y1, y2);
        const hits: KeyframeHit[] = [];

        const tracks = this.state_.tracks;
        let rowY = RULER_HEIGHT;

        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            const assetTrack = this.assetData_.tracks[track.index];

            if (assetTrack?.type === 'property' && assetTrack.channels) {
                if (rowY + TRACK_HEIGHT > minY && rowY < maxY) {
                    for (let c = 0; c < assetTrack.channels.length; c++) {
                        this.collectChannelKeyframesInRange(
                            assetTrack.channels[c].keyframes, minX, maxX,
                            track.index, c, hits,
                        );
                    }
                }
            }
            rowY += TRACK_HEIGHT;

            if (track.expanded && track.channelCount > 0 && assetTrack?.type === 'property') {
                for (let c = 0; c < track.channelCount; c++) {
                    if (rowY + TRACK_HEIGHT > minY && rowY < maxY) {
                        const channel = assetTrack.channels?.[c];
                        if (channel) {
                            this.collectChannelKeyframesInRange(
                                channel.keyframes, minX, maxX,
                                track.index, c, hits,
                            );
                        }
                    }
                    rowY += TRACK_HEIGHT;
                }
            }
        }

        return hits;
    }

    private collectChannelKeyframesInRange(
        keyframes: { time: number }[],
        minX: number, maxX: number,
        trackIndex: number, channelIndex: number,
        out: KeyframeHit[],
    ): void {
        for (let ki = 0; ki < keyframes.length; ki++) {
            const kx = this.state_.timeToX(keyframes[ki].time);
            if (kx >= minX && kx <= maxX) {
                out.push({ trackIndex, channelIndex, keyframeIndex: ki, time: keyframes[ki].time });
            }
        }
    }

    private getTrackAtY(y: number): { trackIndex: number; channelIndex: number; isChannel: boolean } | null {
        const tracks = this.state_.tracks;
        let rowY = RULER_HEIGHT;

        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];

            if (y >= rowY && y < rowY + TRACK_HEIGHT) {
                return { trackIndex: track.index, channelIndex: -1, isChannel: false };
            }
            rowY += TRACK_HEIGHT;

            if (track.expanded && track.channelCount > 0) {
                for (let c = 0; c < track.channelCount; c++) {
                    if (y >= rowY && y < rowY + TRACK_HEIGHT) {
                        return { trackIndex: track.index, channelIndex: c, isChannel: true };
                    }
                    rowY += TRACK_HEIGHT;
                }
            }
        }
        return null;
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

        const hit = this.hitTestKeyframe(x, y);

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

        const npHit = this.hitTestNonPropertyTrack(x, y);
        if (npHit) {
            this.clearSelection();
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
            }
            return;
        }

        if (!e.ctrlKey && !e.metaKey) {
            this.clearSelection();
        }
        this.draw();

        const trackInfo = this.getTrackAtY(y);
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

    private startCustomEventDrag(_e: MouseEvent, rect: DOMRect, hit: CustomEventHit): void {
        if (!this.assetData_ || !this.host_) return;
        const track = this.assetData_.tracks[hit.trackIndex];
        if (!track?.customEvents) return;
        const event = track.customEvents[hit.eventIndex];
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
                const hits = this.collectKeyframesInRect(rb.startX, rb.startY, rb.endX, rb.endY);
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

    private onDoubleClick(e: MouseEvent): void {
        if (!this.assetData_ || !this.host_) return;

        const rect = this.canvas_.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (y < RULER_HEIGHT) return;

        const hit = this.hitTestKeyframe(x, y);
        if (hit) return;

        const npHit = this.hitTestNonPropertyTrack(x, y);
        if (npHit) return;

        const trackInfo = this.getTrackAtY(y);
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
                const cmd = new AddSpineClipCommand(
                    this.assetData_, trackInfo.trackIndex,
                    { start: time, duration: 1, animation: 'idle' },
                    () => this.host_!.onAssetDataChanged(),
                );
                this.host_.executeCommand(cmd);
                break;
            }
            case 'audio': {
                const cmd = new AddAudioEventCommand(
                    this.assetData_, trackInfo.trackIndex,
                    { time, clip: '' },
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

        const hit = this.hitTestKeyframe(x, y);
        const trackInfo = this.getTrackAtY(y);

        const menu = document.createElement('div');
        menu.className = 'es-timeline-dropdown';
        menu.style.position = 'fixed';
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;

        const npHit = this.hitTestNonPropertyTrack(x, y);

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
        npHit: { type: string; hit: SpineClipHit | AudioEventHit | ActivationRangeHit | MarkerHit | CustomEventHit | SpriteAnimHit },
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
            const item = document.createElement('div');
            item.className = 'es-timeline-dropdown-item';
            item.textContent = 'Delete Event';
            item.addEventListener('click', () => {
                menu.remove();
                const cmd = new DeleteAudioEventCommand(
                    this.assetData_!, hit.trackIndex, hit.eventIndex,
                    () => this.host_!.onAssetDataChanged(),
                );
                this.host_!.executeCommand(cmd);
            });
            menu.appendChild(item);
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
            const item = document.createElement('div');
            item.className = 'es-timeline-dropdown-item';
            item.textContent = 'Delete Marker';
            item.addEventListener('click', () => {
                menu.remove();
                const cmd = new DeleteMarkerCommand(
                    this.assetData_!, hit.trackIndex, hit.markerIndex,
                    () => this.host_!.onAssetDataChanged(),
                );
                this.host_!.executeCommand(cmd);
            });
            menu.appendChild(item);
        } else if (npHit.type === 'customEvent') {
            const hit = npHit.hit as CustomEventHit;
            const item = document.createElement('div');
            item.className = 'es-timeline-dropdown-item';
            item.textContent = 'Delete Event';
            item.addEventListener('click', () => {
                menu.remove();
                const cmd = new DeleteCustomEventCommand(
                    this.assetData_!, hit.trackIndex, hit.eventIndex,
                    () => this.host_!.onAssetDataChanged(),
                );
                this.host_!.executeCommand(cmd);
            });
            menu.appendChild(item);
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

    private onWheel(e: WheelEvent): void {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
            const rect = this.canvas_.getBoundingClientRect();
            const pivotX = e.clientX - rect.left;
            this.state_.zoom(-e.deltaY, pivotX);
        } else {
            const dx = e.shiftKey ? e.deltaY : e.deltaX;
            const scrollDelta = dx !== 0 ? dx : e.deltaY;
            this.state_.scrollX = Math.max(0, this.state_.scrollX + scrollDelta);
            this.state_.notify();
        }
    }
}
