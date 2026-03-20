import type { TimelineState } from './TimelineState';
import {
    RULER_HEIGHT,
    TRACK_HEIGHT,
    KEYFRAME_SIZE,
} from './TimelineState';
import type {
    TimelineAssetData,
    TimelineCustomEvent,
    AnimFrameData,
} from './TimelineTypes';
import { isUUID, getAssetLibrary } from '../../asset/AssetDatabase';

export const RULER_BG = '#1e1e1e';
export const RULER_TEXT = '#888888';
export const RULER_LINE = '#333333';
export const TRACK_BG_EVEN = '#252525';
export const TRACK_BG_ODD = '#2a2a2a';
export const TRACK_SELECTED_BG = '#2c3e50';
export const KEYFRAME_COLOR = '#e5c07b';
export const KEYFRAME_SELECTED = '#61afef';
export const PLAYHEAD_COLOR = '#e06c75';
export const SPINE_CLIP_COLOR = 'rgba(97, 175, 239, 0.3)';
export const SPINE_CLIP_BORDER = '#61afef';
export const ACTIVATION_COLOR = 'rgba(152, 195, 121, 0.3)';
export const ACTIVATION_BORDER = '#98c379';
export const AUDIO_EVENT_COLOR = '#d19a66';
export const CHANNEL_BG = '#1e1e1e';
export const RUBBERBAND_COLOR = 'rgba(97, 175, 239, 0.2)';
export const RUBBERBAND_BORDER = 'rgba(97, 175, 239, 0.6)';
export const MARKER_COLOR = '#c678dd';
export const CUSTOM_EVENT_COLOR = '#56b6c2';
export const SPRITE_ANIM_COLOR = 'rgba(229, 192, 123, 0.3)';
export const SPRITE_ANIM_BORDER = '#e5c07b';
export const DURATION_LINE_COLOR = '#e5c07b';
export const BEYOND_DURATION_COLOR = 'rgba(0, 0, 0, 0.2)';
export const ANIM_FRAME_COLORS = ['#61afef', '#c678dd', '#e5c07b', '#98c379', '#d19a66', '#56b6c2', '#e06c75'];
export const ANIM_FRAME_BORDER = '#ffffff30';

export interface TimelineRenderContext {
    state: TimelineState;
    assetData: TimelineAssetData | null;
    canvasWidth: number;
    isKeyframeSelected: (trackIndex: number, channelIndex: number, keyframeIndex: number) => boolean;
    isNpItemSelected: (type: string, trackIndex: number, itemIndex: number) => boolean;
    frameImageCache: Map<string, HTMLImageElement> | null;
    setFrameImageCache: (cache: Map<string, HTMLImageElement>) => void;
    requestRedraw: () => void;
}

export function drawRuler(ctx: CanvasRenderingContext2D, width: number, rc: TimelineRenderContext): void {
    ctx.fillStyle = RULER_BG;
    ctx.fillRect(0, 0, width, RULER_HEIGHT);

    ctx.strokeStyle = RULER_LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, RULER_HEIGHT - 0.5);
    ctx.lineTo(width, RULER_HEIGHT - 0.5);
    ctx.stroke();

    const pps = rc.state.pixelsPerSecond;
    const startTime = rc.state.scrollX / pps;
    const endTime = startTime + width / pps;

    const step = calculateRulerStep(pps);
    const firstTick = Math.floor(startTime / step) * step;

    ctx.fillStyle = RULER_TEXT;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';

    for (let t = firstTick; t <= endTime; t += step) {
        const x = rc.state.timeToX(t);
        if (x < -50 || x > width + 50) continue;

        ctx.strokeStyle = RULER_LINE;
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, RULER_HEIGHT - 8);
        ctx.lineTo(Math.round(x) + 0.5, RULER_HEIGHT);
        ctx.stroke();

        ctx.fillText(rc.state.formatTime(Math.max(0, t)), x, RULER_HEIGHT - 10);

        const subStep = step / 5;
        for (let st = t + subStep; st < t + step - subStep / 2; st += subStep) {
            const sx = rc.state.timeToX(st);
            if (sx < 0 || sx > width) continue;
            ctx.strokeStyle = RULER_LINE;
            ctx.beginPath();
            ctx.moveTo(Math.round(sx) + 0.5, RULER_HEIGHT - 4);
            ctx.lineTo(Math.round(sx) + 0.5, RULER_HEIGHT);
            ctx.stroke();
        }
    }
}

