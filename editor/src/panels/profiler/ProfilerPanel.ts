import { FrameHistory, type FrameSnapshot } from 'esengine';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { CHANNEL_PROFILER_STATS, type ProfilerStatsMessage } from '../../multiwindow/protocol';
import { getProfilerService } from '../../services';
import type { PanelInstance } from '../PanelRegistry';
import { FrameTimeline } from './FrameTimeline';
import { PhaseWaterfall } from './PhaseWaterfall';
import { SystemTable } from './SystemTable';

const enum Mode {
    Live,
    Paused,
}

export class ProfilerPanel implements PanelInstance {
    private container_: HTMLElement;
    private frameHistory_ = new FrameHistory();
    private timeline_: FrameTimeline | null = null;
    private waterfall_: PhaseWaterfall | null = null;
    private systemTable_: SystemTable | null = null;
    private disposed_ = false;
    private unlisten_: UnlistenFn | null = null;

    private mode_ = Mode.Live;
    private selectedIndex_ = -1;
    private rafId_ = 0;
    private dirty_ = false;
    private frozenSnapshots_: FrameSnapshot[] = [];

    private btnPause_!: HTMLButtonElement;
    private btnClear_!: HTMLButtonElement;
    private btnPrev_!: HTMLButtonElement;
    private btnNext_!: HTMLButtonElement;
    private fpsDisplay_!: HTMLElement;
    private frameDisplay_!: HTMLElement;

    constructor(container: HTMLElement) {
        this.container_ = container;
        this.buildUI();
        this.startListening();
        getProfilerService().startProfilerStats();
    }

    dispose(): void {
        this.disposed_ = true;
        this.unlisten_?.();
        this.unlisten_ = null;
        if (this.rafId_) cancelAnimationFrame(this.rafId_);
        this.timeline_?.dispose();
        this.waterfall_?.dispose();
        this.systemTable_?.dispose();
        this.container_.innerHTML = '';
        getProfilerService().stopProfilerStats();
    }

    private buildUI(): void {
        this.container_.innerHTML = `
            <div class="es-profiler-panel">
                <div class="es-profiler-toolbar">
                    <button class="es-profiler-btn es-profiler-btn-pause" title="Pause/Resume">▮▮</button>
                    <button class="es-profiler-btn es-profiler-btn-clear" title="Clear">Clear</button>
                    <span class="es-profiler-fps-display">-- FPS / --ms</span>
                    <span class="es-profiler-toolbar-sep"></span>
                    <button class="es-profiler-btn es-profiler-btn-prev" title="Previous frame" disabled>◀</button>
                    <span class="es-profiler-frame-display">--</span>
                    <button class="es-profiler-btn es-profiler-btn-next" title="Next frame" disabled>▶</button>
                </div>
                <div class="es-profiler-top">
                    <div class="es-profiler-timeline-wrap"></div>
                    <div class="es-profiler-waterfall-wrap"></div>
                </div>
                <div class="es-profiler-bottom">
                    <div class="es-profiler-table-wrap"></div>
                </div>
            </div>
        `;

        this.btnPause_ = this.container_.querySelector('.es-profiler-btn-pause') as HTMLButtonElement;
        this.btnClear_ = this.container_.querySelector('.es-profiler-btn-clear') as HTMLButtonElement;
        this.btnPrev_ = this.container_.querySelector('.es-profiler-btn-prev') as HTMLButtonElement;
        this.btnNext_ = this.container_.querySelector('.es-profiler-btn-next') as HTMLButtonElement;
        this.fpsDisplay_ = this.container_.querySelector('.es-profiler-fps-display') as HTMLElement;
        this.frameDisplay_ = this.container_.querySelector('.es-profiler-frame-display') as HTMLElement;

        this.btnPause_.addEventListener('click', this.onTogglePause_);
        this.btnClear_.addEventListener('click', this.onClear_);
        this.btnPrev_.addEventListener('click', this.onPrev_);
        this.btnNext_.addEventListener('click', this.onNext_);

        const timelineWrap = this.container_.querySelector('.es-profiler-timeline-wrap') as HTMLElement;
        const waterfallWrap = this.container_.querySelector('.es-profiler-waterfall-wrap') as HTMLElement;
        const tableWrap = this.container_.querySelector('.es-profiler-table-wrap') as HTMLElement;

        this.timeline_ = new FrameTimeline(timelineWrap);
        this.timeline_.onFrameSelect = this.onFrameSelect_;
        this.waterfall_ = new PhaseWaterfall(waterfallWrap);
        this.systemTable_ = new SystemTable(tableWrap);
    }

    private async startListening(): Promise<void> {
        this.unlisten_ = await listen<ProfilerStatsMessage>(CHANNEL_PROFILER_STATS, (event) => {
            if (this.disposed_) return;
            this.onStatsReceived(event.payload);
        });
    }

