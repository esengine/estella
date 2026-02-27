import * as esengine from 'esengine';
import type { App } from 'esengine';

export class ScriptInjector {
    private cleanupFns_: (() => void)[] = [];
    private blobUrls_: string[] = [];
    private app_: App | null = null;
    private injectedSystemIds_: symbol[] = [];

    async inject(app: App, compiledCode: string | null): Promise<void> {
        if (!compiledCode) return;

        this.app_ = app;

        const pendingBefore = (window as any).__esengine_pendingSystems?.length ?? 0;

        (window as any).__esengine_shim__ = { esengine };

        const blob = new Blob([compiledCode], { type: 'text/javascript' });
        const url = URL.createObjectURL(blob);
        this.blobUrls_.push(url);

        try {
            const mod = await import(/* @vite-ignore */ url);
            if (typeof mod.setup === 'function') {
                const cleanup = mod.setup(app);
                if (typeof cleanup === 'function') {
                    this.cleanupFns_.push(cleanup);
                }
            }
        } catch (e) {
            console.error('[ScriptInjector] Failed to load user scripts:', e);
        }

        const pending = (window as any).__esengine_pendingSystems;
        if (pending && pending.length > pendingBefore) {
            for (let i = pendingBefore; i < pending.length; i++) {
                const entry = pending[i];
                app.addSystemToSchedule(entry.schedule, entry.system);
                this.injectedSystemIds_.push(entry.system._id);
            }
            pending.length = 0;
        }
    }

    eject(): void {
        for (const fn of this.cleanupFns_) {
            try { fn(); } catch (e) {
                console.warn('[ScriptInjector] Cleanup failed:', e);
            }
        }
        this.cleanupFns_ = [];

        if (this.app_) {
            for (const id of this.injectedSystemIds_) {
                this.app_.removeSystem(id);
            }
        }
        this.injectedSystemIds_ = [];
        this.app_ = null;

        for (const url of this.blobUrls_) {
            URL.revokeObjectURL(url);
        }
        this.blobUrls_ = [];

        delete (window as any).__esengine_shim__;
    }
}
