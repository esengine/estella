import { MainWindowBridge } from '../multiwindow/MainWindowBridge';
import { WindowManager } from '../multiwindow/WindowManager';
import type { EditorStore } from '../store/EditorStore';
import type { DockLayoutManager } from '../DockLayoutManager';
import type { OutputService } from './OutputService';
import type { ProfilerService } from './ProfilerService';
import type { FrameDebuggerService } from './FrameDebuggerService';

export class MultiWindowService {
    private mainWindowBridge_: MainWindowBridge | null = null;
    private windowManager_: WindowManager | null = null;
    private store_: EditorStore;
    private projectPath_: string | null;
    private closeUnlisten_: (() => void) | null = null;

    constructor(store: EditorStore, projectPath: string | null) {
        this.store_ = store;
        this.projectPath_ = projectPath;
    }

    get windowManager(): WindowManager | null {
        return this.windowManager_;
    }

    get mainWindowBridge(): MainWindowBridge | null {
        return this.mainWindowBridge_;
    }

    initialize(
        dockLayout: DockLayoutManager | null,
        outputService: OutputService,
        profilerService: ProfilerService,
        frameDebuggerService: FrameDebuggerService,
        getPreviewUrl: () => Promise<string | null>,
        onUnsavedClose: () => Promise<void>,
    ): void {
        if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;

        this.mainWindowBridge_ = new MainWindowBridge(this.store_);
        this.mainWindowBridge_.start();
        this.windowManager_ = new WindowManager();
        this.windowManager_.setProjectPath(this.projectPath_);

        outputService.setMainWindowBridge(this.mainWindowBridge_);
        profilerService.setWindowManager(this.windowManager_);
        frameDebuggerService.setWindowManager(this.windowManager_);

        if (dockLayout) {
            const bridge = this.mainWindowBridge_;
            dockLayout.setDetachContext({
                handler: this.windowManager_,
                getPreviewUrl,
                onPanelClosed: (cb) => bridge.onPanelClosed(cb),
            });
        }

        this.setupCloseHandler_(onUnsavedClose);
    }

    private setupCloseHandler_(onUnsavedClose: () => Promise<void>): void {
        import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
            const mainWindow = getCurrentWindow();
            this.closeUnlisten_ = await mainWindow.onCloseRequested(async (event) => {
                event.preventDefault();
                if (this.store_.isDirty) {
                    try {
                        await onUnsavedClose();
                    } catch (e) {
                        console.error('Close handler error:', e);
                    }
                }
                await this.windowManager_?.closeAll();
                mainWindow.destroy();
            });
        });
    }

    dispose(): void {
        this.closeUnlisten_?.();
        this.closeUnlisten_ = null;
        this.windowManager_?.closeAll();
        this.mainWindowBridge_?.dispose();
    }
}
