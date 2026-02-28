import { escapeHtml } from '../../utils/html';

const MAX_HISTORY = 60;

const COLOR_BAR = '#4ec9b0';
const COLOR_BAR_HOT = '#e06c75';
const HOT_THRESHOLD_MS = 2.0;

interface SystemRecord {
    history: number[];
}

export class SystemTable {
    private container_: HTMLElement;
    private el_: HTMLElement;
    private records_ = new Map<string, SystemRecord>();

    constructor(container: HTMLElement) {
        this.container_ = container;
        this.el_ = document.createElement('div');
        this.el_.className = 'es-profiler-system-table';
        this.container_.appendChild(this.el_);
    }

    update(systemTimings: Map<string, number>): void {
        for (const [name, ms] of systemTimings) {
            let rec = this.records_.get(name);
            if (!rec) {
                rec = { history: [] };
                this.records_.set(name, rec);
            }
            rec.history.push(ms);
            if (rec.history.length > MAX_HISTORY) {
                rec.history.shift();
            }
        }

        const sorted = [...systemTimings.entries()].sort((a, b) => b[1] - a[1]);

        let maxMs = 0;
        for (const [, ms] of sorted) {
            if (ms > maxMs) maxMs = ms;
        }
        if (maxMs <= 0) maxMs = 1;

        let html = `<div class="es-profiler-table-header">
            <span class="es-profiler-col-name">System</span>
            <span class="es-profiler-col-time">Time</span>
            <span class="es-profiler-col-bar">%</span>
            <span class="es-profiler-col-avg">Avg</span>
            <span class="es-profiler-col-max">Max</span>
        </div>`;

        for (const [name, ms] of sorted) {
            const rec = this.records_.get(name)!;
            const avg = rec.history.reduce((s, v) => s + v, 0) / rec.history.length;
            const max = Math.max(...rec.history);
            const pct = (ms / maxMs) * 100;
            const isHot = ms >= HOT_THRESHOLD_MS;
            const barColor = isHot ? COLOR_BAR_HOT : COLOR_BAR;
            const displayName = escapeHtml(name.length > 28 ? name.slice(0, 28) + '...' : name);
            const timeStr = ms < 0.01 ? '<0.01' : ms.toFixed(2);
            const avgStr = avg < 0.01 ? '<0.01' : avg.toFixed(2);
            const maxStr = max < 0.01 ? '<0.01' : max.toFixed(2);

            html += `<div class="es-profiler-table-row${isHot ? ' es-profiler-hot' : ''}">
                <span class="es-profiler-col-name" title="${escapeHtml(name)}">${displayName}</span>
                <span class="es-profiler-col-time">${timeStr}ms</span>
                <span class="es-profiler-col-bar">
                    <span class="es-profiler-bar-bg">
                        <span class="es-profiler-bar-fill" style="width:${pct.toFixed(1)}%;background:${barColor}"></span>
                    </span>
                </span>
                <span class="es-profiler-col-avg">${avgStr}</span>
                <span class="es-profiler-col-max">${maxStr}</span>
            </div>`;
        }

        this.el_.innerHTML = html;
    }

    reset(): void {
        this.records_.clear();
        this.el_.innerHTML = '';
    }

    dispose(): void {
        this.el_.remove();
    }
}
