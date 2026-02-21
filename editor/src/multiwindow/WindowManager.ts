import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { emit } from '@tauri-apps/api/event';
import { CHANNEL_PANEL_CLOSED, type PanelClosedMessage } from './protocol';

interface DetachedPanel {
    windowLabel: string;
    panelId: string;
    window: WebviewWindow;
}

export class WindowManager {
    private detachedPanels_ = new Map<string, DetachedPanel>();
    private projectPath_: string | null = null;

    setProjectPath(projectPath: string | null): void {
        this.projectPath_ = projectPath;
    }

    async detachPanel(panelId: string, title: string): Promise<void> {
        const existing = this.detachedPanels_.get(panelId);
        if (existing) {
            await existing.window.setFocus();
            return;
        }

        let url = `panel-window.html?panel=${encodeURIComponent(panelId)}`;
        if (this.projectPath_) {
            url += `&projectPath=${encodeURIComponent(this.projectPath_)}`;
        }

        const windowLabel = `panel-${panelId}-${Date.now()}`;
        const webviewWindow = new WebviewWindow(windowLabel, {
            url,
            title,
            width: 400,
            height: 600,
            minWidth: 300,
            minHeight: 200,
            center: true,
            decorations: true,
            resizable: true,
        });

        await this.waitForWindowCreation(webviewWindow);

        const entry: DetachedPanel = {
            windowLabel,
            panelId,
            window: webviewWindow,
        };

        this.detachedPanels_.set(panelId, entry);

        webviewWindow.once('tauri://close-requested', async () => {
            this.detachedPanels_.delete(panelId);
            const msg: PanelClosedMessage = { panelId, windowLabel };
            await emit(CHANNEL_PANEL_CLOSED, msg);
            await webviewWindow.destroy();
        });
    }

    async detachGameView(previewUrl: string): Promise<void> {
        const panelId = 'game';
        const existing = this.detachedPanels_.get(panelId);
        if (existing) {
            await existing.window.setFocus();
            return;
        }

        const windowLabel = `panel-game-${Date.now()}`;
        const webviewWindow = new WebviewWindow(windowLabel, {
            url: previewUrl,
            title: 'Game Preview',
            width: 800,
            height: 600,
            minWidth: 400,
            minHeight: 300,
            center: true,
            decorations: true,
            resizable: true,
        });

        await this.waitForWindowCreation(webviewWindow);

        const entry: DetachedPanel = {
            windowLabel,
            panelId,
            window: webviewWindow,
        };

        this.detachedPanels_.set(panelId, entry);

        webviewWindow.once('tauri://close-requested', async () => {
            this.detachedPanels_.delete(panelId);
            const msg: PanelClosedMessage = { panelId, windowLabel };
            await emit(CHANNEL_PANEL_CLOSED, msg);
            await webviewWindow.destroy();
        });
    }

    isDetached(panelId: string): boolean {
        return this.detachedPanels_.has(panelId);
    }

    async closeAll(): Promise<void> {
        const entries = Array.from(this.detachedPanels_.values());
        this.detachedPanels_.clear();
        for (const entry of entries) {
            try {
                await entry.window.destroy();
            } catch {
                // window may already be closed
            }
        }
    }

    private waitForWindowCreation(webviewWindow: WebviewWindow): Promise<void> {
        return new Promise((resolve, reject) => {
            webviewWindow.once('tauri://created', () => {
                resolve();
            });
            webviewWindow.once('tauri://error', (e) => {
                reject(new Error(`Failed to create window: ${e.payload}`));
            });
        });
    }
}
