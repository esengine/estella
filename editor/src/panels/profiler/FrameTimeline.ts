import type { FrameSnapshot } from 'esengine';

const BUDGET_60FPS_MS = 16.67;
const BAR_WIDTH = 2;
const BAR_GAP = 1;
const PADDING_TOP = 20;
const PADDING_BOTTOM = 16;
const PADDING_LEFT = 36;
const PADDING_RIGHT = 8;

const COLOR_NORMAL = '#4ec9b0';
const COLOR_OVER_BUDGET = '#e06c75';
const COLOR_BUDGET_LINE = 'rgba(209, 154, 102, 0.7)';
const COLOR_GRID = 'rgba(60, 60, 60, 0.6)';
const COLOR_TEXT = '#8c8c8c';
const COLOR_SELECTED_BORDER = '#61afef';
const COLOR_HOVER_BORDER = 'rgba(97, 175, 239, 0.5)';

export type FrameSelectCallback = (index: number) => void;

export class FrameTimeline {
    private canvas_: HTMLCanvasElement;
    private ctx_: CanvasRenderingContext2D;
    private tooltip_: HTMLElement;
    private onFrameSelect_: FrameSelectCallback | null = null;
    private lastSnapshots_: FrameSnapshot[] = [];
    private lastVisibleStart_ = 0;
    private selectedIndex_ = -1;
    private hoveredIndex_ = -1;

    constructor(container: HTMLElement) {
        this.canvas_ = document.createElement('canvas');
        this.canvas_.className = 'es-profiler-timeline-canvas';
        this.canvas_.style.cssText = 'width:100%;height:100%;display:block;';
        container.appendChild(this.canvas_);
        this.ctx_ = this.canvas_.getContext('2d')!;

        this.tooltip_ = document.createElement('div');
        this.tooltip_.className = 'es-profiler-tooltip';
        container.appendChild(this.tooltip_);

        this.canvas_.addEventListener('click', this.onClick_);
        this.canvas_.addEventListener('mousemove', this.onMouseMove_);
        this.canvas_.addEventListener('mouseleave', this.onMouseLeave_);
    }

    set onFrameSelect(cb: FrameSelectCallback | null) {
        this.onFrameSelect_ = cb;
    }

    set selectedIndex(idx: number) {
        this.selectedIndex_ = idx;
    }

    render(snapshots: FrameSnapshot[]): void {
        this.lastSnapshots_ = snapshots;

        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas_.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        this.canvas_.width = w * dpr;
        this.canvas_.height = h * dpr;

        const ctx = this.ctx_;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        if (snapshots.length === 0) {
            ctx.fillStyle = COLOR_TEXT;
            ctx.font = '11px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('No frame data', w / 2, h / 2);
            this.lastVisibleStart_ = 0;
            return;
        }

        const plotW = w - PADDING_LEFT - PADDING_RIGHT;
        const plotH = h - PADDING_TOP - PADDING_BOTTOM;
        const maxBars = Math.floor(plotW / (BAR_WIDTH + BAR_GAP));
        const visibleStart = snapshots.length > maxBars ? snapshots.length - maxBars : 0;
        const visibleSnapshots = snapshots.slice(visibleStart);
        this.lastVisibleStart_ = visibleStart;

        let maxMs = BUDGET_60FPS_MS * 2;
        for (const snap of visibleSnapshots) {
            if (snap.frameTimeMs > maxMs) maxMs = snap.frameTimeMs;
        }
        maxMs = Math.ceil(maxMs / 5) * 5;

        this.drawGrid(ctx, plotW, plotH, maxMs, w, h);

        for (let i = 0; i < visibleSnapshots.length; i++) {
            const absIndex = visibleStart + i;
            const ms = visibleSnapshots[i].frameTimeMs;
            const barH = Math.max(1, (ms / maxMs) * plotH);
            const x = PADDING_LEFT + i * (BAR_WIDTH + BAR_GAP);
            const y = PADDING_TOP + plotH - barH;

            ctx.fillStyle = ms > BUDGET_60FPS_MS ? COLOR_OVER_BUDGET : COLOR_NORMAL;
            ctx.fillRect(x, y, BAR_WIDTH, barH);

            if (absIndex === this.selectedIndex_) {
                ctx.strokeStyle = COLOR_SELECTED_BORDER;
                ctx.lineWidth = 1.5;
                ctx.strokeRect(x - 1, y - 1, BAR_WIDTH + 2, barH + 2);
            } else if (absIndex === this.hoveredIndex_) {
                ctx.strokeStyle = COLOR_HOVER_BORDER;
                ctx.lineWidth = 1;
                ctx.strokeRect(x - 1, y - 1, BAR_WIDTH + 2, barH + 2);
            }
        }
    }

