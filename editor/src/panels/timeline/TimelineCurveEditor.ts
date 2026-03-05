import type { TimelineState } from './TimelineState';
import type { TimelineAssetData } from './TimelineKeyframeArea';

const CURVE_BG = '#1a1a1a';
const CURVE_GRID = '#2a2a2a';
const CURVE_LINE = '#61afef';
const CURVE_KF_COLOR = '#e5c07b';
const CURVE_KF_SELECTED = '#61afef';
const CURVE_TANGENT_LINE = '#555555';
const CURVE_TANGENT_HANDLE = '#e06c75';
const CURVE_HEIGHT = 150;
const PADDING = 20;
const KF_RADIUS = 4;
const HANDLE_RADIUS = 3;
const TANGENT_LENGTH_PX = 40;

interface CurveKeyframe {
    time: number;
    value: number;
    inTangent?: number;
    outTangent?: number;
}

interface TangentHit {
    keyframeIndex: number;
    handle: 'in' | 'out';
}

export class TimelineCurveEditor {
    private container_: HTMLElement;
    private canvas_: HTMLCanvasElement;
    private ctx_: CanvasRenderingContext2D;
    private state_: TimelineState;
    private visible_ = false;
    private trackIndex_ = -1;
    private channelIndex_ = -1;
    private assetData_: TimelineAssetData | null = null;
    private unsub_: (() => void) | null = null;
    private resizeObserver_: ResizeObserver | null = null;
    private selectedKfIndex_ = -1;
    private valueMin_ = 0;
    private valueMax_ = 1;

    constructor(container: HTMLElement, state: TimelineState) {
        this.container_ = container;
        this.state_ = state;

        this.container_.style.display = 'none';
        this.container_.innerHTML = `
            <div class="es-timeline-curve-header">
                <span class="es-timeline-curve-title">Curve Editor</span>
            </div>
            <div class="es-timeline-curve-canvas-wrap"></div>
        `;

        const canvasWrap = this.container_.querySelector('.es-timeline-curve-canvas-wrap') as HTMLElement;
        this.canvas_ = document.createElement('canvas');
        this.canvas_.className = 'es-timeline-canvas';
        canvasWrap.appendChild(this.canvas_);
        this.ctx_ = this.canvas_.getContext('2d')!;

        this.resizeObserver_ = new ResizeObserver(() => this.resizeCanvas());
        this.resizeObserver_.observe(canvasWrap);

        this.unsub_ = state.onChange(() => {
            if (this.visible_) this.draw();
        });

        this.canvas_.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.canvas_.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    }

    dispose(): void {
        this.unsub_?.();
        this.resizeObserver_?.disconnect();
    }

    setAssetData(data: TimelineAssetData | null): void {
        this.assetData_ = data;
        if (this.visible_) this.draw();
    }

    showChannel(trackIndex: number, channelIndex: number): void {
        this.trackIndex_ = trackIndex;
        this.channelIndex_ = channelIndex;
        this.selectedKfIndex_ = -1;
        this.visible_ = true;
        this.container_.style.display = '';
        this.computeValueRange();
        this.resizeCanvas();
    }

    hide(): void {
        this.visible_ = false;
        this.container_.style.display = 'none';
    }

    get isVisible(): boolean {
        return this.visible_;
    }

    private getKeyframes(): CurveKeyframe[] {
        if (!this.assetData_) return [];
        const track = this.assetData_.tracks[this.trackIndex_];
        if (!track || track.type !== 'property') return [];
        const channel = track.channels?.[this.channelIndex_];
        return channel?.keyframes ?? [];
    }

    private computeValueRange(): void {
        const kfs = this.getKeyframes();
        if (kfs.length === 0) {
            this.valueMin_ = 0;
            this.valueMax_ = 1;
            return;
        }

        let min = Infinity;
        let max = -Infinity;
        for (const kf of kfs) {
            if (kf.value < min) min = kf.value;
            if (kf.value > max) max = kf.value;
        }

        const padding = Math.max(0.1, (max - min) * 0.2);
        this.valueMin_ = min - padding;
        this.valueMax_ = max + padding;
        if (this.valueMax_ === this.valueMin_) {
            this.valueMin_ -= 0.5;
            this.valueMax_ += 0.5;
        }
    }

