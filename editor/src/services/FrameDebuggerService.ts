import { Renderer } from 'esengine';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
    CHANNEL_FRAME_DEBUGGER_DATA,
    CHANNEL_FRAME_DEBUGGER_REPLAY_REQ,
    CHANNEL_FRAME_DEBUGGER_SNAPSHOT,
    type FrameDebuggerReplayReqMessage,
} from '../multiwindow/protocol';
import type { WindowManager } from '../multiwindow/WindowManager';

export class FrameDebuggerService {
    private active_ = false;
    private rafId_ = 0;
    private windowManager_: WindowManager | null = null;
    private replayUnlisten_: UnlistenFn | null = null;
    private snapshotCanvas_: OffscreenCanvas | HTMLCanvasElement | null = null;

    setWindowManager(windowManager: WindowManager | null): void {
        this.windowManager_ = windowManager;
    }

    async showFrameDebuggerWindow(): Promise<void> {
        if (!this.windowManager_) return;
        await this.windowManager_.detachPanel('frame-debugger', 'Frame Debugger');
        this.start();
    }

    start(): void {
        if (this.active_) return;
        this.active_ = true;
        this.listenForReplayRequests_();
        this.captureLoop_();
    }

    stop(): void {
        if (!this.active_) return;
        this.active_ = false;
        if (this.rafId_) cancelAnimationFrame(this.rafId_);
        this.rafId_ = 0;
        this.replayUnlisten_?.();
        this.replayUnlisten_ = null;
    }

    private captureLoop_(): void {
        if (!this.active_) return;

        Renderer.captureNextFrame();

        this.rafId_ = requestAnimationFrame(() => {
            this.rafId_ = requestAnimationFrame(() => {
                if (!this.active_) return;

                if (Renderer.hasCapturedData()) {
                    const data = Renderer.getCapturedData();
                    if (data) {
                        emit(CHANNEL_FRAME_DEBUGGER_DATA, {
                            drawCalls: data.drawCalls,
                            cameraCount: data.cameraCount,
                        });
                    }
                }
                this.captureLoop_();
            });
        });
    }

    private async listenForReplayRequests_(): Promise<void> {
        this.replayUnlisten_ = await listen<FrameDebuggerReplayReqMessage>(
            CHANNEL_FRAME_DEBUGGER_REPLAY_REQ,
            (event) => {
                this.handleReplayRequest_(event.payload.drawCallIndex);
            },
        );
    }

    private handleReplayRequest_(drawCallIndex: number): void {
        Renderer.replayToDrawCall(drawCallIndex);
        const imgData = Renderer.getSnapshotImageData();
        if (!imgData) {
            emit(CHANNEL_FRAME_DEBUGGER_SNAPSHOT, { dataUrl: '', width: 0, height: 0 });
            return;
        }

        const canvas = this.getSnapshotCanvas_(imgData.width, imgData.height);
        const ctx = (canvas as HTMLCanvasElement).getContext('2d')!;
        ctx.putImageData(imgData, 0, 0);
        const dataUrl = (canvas as HTMLCanvasElement).toDataURL('image/png');

        emit(CHANNEL_FRAME_DEBUGGER_SNAPSHOT, {
            dataUrl,
            width: imgData.width,
            height: imgData.height,
        });
    }

    private getSnapshotCanvas_(w: number, h: number): HTMLCanvasElement {
        if (!this.snapshotCanvas_ || (this.snapshotCanvas_ as HTMLCanvasElement).width !== w || (this.snapshotCanvas_ as HTMLCanvasElement).height !== h) {
            const c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            this.snapshotCanvas_ = c;
        }
        return this.snapshotCanvas_ as HTMLCanvasElement;
    }
}