function calculateRulerStep(pps: number): number {
    const minPixelsBetweenLabels = 80;
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60];
    for (const s of steps) {
        if (s * pps >= minPixelsBetweenLabels) return s;
    }
    return 60;
}

export function drawTracks(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    rc: TimelineRenderContext,
): void {
    const tracks = rc.state.tracks;
    let y = RULER_HEIGHT;

    for (let i = 0; i < tracks.length; i++) {
        if (y > height) break;
        const track = tracks[i];

        const bg = track.index === rc.state.selectedTrackIndex
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

        drawTrackContent(ctx, track, y, width, rc);
        y += TRACK_HEIGHT;

        if (track.expanded && track.channelCount > 0) {
            const assetTrack = rc.assetData?.tracks[track.index];
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
                    drawKeyframes(ctx, channel.keyframes, y, track.index, c, rc);
                }
                y += TRACK_HEIGHT;
            }
        }
    }
}

function drawTrackContent(
    ctx: CanvasRenderingContext2D,
    track: { type: string; index: number },
    y: number,
    width: number,
    rc: TimelineRenderContext,
): void {
    if (!rc.assetData) return;
    const assetTrack = rc.assetData.tracks[track.index];
    if (!assetTrack) return;

    switch (assetTrack.type) {
        case 'property':
            if (!track.type) break;
            for (let c = 0; c < (assetTrack.channels ?? []).length; c++) {
                drawKeyframes(ctx, assetTrack.channels![c].keyframes, y, track.index, c, rc);
            }
            break;

        case 'spine':
            drawSpineClips(ctx, assetTrack.clips ?? [], y, width, rc);
            break;

        case 'spriteAnim':
            if (assetTrack.startTime != null) {
                drawSpriteAnimClip(ctx, assetTrack.startTime, assetTrack.clip ?? '', y, width, rc);
            }
            break;

        case 'audio':
            drawAudioEvents(ctx, assetTrack.events ?? [], y, rc);
            break;

        case 'activation':
            drawActivationRanges(ctx, assetTrack.ranges ?? [], y, width, rc);
            break;

        case 'marker':
            drawMarkers(ctx, assetTrack.markers ?? [], y, track.index, rc);
            break;

        case 'customEvent':
            drawCustomEvents(ctx, (assetTrack.events ?? []) as TimelineCustomEvent[], y, track.index, rc);
            break;

        case 'animFrames':
            drawAnimFrames(ctx, assetTrack.animFrames ?? [], y, width, track.index, rc);
            break;
    }
}

function drawCustomEvents(
    ctx: CanvasRenderingContext2D,
    events: TimelineCustomEvent[],
    y: number,
    trackIndex: number,
    rc: TimelineRenderContext,
): void {
    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const x = rc.state.timeToX(event.time);
        const selected = rc.isNpItemSelected('customEvent', trackIndex, i);

        ctx.fillStyle = selected ? KEYFRAME_SELECTED : CUSTOM_EVENT_COLOR;
        ctx.fillRect(x - 1, y + 2, 3, TRACK_HEIGHT - 4);

        ctx.beginPath();
        ctx.arc(x, y + 6, 4, 0, Math.PI * 2);
        ctx.fill();

        if (selected) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(x, y + 6, 5.5, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.fillStyle = selected ? '#ffffff' : '#cccccc';
        ctx.font = '9px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(event.name, x + 6, y + TRACK_HEIGHT / 2 + 3);
    }
}