    private resizeCanvas(): void {
        const parent = this.canvas_.parentElement;
        if (!parent) return;
        const rect = parent.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.canvas_.width = rect.width * dpr;
        this.canvas_.height = rect.height * dpr;
        this.canvas_.style.width = `${rect.width}px`;
        this.canvas_.style.height = `${rect.height}px`;
        this.ctx_.scale(dpr, dpr);
        this.draw();
    }

    private timeToX(time: number): number {
        return this.state_.timeToX(time);
    }

    private valueToY(value: number): number {
        const h = this.canvas_.clientHeight;
        const range = this.valueMax_ - this.valueMin_;
        return PADDING + (h - 2 * PADDING) * (1 - (value - this.valueMin_) / range);
    }

    private yToValue(y: number): number {
        const h = this.canvas_.clientHeight;
        const range = this.valueMax_ - this.valueMin_;
        return this.valueMin_ + (1 - (y - PADDING) / (h - 2 * PADDING)) * range;
    }

    draw(): void {
        const ctx = this.ctx_;
        const w = this.canvas_.clientWidth;
        const h = this.canvas_.clientHeight;
        const dpr = window.devicePixelRatio || 1;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = CURVE_BG;
        ctx.fillRect(0, 0, w, h);

        this.drawGrid(ctx, w, h);
        this.drawCurve(ctx, w);
        this.drawKeyframePoints(ctx);
    }

