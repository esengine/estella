import type { App } from 'esengine';

export class ScriptInjector {
    private cleanupFns_: (() => void)[] = [];
    private blobUrls_: string[] = [];

    async inject(app: App, compiledCode: string | null): Promise<void> {
        if (!compiledCode) return;

        const pendingBefore = (window as any).__esengine_pendingSystems?.length ?? 0;

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

        for (const url of this.blobUrls_) {
            URL.revokeObjectURL(url);
        }
        this.blobUrls_ = [];
    }
}