    private drawGrid(
        ctx: CanvasRenderingContext2D,
        plotW: number,
        plotH: number,
        maxMs: number,
        w: number,
        _h: number,
    ): void {
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';

        const gridLines = [0, BUDGET_60FPS_MS, maxMs / 2, maxMs];
        for (const ms of gridLines) {
            const y = PADDING_TOP + plotH - (ms / maxMs) * plotH;
            ctx.strokeStyle = ms === BUDGET_60FPS_MS ? COLOR_BUDGET_LINE : COLOR_GRID;
            ctx.lineWidth = ms === BUDGET_60FPS_MS ? 1.5 : 0.5;
            ctx.setLineDash(ms === BUDGET_60FPS_MS ? [4, 2] : []);
            ctx.beginPath();
            ctx.moveTo(PADDING_LEFT, y);
            ctx.lineTo(PADDING_LEFT + plotW, y);
            ctx.stroke();

            ctx.fillStyle = ms === BUDGET_60FPS_MS ? COLOR_BUDGET_LINE : COLOR_TEXT;
            ctx.fillText(`${ms.toFixed(0)}ms`, PADDING_LEFT - 4, y);
        }
        ctx.setLineDash([]);

        ctx.fillStyle = COLOR_TEXT;
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Frame Timeline', w / 2, 12);
    }

    private hitTest_(clientX: number, clientY: number): number {
        const rect = this.canvas_.getBoundingClientRect();
        const x = clientX - rect.left;
        const _y = clientY - rect.top;

        const barStep = BAR_WIDTH + BAR_GAP;
        const localX = x - PADDING_LEFT;
        if (localX < 0) return -1;

        const barIndex = Math.floor(localX / barStep);
        const absIndex = this.lastVisibleStart_ + barIndex;
        if (absIndex >= this.lastSnapshots_.length) return -1;

        return absIndex;
    }

    private onClick_ = (e: MouseEvent): void => {
        const idx = this.hitTest_(e.clientX, e.clientY);
        if (idx >= 0 && this.onFrameSelect_) {
            this.onFrameSelect_(idx);
        }
    };

    private onMouseMove_ = (e: MouseEvent): void => {
        const idx = this.hitTest_(e.clientX, e.clientY);
        if (idx === this.hoveredIndex_) return;
        this.hoveredIndex_ = idx;

        if (idx >= 0) {
            const snap = this.lastSnapshots_[idx];
            this.tooltip_.textContent = `Frame #${idx}  ${snap.frameTimeMs.toFixed(2)}ms`;
            this.tooltip_.style.display = 'block';

            const rect = this.canvas_.getBoundingClientRect();
            const localX = e.clientX - rect.left;
            const localY = e.clientY - rect.top;
            this.tooltip_.style.left = `${localX + 12}px`;
            this.tooltip_.style.top = `${localY - 8}px`;
        } else {
            this.tooltip_.style.display = 'none';
        }

        this.render(this.lastSnapshots_);
    };

    private onMouseLeave_ = (): void => {
        this.hoveredIndex_ = -1;
        this.tooltip_.style.display = 'none';
        this.render(this.lastSnapshots_);
    };

    dispose(): void {
        this.canvas_.removeEventListener('click', this.onClick_);
        this.canvas_.removeEventListener('mousemove', this.onMouseMove_);
        this.canvas_.removeEventListener('mouseleave', this.onMouseLeave_);
        this.canvas_.remove();
        this.tooltip_.remove();
    }
}
