import type { TimelineState } from './TimelineState';
import {
    RULER_HEIGHT,
    TRACK_HEIGHT,
    KEYFRAME_SIZE,
} from './TimelineState';
import {
    AddKeyframeCommand,
    DeleteKeyframeCommand,
    MoveKeyframeCommand,
} from './TimelineCommands';

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

export interface TimelineAssetData {
    tracks: TimelineTrackData[];
    duration: number;
}

export interface TimelineTrackData {
    type: string;
    name: string;
    childPath?: string;
    component?: string;
    channels?: { property: string; keyframes: { time: number; value: number; inTangent?: number; outTangent?: number }[] }[];
    clips?: { start: number; duration: number; animation: string }[];
    events?: { time: number; clip: string }[];
    ranges?: { start: number; end: number }[];
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

export type KeyframeSelectionCallback = (info: SelectedKeyframeInfo | null) => void;

export class TimelineKeyframeArea {
    private canvas_: HTMLCanvasElement;
    private ctx_: CanvasRenderingContext2D;
    private state_: TimelineState;
    private host_: TimelinePanelHost | null;
    private assetData_: TimelineAssetData | null = null;
    private unsub_: (() => void) | null = null;
    private resizeObserver_: ResizeObserver | null = null;
    private selectedKeyframe_: KeyframeHit | null = null;
    private onSelectionChange_: KeyframeSelectionCallback | null = null;

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
        this.setSelectedKeyframe(null);
        this.draw();
    }

    set onKeyframeSelectionChange(cb: KeyframeSelectionCallback | null) {
        this.onSelectionChange_ = cb;
    }

    private setSelectedKeyframe(hit: KeyframeHit | null): void {
        this.selectedKeyframe_ = hit;
        if (!hit || !this.assetData_) {
            this.onSelectionChange_?.(null);
            return;
        }
        const track = this.assetData_.tracks[hit.trackIndex];
        const kf = track?.channels?.[hit.channelIndex]?.keyframes[hit.keyframeIndex];
        if (!kf) {
            this.onSelectionChange_?.(null);
            return;
        }
        this.onSelectionChange_?.({
            trackIndex: hit.trackIndex,
            channelIndex: hit.channelIndex,
            keyframeIndex: hit.keyframeIndex,
            time: kf.time,
            value: kf.value,
        });
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
        this.drawPlayhead(ctx, w, h);
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
                    this.drawSpriteAnimMarker(ctx, assetTrack.startTime, y);
                }
                break;

            case 'audio':
                this.drawAudioEvents(ctx, assetTrack.events ?? [], y);
                break;

            case 'activation':
                this.drawActivationRanges(ctx, assetTrack.ranges ?? [], y, width);
                break;
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

            const isSelected = this.selectedKeyframe_ !== null
                && this.selectedKeyframe_.trackIndex === trackIndex
                && this.selectedKeyframe_.channelIndex === channelIndex
                && this.selectedKeyframe_.keyframeIndex === ki;

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

    private drawSpriteAnimMarker(
        ctx: CanvasRenderingContext2D,
        startTime: number,
        y: number,
    ): void {
        const x = this.state_.timeToX(startTime);
        ctx.fillStyle = KEYFRAME_COLOR;
        ctx.fillRect(x - 1, y + 2, 3, TRACK_HEIGHT - 4);
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
        const rect = this.canvas_.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (y < RULER_HEIGHT) {
            this.startPlayheadDrag(e, rect);
            return;
        }

        const hit = this.hitTestKeyframe(x, y);

        if (hit) {
            this.setSelectedKeyframe(hit);
            this.draw();
            this.canvas_.focus();
            this.startKeyframeDrag(e, rect, hit);
            return;
        }

        this.setSelectedKeyframe(null);
        this.draw();

        const trackInfo = this.getTrackAtY(y);
        if (trackInfo) {
            this.state_.selectedTrackIndex = trackInfo.trackIndex;
            this.state_.notify();
        }
    }

    private onDoubleClick(e: MouseEvent): void {
        if (!this.assetData_ || !this.host_) return;

        const rect = this.canvas_.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (y < RULER_HEIGHT) return;

        const hit = this.hitTestKeyframe(x, y);
        if (hit) return;

        const trackInfo = this.getTrackAtY(y);
        if (!trackInfo) return;

        const assetTrack = this.assetData_.tracks[trackInfo.trackIndex];
        if (!assetTrack || assetTrack.type !== 'property') return;

        const channelIndex = trackInfo.isChannel ? trackInfo.channelIndex : 0;
        if (!assetTrack.channels || channelIndex < 0 || channelIndex >= assetTrack.channels.length) return;

        const time = Math.max(0, this.state_.xToTime(x));
        const value = this.host_.readPropertyValue(trackInfo.trackIndex, channelIndex);
        const cmd = new AddKeyframeCommand(
            this.assetData_,
            trackInfo.trackIndex,
            channelIndex,
            { time, value },
            () => this.host_!.onAssetDataChanged(),
        );
        this.host_.executeCommand(cmd);
    }

    private startKeyframeDrag(e: MouseEvent, rect: DOMRect, hit: KeyframeHit): void {
        if (!this.assetData_ || !this.host_) return;

        let lastTime = hit.time;

        const onMove = (ev: MouseEvent) => {
            const x = ev.clientX - rect.left;
            const newTime = Math.max(0, this.state_.xToTime(x));

            const cmd = new MoveKeyframeCommand(
                this.assetData_!,
                hit.trackIndex,
                hit.channelIndex,
                hit.keyframeIndex,
                lastTime,
                newTime,
                () => this.host_!.onAssetDataChanged(),
            );
            this.host_!.executeCommand(cmd);
            lastTime = newTime;
        };

        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    private onKeyDown(e: KeyboardEvent): void {
        if (!this.assetData_ || !this.host_) return;

        if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedKeyframe_) {
            e.preventDefault();
            e.stopPropagation();
            const { trackIndex, channelIndex, keyframeIndex } = this.selectedKeyframe_;
            const cmd = new DeleteKeyframeCommand(
                this.assetData_,
                trackIndex,
                channelIndex,
                [keyframeIndex],
                () => this.host_!.onAssetDataChanged(),
            );
            this.host_.executeCommand(cmd);
            this.setSelectedKeyframe(null);
            return;
        }

        if (e.key === 'k' || e.key === 'K') {
            e.preventDefault();
            this.addKeyframeAtPlayhead();
        }
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

        if (hit) {
            this.setSelectedKeyframe(hit);
            this.draw();

            const deleteItem = document.createElement('div');
            deleteItem.className = 'es-timeline-dropdown-item';
            deleteItem.textContent = 'Delete Keyframe';
            deleteItem.addEventListener('click', () => {
                menu.remove();
                const cmd = new DeleteKeyframeCommand(
                    this.assetData_!,
                    hit.trackIndex,
                    hit.channelIndex,
                    [hit.keyframeIndex],
                    () => this.host_!.onAssetDataChanged(),
                );
                this.host_!.executeCommand(cmd);
                this.selectedKeyframe_ = null;
            });
            menu.appendChild(deleteItem);
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
                this.assetData_!.tracks.splice(trackInfo.trackIndex, 1);
                this.host_!.onAssetDataChanged();
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

    private onWheel(e: WheelEvent): void {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
            const rect = this.canvas_.getBoundingClientRect();
            const pivotX = e.clientX - rect.left;
            this.state_.zoom(-e.deltaY, pivotX);
        } else {
            this.state_.scrollX = Math.max(0, this.state_.scrollX + e.deltaX);
            this.state_.notify();
        }
    }
}
