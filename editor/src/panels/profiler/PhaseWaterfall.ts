const PADDING_TOP = 20;
const PADDING_BOTTOM = 8;
const PADDING_LEFT = 8;
const PADDING_RIGHT = 8;
const BAR_HEIGHT = 18;
const BAR_GAP = 3;

const PHASE_COLORS: Record<string, string> = {
    First: '#61afef',
    FixedPreUpdate: '#56b6c2',
    FixedUpdate: '#56b6c2',
    FixedPostUpdate: '#56b6c2',
    PreUpdate: '#c678dd',
    Update: '#98c379',
    PostUpdate: '#d19a66',
    Last: '#e5c07b',
};

const PHASE_ORDER = [
    'First',
    'FixedPreUpdate', 'FixedUpdate', 'FixedPostUpdate',
    'PreUpdate', 'Update', 'PostUpdate',
    'Last',
];

const COLOR_TEXT = '#cccccc';
const COLOR_TEXT_DIM = '#8c8c8c';
const COLOR_DEFAULT_BAR = '#abb2bf';

export class PhaseWaterfall {
    private canvas_: HTMLCanvasElement;
    private ctx_: CanvasRenderingContext2D;

    constructor(container: HTMLElement) {
        this.canvas_ = document.createElement('canvas');
        this.canvas_.className = 'es-profiler-waterfall-canvas';
        this.canvas_.style.cssText = 'width:100%;height:100%;display:block;';
        container.appendChild(this.canvas_);
        this.ctx_ = this.canvas_.getContext('2d')!;
    }

    render(phaseTimings: Map<string, number>): void {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas_.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        this.canvas_.width = w * dpr;
        this.canvas_.height = h * dpr;

        const ctx = this.ctx_;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        ctx.fillStyle = COLOR_TEXT_DIM;
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Phase Breakdown', w / 2, 12);

        if (phaseTimings.size === 0) {
            ctx.fillStyle = COLOR_TEXT_DIM;
            ctx.textAlign = 'center';
            ctx.fillText('No phase data', w / 2, h / 2);
            return;
        }

        const phases = PHASE_ORDER.filter(p => phaseTimings.has(p));
        let maxMs = 0;
        for (const p of phases) {
            const v = phaseTimings.get(p)!;
            if (v > maxMs) maxMs = v;
        }
        if (maxMs <= 0) maxMs = 1;

        const labelWidth = 100;
        const barAreaLeft = PADDING_LEFT + labelWidth;
        const barAreaWidth = w - barAreaLeft - PADDING_RIGHT - 50;

        for (let i = 0; i < phases.length; i++) {
            const name = phases[i];
            const ms = phaseTimings.get(name)!;
            const y = PADDING_TOP + i * (BAR_HEIGHT + BAR_GAP);
            const barW = Math.max(1, (ms / maxMs) * barAreaWidth);

            ctx.fillStyle = COLOR_TEXT;
            ctx.font = '11px monospace';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(name, PADDING_LEFT + labelWidth - 8, y + BAR_HEIGHT / 2);

            ctx.fillStyle = PHASE_COLORS[name] ?? COLOR_DEFAULT_BAR;
            ctx.fillRect(barAreaLeft, y, barW, BAR_HEIGHT);

            ctx.fillStyle = COLOR_TEXT;
            ctx.font = '10px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(
                ms < 0.01 ? '<0.01ms' : `${ms.toFixed(2)}ms`,
                barAreaLeft + barW + 6,
                y + BAR_HEIGHT / 2,
            );
        }
    }

    dispose(): void {
        this.canvas_.remove();
    }
}