function drawMarkers(
    ctx: CanvasRenderingContext2D,
    markers: { time: number; name: string }[],
    y: number,
    trackIndex: number,
    rc: TimelineRenderContext,
): void {
    for (let i = 0; i < markers.length; i++) {
        const marker = markers[i];
        const x = rc.state.timeToX(marker.time);
        const selected = rc.isNpItemSelected('marker', trackIndex, i);

        ctx.fillStyle = selected ? KEYFRAME_SELECTED : MARKER_COLOR;
        ctx.fillRect(x - 1, y + 2, 3, TRACK_HEIGHT - 4);

        ctx.beginPath();
        ctx.moveTo(x - 5, y + 2);
        ctx.lineTo(x + 5, y + 2);
        ctx.lineTo(x, y + 8);
        ctx.closePath();
        ctx.fill();

        if (selected) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x - 6.5, y + 1);
            ctx.lineTo(x + 6.5, y + 1);
            ctx.lineTo(x, y + 9.5);
            ctx.closePath();
            ctx.stroke();
        }

        ctx.fillStyle = selected ? '#ffffff' : '#cccccc';
        ctx.font = '9px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(marker.name, x + 6, y + TRACK_HEIGHT / 2 + 3);
    }
}

function drawAnimFrames(
    ctx: CanvasRenderingContext2D,
    frames: AnimFrameData[],
    y: number,
    width: number,
    trackIndex: number,
    rc: TimelineRenderContext,
): void {
    if (frames.length === 0) return;
    const fps = rc.state.animClipFps;
    const defaultDur = 1 / fps;
    let time = 0;

    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        const dur = frame.duration ?? defaultDur;
        const x1 = rc.state.timeToX(time);
        const x2 = rc.state.timeToX(time + dur);
        const fw = x2 - x1;

        if (x2 >= 0 && x1 <= width) {
            const color = ANIM_FRAME_COLORS[i % ANIM_FRAME_COLORS.length];
            const selected = rc.isNpItemSelected('animFrames', trackIndex, i);

            ctx.fillStyle = selected ? color : color + '60';
            ctx.fillRect(x1, y + 1, fw, TRACK_HEIGHT - 2);

            ctx.strokeStyle = selected ? '#ffffff' : ANIM_FRAME_BORDER;
            ctx.lineWidth = 1;
            ctx.strokeRect(x1 + 0.5, y + 1.5, fw - 1, TRACK_HEIGHT - 3);

            if (frame.thumbnailUrl && fw > 20) {
                let cache = rc.frameImageCache;
                let img = cache?.get(frame.thumbnailUrl);
                if (!img) {
                    img = new Image();
                    img.src = frame.thumbnailUrl;
                    if (!cache) {
                        cache = new Map();
                        rc.setFrameImageCache(cache);
                    }
                    cache.set(frame.thumbnailUrl, img);
                    img.onload = () => rc.requestRedraw();
                }
                if (img.complete && img.naturalWidth > 0) {
                    const imgH = TRACK_HEIGHT - 4;
                    const imgW = Math.min(imgH, fw - 2);
                    ctx.drawImage(img, x1 + 1, y + 2, imgW, imgH);
                }
            }

            if (fw > 30) {
                ctx.fillStyle = selected ? '#ffffff' : '#cccccc';
                ctx.font = '9px monospace';
                ctx.textAlign = 'left';
                const label = String(i).padStart(2, '0');
                const textX = frame.thumbnailUrl && fw > 20 ? x1 + TRACK_HEIGHT - 2 : x1 + 4;
                ctx.fillText(label, textX, y + TRACK_HEIGHT / 2 + 3);

                const durMs = Math.round(dur * 1000);
                const durLabel = durMs + 'ms';
                ctx.fillStyle = selected ? 'rgba(255,255,255,0.6)' : 'rgba(200,200,200,0.5)';
                ctx.textAlign = 'right';
                ctx.fillText(durLabel, x2 - 4, y + TRACK_HEIGHT / 2 + 3);
                ctx.textAlign = 'left';
            }

            if (fw > 4) {
                ctx.fillStyle = selected ? 'rgba(255,255,255,0.4)' : 'rgba(200,200,200,0.25)';
                ctx.fillRect(x2 - 3, y + 3, 2, TRACK_HEIGHT - 6);
            }
        }
        time += dur;
    }
}

