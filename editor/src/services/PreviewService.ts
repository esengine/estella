import { PreviewManager } from '../PreviewManager';
import { showToast, showErrorToast } from '../ui/Toast';
import { hasFileHandle } from '../io/SceneSerializer';
import type { EditorStore } from '../store/EditorStore';
import type { ScriptService } from './ScriptService';
import type { SpineService } from './SpineService';

export class PreviewService {
    private previewManager_: PreviewManager;
    private previewUrl_: string | null = null;
    private store_: EditorStore;
    private scriptService_: ScriptService;
    private spineService_: SpineService;
    private container_: HTMLElement;
    private saveScene_: () => Promise<void>;

    constructor(
        projectPath: string | null,
        store: EditorStore,
        scriptService: ScriptService,
        spineService: SpineService,
        container: HTMLElement,
        saveScene: () => Promise<void>,
    ) {
        this.previewManager_ = new PreviewManager(projectPath);
        this.store_ = store;
        this.scriptService_ = scriptService;
        this.spineService_ = spineService;
        this.container_ = container;
        this.saveScene_ = saveScene;
    }

    get previewManager(): PreviewManager {
        return this.previewManager_;
    }

    async startPreview(): Promise<void> {
        if (this.store_.isDirty && this.store_.filePath && hasFileHandle()) {
            await this.saveScene_();
            showToast({ type: 'info', title: 'Scene saved before preview' });
        }
        try {
            const port = await this.previewManager_.startPreview(
                this.store_.scene, this.scriptService_.scriptLoader, this.spineService_.spineVersion,
            );
            if (port !== null) {
                this.previewUrl_ = `http://localhost:${port}`;
                this.updatePreviewUrl_();
            }
        } catch (err) {
            showErrorToast(`Preview failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    async startPreviewServer(): Promise<string | null> {
        if (this.store_.isDirty && this.store_.filePath && hasFileHandle()) {
            await this.saveScene_();
        }
        try {
            const port = await this.previewManager_.startServer(
                this.store_.scene, this.scriptService_.scriptLoader, this.spineService_.spineVersion,
            );
            if (port === null) return null;
            this.previewUrl_ = `http://localhost:${port}`;
            this.updatePreviewUrl_();
            return this.previewUrl_;
        } catch (err) {
            showErrorToast(`Preview server failed: ${err instanceof Error ? err.message : String(err)}`);
            return null;
        }
    }

    async stopPreviewServer(): Promise<void> {
        await this.previewManager_.stopPreview();
        this.previewUrl_ = null;
        this.updatePreviewUrl_();
    }

    togglePreviewStats(enabled: boolean): void {
        this.previewManager_.setShowStats(enabled);
        if (this.previewUrl_) {
            this.previewManager_.refreshFiles(
                this.store_.scene, this.scriptService_.scriptLoader, this.spineService_.spineVersion,
            );
        }
    }

    get previewStatsEnabled(): boolean {
        return this.previewManager_.showStats;
    }

    refreshFiles(): void {
        this.previewManager_.refreshFiles(
            this.store_.scene, this.scriptService_.scriptLoader, this.spineService_.spineVersion,
        );
    }

    private updatePreviewUrl_(): void {
        const urlEl = this.container_.querySelector('.es-preview-url') as HTMLElement;
        if (!urlEl) return;
        if (this.previewUrl_) {
            urlEl.textContent = this.previewUrl_;
            urlEl.dataset.url = this.previewUrl_;
            urlEl.style.display = '';
        } else {
            urlEl.style.display = 'none';
        }
    }

    dispose(): void {
        this.previewManager_.dispose();
    }
}
