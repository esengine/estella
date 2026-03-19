import * as esengine from 'esengine';
import type { App } from 'esengine';
import { getDefaultContext } from 'esengine';

export class ScriptInjector {
    private cleanupFns_: (() => void)[] = [];
    private blobUrls_: string[] = [];
    private app_: App | null = null;
    private injectedSystemIds_: symbol[] = [];

    async inject(app: App, compiledCode: string | null): Promise<void> {
        if (!compiledCode) return;

        this.app_ = app;

        const ctx = getDefaultContext();

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

        const drained = ctx.drainPendingSystems();
        for (const entry of drained) {
            const templateId = (entry.system as any)._id;
            app.addSystemToSchedule(entry.schedule as any, entry.system as any);
            this.injectedSystemIds_.push(templateId);
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