function drawKeyframes(
    ctx: CanvasRenderingContext2D,
    keyframes: { time: number }[],
    y: number,
    trackIndex: number,
    channelIndex: number,
    rc: TimelineRenderContext,
): void {
    const cy = y + TRACK_HEIGHT / 2;
    const half = KEYFRAME_SIZE / 2;

    for (let ki = 0; ki < keyframes.length; ki++) {
        const kf = keyframes[ki];
        const x = rc.state.timeToX(kf.time);
        if (x < -KEYFRAME_SIZE || x > rc.canvasWidth + KEYFRAME_SIZE) continue;

        const isSelected = rc.isKeyframeSelected(trackIndex, channelIndex, ki);

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

function drawSpineClips(
    ctx: CanvasRenderingContext2D,
    clips: { start: number; duration: number; animation: string }[],
    y: number,
    _width: number,
    rc: TimelineRenderContext,
): void {
    const clipY = y + 3;
    const clipH = TRACK_HEIGHT - 6;

    for (const clip of clips) {
        const x1 = rc.state.timeToX(clip.start);
        const x2 = rc.state.timeToX(clip.start + clip.duration);
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

function drawSpriteAnimClip(
    ctx: CanvasRenderingContext2D,
    startTime: number,
    clipName: string,
    y: number,
    width: number,
    rc: TimelineRenderContext,
): void {
    const x1 = rc.state.timeToX(startTime);
    const x2 = Math.min(rc.state.timeToX(rc.state.duration), width);
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
        const resolvedPath = isUUID(clipName)
            ? (getAssetLibrary().getPath(clipName) ?? clipName)
            : clipName;
        const displayName = resolvedPath.includes('/')
            ? resolvedPath.slice(resolvedPath.lastIndexOf('/') + 1)
            : resolvedPath;
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
        ctx.fillText(displayName, textX, clipY + clipH / 2 + 3);
        ctx.restore();
    }
}

function drawAudioEvents(
    ctx: CanvasRenderingContext2D,
    events: { time: number; clip?: string }[],
    y: number,
    rc: TimelineRenderContext,
): void {
    for (const event of events) {
        const x = rc.state.timeToX(event.time);
        ctx.fillStyle = AUDIO_EVENT_COLOR;
        ctx.fillRect(x - 1, y + 2, 3, TRACK_HEIGHT - 4);

        ctx.beginPath();
        ctx.moveTo(x - 4, y + 2);
        ctx.lineTo(x + 4, y + 2);
        ctx.lineTo(x, y + 8);
        ctx.closePath();
        ctx.fill();

        if (event.clip) {
            const clipPath = isUUID(event.clip)
                ? (getAssetLibrary().getPath(event.clip) ?? event.clip)
                : event.clip;
            const label = clipPath.includes('/')
                ? clipPath.slice(clipPath.lastIndexOf('/') + 1)
                : clipPath;
            ctx.fillStyle = '#aaaaaa';
            ctx.font = '9px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(label, x + 6, y + TRACK_HEIGHT / 2 + 3);
        }
    }
}

function drawActivationRanges(
    ctx: CanvasRenderingContext2D,
    ranges: { start: number; end: number }[],
    y: number,
    _width: number,
    rc: TimelineRenderContext,
): void {
    const rangeY = y + 4;
    const rangeH = TRACK_HEIGHT - 8;

    for (const range of ranges) {
        const x1 = rc.state.timeToX(range.start);
        const x2 = rc.state.timeToX(range.end);
        const w = x2 - x1;
        if (w < 1) continue;

        ctx.fillStyle = ACTIVATION_COLOR;
        ctx.fillRect(x1, rangeY, w, rangeH);
        ctx.strokeStyle = ACTIVATION_BORDER;
        ctx.lineWidth = 1;
        ctx.strokeRect(x1 + 0.5, rangeY + 0.5, w - 1, rangeH - 1);
    }
}

export function drawPlayhead(ctx: CanvasRenderingContext2D, canvasWidth: number, height: number, rc: TimelineRenderContext): void {
    const x = rc.state.timeToX(rc.state.playheadTime);
    if (x < -10 || x > canvasWidth + 10) return;

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

export function drawDurationEnd(ctx: CanvasRenderingContext2D, width: number, height: number, rc: TimelineRenderContext): void {
    const x = rc.state.timeToX(rc.state.duration);
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

export function drawRubberBand(
    ctx: CanvasRenderingContext2D,
    rubberBand: { startX: number; startY: number; endX: number; endY: number } | null,
): void {
    if (!rubberBand) return;
    const rb = rubberBand;
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
