import { getSharedRenderContext } from '../renderer/SharedRenderContext';
import { emit } from '@tauri-apps/api/event';
import { CHANNEL_PROFILER_STATS } from '../multiwindow/protocol';
import type { WindowManager } from '../multiwindow/WindowManager';

export class ProfilerService {
    private profilerActive_ = false;
    private windowManager_: WindowManager | null = null;

    setWindowManager(windowManager: WindowManager | null): void {
        this.windowManager_ = windowManager;
    }

    async showProfilerWindow(): Promise<void> {
        if (!this.windowManager_) return;

        await this.windowManager_.detachPanel('profiler', 'Profiler');
        this.startProfilerStats();
    }

    startProfilerStats(): void {
        if (this.profilerActive_) return;
        this.profilerActive_ = true;

        const ctx = getSharedRenderContext();
        ctx.setPostTickCallback(() => this.emitProfilerStats_());
    }

    stopProfilerStats(): void {
        if (!this.profilerActive_) return;
        this.profilerActive_ = false;

        const ctx = getSharedRenderContext();
        ctx.setPostTickCallback(null);
    }

    private emitProfilerStats_(): void {
        const ctx = getSharedRenderContext();
        const app = ctx.app_;

        const frameTimeMs = app?.getPhaseTimings()
            ? [...(app.getPhaseTimings() as Map<string, number>).values()].reduce((a: number, b: number) => a + b, 0)
            : 0;

        const phaseTimings: [string, number][] = app?.getPhaseTimings()
            ? [...(app.getPhaseTimings() as Map<string, number>).entries()]
            : [];

        const systemTimings: [string, number][] = app?.getSystemTimings()
            ? [...(app.getSystemTimings() as ReadonlyMap<string, number>).entries()]
            : [];

        const msg = { frameTimeMs, phaseTimings, systemTimings };
        emit(CHANNEL_PROFILER_STATS, msg);
    }
}