    private onStatsReceived(msg: ProfilerStatsMessage): void {
        if (this.mode_ === Mode.Paused) return;

        const phaseTimings = new Map(msg.phaseTimings);
        const systemTimings = new Map(msg.systemTimings);

        this.frameHistory_.push(msg.frameTimeMs, phaseTimings, systemTimings);
        this.scheduleRender();
    }

    private scheduleRender(): void {
        if (this.dirty_) return;
        this.dirty_ = true;
        this.rafId_ = requestAnimationFrame(() => {
            this.dirty_ = false;
            this.renderOnce();
        });
    }

    private renderOnce(): void {
        if (!this.timeline_ || !this.waterfall_ || !this.systemTable_) return;

        if (this.mode_ === Mode.Live) {
            const all = this.frameHistory_.getAll();
            this.timeline_.selectedIndex = -1;
            this.timeline_.render(all);

            const latest = this.frameHistory_.getLatest();
            if (latest) {
                this.waterfall_.render(latest.phaseTimings);
                if (latest.systemTimings.size > 0) {
                    this.systemTable_.update(latest.systemTimings);
                }
            }
            this.updateFpsDisplay(all);
            this.frameDisplay_.textContent = all.length > 0 ? `Frame #${all.length - 1}` : '--';
        } else {
            this.timeline_.selectedIndex = this.selectedIndex_;
            this.timeline_.render(this.frozenSnapshots_);

            if (this.selectedIndex_ >= 0 && this.selectedIndex_ < this.frozenSnapshots_.length) {
                const snap = this.frozenSnapshots_[this.selectedIndex_];
                this.waterfall_.render(snap.phaseTimings);
                if (snap.systemTimings.size > 0) {
                    this.systemTable_.update(snap.systemTimings);
                }
                this.frameDisplay_.textContent = `Frame #${this.selectedIndex_}`;
            }
        }

        this.updateNavButtons();
    }

    private updateFpsDisplay(snapshots: FrameSnapshot[]): void {
        if (snapshots.length === 0) {
            this.fpsDisplay_.textContent = '-- FPS / --ms';
            return;
        }
        const latest = snapshots[snapshots.length - 1];
        const fps = latest.frameTimeMs > 0 ? (1000 / latest.frameTimeMs) : 0;
        this.fpsDisplay_.textContent = `${fps.toFixed(0)} FPS / ${latest.frameTimeMs.toFixed(1)}ms`;
    }

    private updateNavButtons(): void {
        const isPaused = this.mode_ === Mode.Paused;
        this.btnPrev_.disabled = !isPaused || this.selectedIndex_ <= 0;
        this.btnNext_.disabled = !isPaused || this.selectedIndex_ >= this.frozenSnapshots_.length - 1;
    }

    private enterPaused(selectIndex: number): void {
        this.frozenSnapshots_ = this.frameHistory_.getAll();
        this.selectedIndex_ = Math.min(selectIndex, this.frozenSnapshots_.length - 1);
        this.mode_ = Mode.Paused;
        this.btnPause_.textContent = '▶';
        this.btnPause_.classList.add('es-profiler-btn-active');
        this.scheduleRender();
    }

    private enterLive(): void {
        this.mode_ = Mode.Live;
        this.selectedIndex_ = -1;
        this.frozenSnapshots_ = [];
        this.btnPause_.textContent = '▮▮';
        this.btnPause_.classList.remove('es-profiler-btn-active');
        this.scheduleRender();
    }

    private onTogglePause_ = (): void => {
        if (this.mode_ === Mode.Live) {
            this.enterPaused(this.frameHistory_.count - 1);
        } else {
            this.enterLive();
        }
    };

    private onClear_ = (): void => {
        this.frameHistory_.reset();
        this.systemTable_?.reset();
        this.frozenSnapshots_ = [];
        this.selectedIndex_ = -1;
        this.mode_ = Mode.Live;
        this.btnPause_.textContent = '▮▮';
        this.btnPause_.classList.remove('es-profiler-btn-active');
        this.fpsDisplay_.textContent = '-- FPS / --ms';
        this.frameDisplay_.textContent = '--';
        this.scheduleRender();
    };

    private onPrev_ = (): void => {
        if (this.mode_ !== Mode.Paused || this.selectedIndex_ <= 0) return;
        this.selectedIndex_--;
        this.scheduleRender();
    };

    private onNext_ = (): void => {
        if (this.mode_ !== Mode.Paused || this.selectedIndex_ >= this.frozenSnapshots_.length - 1) return;
        this.selectedIndex_++;
        this.scheduleRender();
    };

    private onFrameSelect_ = (index: number): void => {
        if (this.mode_ === Mode.Live) {
            this.enterPaused(index);
        } else {
            this.selectedIndex_ = Math.min(index, this.frozenSnapshots_.length - 1);
            this.scheduleRender();
        }
    };
}