    private drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number): void {
        ctx.strokeStyle = CURVE_GRID;
        ctx.lineWidth = 1;

        const pps = this.state_.pixelsPerSecond;
        const step = this.calculateGridStep(pps);
        const startTime = this.state_.scrollX / pps;
        const endTime = startTime + w / pps;
        const firstTick = Math.floor(startTime / step) * step;

        for (let t = firstTick; t <= endTime; t += step) {
            const x = this.timeToX(t);
            ctx.beginPath();
            ctx.moveTo(Math.round(x) + 0.5, 0);
            ctx.lineTo(Math.round(x) + 0.5, h);
            ctx.stroke();
        }

        const valueRange = this.valueMax_ - this.valueMin_;
        const valueStep = this.calculateValueStep(valueRange, h);
        const firstValue = Math.floor(this.valueMin_ / valueStep) * valueStep;

        ctx.font = '9px monospace';
        ctx.fillStyle = '#666666';
        ctx.textAlign = 'right';

        for (let v = firstValue; v <= this.valueMax_; v += valueStep) {
            const y = this.valueToY(v);
            ctx.beginPath();
            ctx.moveTo(0, Math.round(y) + 0.5);
            ctx.lineTo(w, Math.round(y) + 0.5);
            ctx.stroke();

            ctx.fillText(v.toFixed(1), w - 4, y - 2);
        }
    }

    private calculateGridStep(pps: number): number {
        const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60];
        for (const s of steps) {
            if (s * pps >= 60) return s;
        }
        return 60;
    }

    private calculateValueStep(range: number, height: number): number {
        const minPixels = 40;
        const pixelsPerUnit = (height - 2 * PADDING) / range;
        const steps = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 50, 100];
        for (const s of steps) {
            if (s * pixelsPerUnit >= minPixels) return s;
        }
        return 100;
    }

    private drawCurve(ctx: CanvasRenderingContext2D, width: number): void {
        const kfs = this.getKeyframes();
        if (kfs.length < 2) return;

        ctx.strokeStyle = CURVE_LINE;
        ctx.lineWidth = 1.5;
        ctx.beginPath();

        let started = false;
        for (let px = 0; px < width; px += 2) {
            const time = this.state_.xToTime(px);
            const value = this.evaluateAtTime(kfs, time);
            if (value === null) continue;

            const y = this.valueToY(value);
            if (!started) {
                ctx.moveTo(px, y);
                started = true;
            } else {
                ctx.lineTo(px, y);
            }
        }

        ctx.stroke();
    }

    private evaluateAtTime(kfs: CurveKeyframe[], time: number): number | null {
        if (kfs.length === 0) return null;
        if (time <= kfs[0].time) return kfs[0].value;
        if (time >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].value;

        for (let i = 0; i < kfs.length - 1; i++) {
            if (time >= kfs[i].time && time <= kfs[i + 1].time) {
                const k0 = kfs[i];
                const k1 = kfs[i + 1];
                const dt = k1.time - k0.time;
                if (dt <= 0) return k0.value;

                const t = (time - k0.time) / dt;
                const m0 = (k0.outTangent ?? 0) * dt;
                const m1 = (k1.inTangent ?? 0) * dt;

                const t2 = t * t;
                const t3 = t2 * t;
                return (2 * t3 - 3 * t2 + 1) * k0.value
                    + (t3 - 2 * t2 + t) * m0
                    + (-2 * t3 + 3 * t2) * k1.value
                    + (t3 - t2) * m1;
            }
        }

        return null;
    }

    private drawKeyframePoints(ctx: CanvasRenderingContext2D): void {
        const kfs = this.getKeyframes();

        for (let i = 0; i < kfs.length; i++) {
            const kf = kfs[i];
            const x = this.timeToX(kf.time);
            const y = this.valueToY(kf.value);

            if (i === this.selectedKfIndex_) {
                this.drawTangentHandles(ctx, kf, x, y);
            }

            ctx.fillStyle = i === this.selectedKfIndex_ ? CURVE_KF_SELECTED : CURVE_KF_COLOR;
            ctx.beginPath();
            ctx.arc(x, y, KF_RADIUS, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    private drawTangentHandles(ctx: CanvasRenderingContext2D, kf: CurveKeyframe, x: number, y: number): void {
        const inTan = kf.inTangent ?? 0;
        const outTan = kf.outTangent ?? 0;

        const inAngle = Math.atan(-inTan);
        const inX = x - TANGENT_LENGTH_PX * Math.cos(inAngle);
        const inY = y + TANGENT_LENGTH_PX * Math.sin(inAngle);

        ctx.strokeStyle = CURVE_TANGENT_LINE;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(inX, inY);
        ctx.stroke();

        ctx.fillStyle = CURVE_TANGENT_HANDLE;
        ctx.beginPath();
        ctx.arc(inX, inY, HANDLE_RADIUS, 0, Math.PI * 2);
        ctx.fill();

        const outAngle = Math.atan(-outTan);
        const outX = x + TANGENT_LENGTH_PX * Math.cos(outAngle);
        const outY = y - TANGENT_LENGTH_PX * Math.sin(outAngle);

        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(outX, outY);
        ctx.stroke();

        ctx.fillStyle = CURVE_TANGENT_HANDLE;
        ctx.beginPath();
        ctx.arc(outX, outY, HANDLE_RADIUS, 0, Math.PI * 2);
        ctx.fill();
    }

    private hitTestTangent(x: number, y: number): TangentHit | null {
        const kfs = this.getKeyframes();
        if (this.selectedKfIndex_ < 0 || this.selectedKfIndex_ >= kfs.length) return null;

        const kf = kfs[this.selectedKfIndex_];
        const kx = this.timeToX(kf.time);
        const ky = this.valueToY(kf.value);

        const inTan = kf.inTangent ?? 0;
        const inAngle = Math.atan(-inTan);
        const inX = kx - TANGENT_LENGTH_PX * Math.cos(inAngle);
        const inY = ky + TANGENT_LENGTH_PX * Math.sin(inAngle);

        if (Math.hypot(x - inX, y - inY) <= HANDLE_RADIUS + 3) {
            return { keyframeIndex: this.selectedKfIndex_, handle: 'in' };
        }

        const outTan = kf.outTangent ?? 0;
        const outAngle = Math.atan(-outTan);
        const outX = kx + TANGENT_LENGTH_PX * Math.cos(outAngle);
        const outY = ky - TANGENT_LENGTH_PX * Math.sin(outAngle);

        if (Math.hypot(x - outX, y - outY) <= HANDLE_RADIUS + 3) {
            return { keyframeIndex: this.selectedKfIndex_, handle: 'out' };
        }

        return null;
    }

    private hitTestKeyframe(x: number, y: number): number {
        const kfs = this.getKeyframes();
        for (let i = 0; i < kfs.length; i++) {
            const kx = this.timeToX(kfs[i].time);
            const ky = this.valueToY(kfs[i].value);
            if (Math.hypot(x - kx, y - ky) <= KF_RADIUS + 3) return i;
        }
        return -1;
    }

    private onMouseDown(e: MouseEvent): void {
        const rect = this.canvas_.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const tangentHit = this.hitTestTangent(x, y);
        if (tangentHit) {
            this.startTangentDrag(e, rect, tangentHit);
            return;
        }

        const kfIdx = this.hitTestKeyframe(x, y);
        if (kfIdx >= 0) {
            this.selectedKfIndex_ = kfIdx;
            this.draw();
            return;
        }

        this.selectedKfIndex_ = -1;
        this.draw();
    }

    private onContextMenu(e: MouseEvent): void {
        e.preventDefault();
        const rect = this.canvas_.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const kfIdx = this.hitTestKeyframe(x, y);
        if (kfIdx < 0) return;

        this.selectedKfIndex_ = kfIdx;
        this.draw();

        const kfs = this.getKeyframes();
        const kf = kfs[kfIdx];
        if (!kf) return;

        const menu = document.createElement('div');
        menu.className = 'es-timeline-dropdown';
        menu.style.position = 'fixed';
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;

        const modes: { label: string; inT: number; outT: number }[] = [
            { label: 'Smooth (Flat)', inT: 0, outT: 0 },
            { label: 'Linear', inT: this.calcLinearTangent(kfs, kfIdx, 'in'), outT: this.calcLinearTangent(kfs, kfIdx, 'out') },
            { label: 'Constant (Step)', inT: Infinity, outT: Infinity },
        ];

        for (const mode of modes) {
            const item = document.createElement('div');
            item.className = 'es-timeline-dropdown-item';
            item.textContent = mode.label;
            item.addEventListener('click', () => {
                menu.remove();
                if (mode.inT === Infinity) {
                    (kf as any).inTangent = 0;
                    (kf as any).outTangent = 1e6;
                } else {
                    (kf as any).inTangent = mode.inT;
                    (kf as any).outTangent = mode.outT;
                }
                this.draw();
            });
            menu.appendChild(item);
        }

        document.body.appendChild(menu);
        const dismiss = (ev: MouseEvent) => {
            if (!menu.contains(ev.target as Node)) {
                menu.remove();
                document.removeEventListener('mousedown', dismiss, true);
            }
        };
        setTimeout(() => document.addEventListener('mousedown', dismiss, true), 0);
    }

    private calcLinearTangent(
        kfs: CurveKeyframe[], index: number, direction: 'in' | 'out',
    ): number {
        if (direction === 'in' && index > 0) {
            const prev = kfs[index - 1];
            const curr = kfs[index];
            const dt = curr.time - prev.time;
            return dt > 0 ? (curr.value - prev.value) / dt : 0;
        }
        if (direction === 'out' && index < kfs.length - 1) {
            const curr = kfs[index];
            const next = kfs[index + 1];
            const dt = next.time - curr.time;
            return dt > 0 ? (next.value - curr.value) / dt : 0;
        }
        return 0;
    }

    private startTangentDrag(_e: MouseEvent, rect: DOMRect, hit: TangentHit): void {
        const kfs = this.getKeyframes();
        const kf = kfs[hit.keyframeIndex];
        if (!kf) return;

        const kx = this.timeToX(kf.time);
        const ky = this.valueToY(kf.value);

        const onMove = (ev: MouseEvent) => {
            const mx = ev.clientX - rect.left;
            const my = ev.clientY - rect.top;
            const dx = mx - kx;
            const dy = my - ky;

            if (Math.abs(dx) < 1) return;
            const slope = -dy / dx;

            if (hit.handle === 'in') {
                (kf as any).inTangent = slope;
            } else {
                (kf as any).outTangent = slope;
            }
            this.draw();
        };

        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }
}
