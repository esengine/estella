import type { FrameStats } from './stats';

export type StatsPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

const TOP_SYSTEMS_COUNT = 5;
const OVERLAY_UPDATE_INTERVAL_MS = 500;
const SYSTEM_NAME_MAX_LENGTH = 20;
const SYSTEM_NAME_PAD_WIDTH = 22;

const PANEL_STYLES = `
position: fixed;
z-index: 99999;
pointer-events: none;
background: rgba(30, 30, 30, 0.85);
border: 1px solid rgba(60, 60, 60, 0.8);
border-radius: 4px;
padding: 6px 10px;
font: 11px monospace;
color: #cccccc;
line-height: 1.6;
min-width: 220px;
white-space: pre;
`;

function positionStyle(position: StatsPosition): string {
    switch (position) {
        case 'top-left': return 'top: 12px; left: 12px;';
        case 'top-right': return 'top: 12px; right: 12px;';
        case 'bottom-left': return 'bottom: 12px; left: 12px;';
        case 'bottom-right': return 'bottom: 12px; right: 12px;';
    }
}

function formatNumber(n: number, decimals: number): string {
    return n.toFixed(decimals);
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface SystemAccumulator {
    sum: number;
    max: number;
    count: number;
}

export class StatsOverlay {
    private el_: HTMLDivElement;
    private visible_ = true;
    private disposed_ = false;
    private lastUpdateTime_ = 0;
    private lastStats_: FrameStats | null = null;
    private accumulatedTimings_ = new Map<string, SystemAccumulator>();

    constructor(container: HTMLElement, position: StatsPosition = 'bottom-left') {
        this.el_ = document.createElement('div');
        this.el_.style.cssText = PANEL_STYLES + positionStyle(position);
        container.appendChild(this.el_);
    }

    update(stats: FrameStats): void {
        if (!this.visible_ || this.disposed_) return;

        this.lastStats_ = stats;
        this.accumulateTimings_(stats.systemTimings);

        const now = performance.now();
        if (this.lastUpdateTime_ > 0 && now - this.lastUpdateTime_ < OVERLAY_UPDATE_INTERVAL_MS) return;
        this.lastUpdateTime_ = now;

        this.render_();
    }

    show(): void {
        this.visible_ = true;
        this.lastUpdateTime_ = 0;
        this.el_.style.display = '';
    }

    hide(): void {
        this.visible_ = false;
        this.el_.style.display = 'none';
    }

    dispose(): void {
        this.disposed_ = true;
        this.el_.parentElement?.removeChild(this.el_);
    }

    private accumulateTimings_(timings: Map<string, number>): void {
        for (const [name, ms] of timings) {
            const acc = this.accumulatedTimings_.get(name);
            if (acc) {
                acc.sum += ms;
                acc.count++;
                if (ms > acc.max) acc.max = ms;
            } else {
                this.accumulatedTimings_.set(name, { sum: ms, max: ms, count: 1 });
            }
        }
    }

    private render_(): void {
        const stats = this.lastStats_;
        if (!stats) return;

        const sections: string[] = [];

        sections.push(
            '<div style="color:#8c8c8c;border-bottom:1px solid rgba(60,60,60,0.8);padding-bottom:3px;margin-bottom:3px">Performance</div>' +
            `<div>FPS: <span style="color:#d19a66">${formatNumber(stats.fps, 1)}</span>` +
            `    Frame: <span style="color:#d19a66">${formatNumber(stats.frameTimeMs, 1)}ms</span></div>`
        );

        sections.push(
            '<div style="color:#8c8c8c;border-bottom:1px solid rgba(60,60,60,0.8);padding-bottom:3px;margin-bottom:3px;margin-top:4px">Rendering</div>' +
            `<div>DC: <span style="color:#d19a66">${stats.drawCalls}</span>` +
            `    Tri: <span style="color:#d19a66">${stats.triangles}</span></div>` +
            `<div>Sprites: <span style="color:#d19a66">${stats.sprites}</span>` +
            `  Culled: <span style="color:#d19a66">${stats.culled}</span></div>`
        );

        sections.push(
            '<div style="color:#8c8c8c;border-bottom:1px solid rgba(60,60,60,0.8);padding-bottom:3px;margin-bottom:3px;margin-top:4px">World</div>' +
            `<div>Entities: <span style="color:#d19a66">${stats.entityCount}</span></div>`
        );

        if (this.accumulatedTimings_.size > 0) {
            const entries: [string, number, number][] = [];
            for (const [name, acc] of this.accumulatedTimings_) {
                const avg = acc.sum / acc.count;
                entries.push([name, avg, acc.max]);
            }
            entries.sort((a, b) => b[2] - a[2]);
            const top = entries.slice(0, TOP_SYSTEMS_COUNT);

            let systemsHtml = '<div style="color:#8c8c8c;border-bottom:1px solid rgba(60,60,60,0.8);padding-bottom:3px;margin-bottom:3px;margin-top:4px">Systems (top 5)</div>';
            for (const [name, avg, max] of top) {
                const truncated = name.length > SYSTEM_NAME_MAX_LENGTH ? name.slice(0, SYSTEM_NAME_MAX_LENGTH) + '...' : name;
                const displayName = escapeHtml(truncated);
                systemsHtml += `<div>${displayName.padEnd(SYSTEM_NAME_PAD_WIDTH)}<span style="color:#d19a66">${formatNumber(avg, 1)} / ${formatNumber(max, 1)}ms</span></div>`;
            }
            sections.push(systemsHtml);
        }

        this.el_.innerHTML = sections.join('');
        this.accumulatedTimings_.clear();
    }
}
