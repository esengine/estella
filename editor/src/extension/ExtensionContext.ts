import {
    PostProcess, Material,
    unregisterDrawCallback,
} from 'esengine';

export class ExtensionContext {
    createAPI(base: Record<string, unknown>): Record<string, unknown> {
        return {
            ...base,
            registerDrawCallback: (id: string, fn: Function) => {
                if (this.disposed_) return;
                (base.registerDrawCallback as Function)(id, fn);
                this.drawCallbackIds_.add(id);
            },
            unregisterDrawCallback: (id: string) => {
                (base.unregisterDrawCallback as Function)(id);
                this.drawCallbackIds_.delete(id);
            },
            clearDrawCallbacks: undefined,

            PostProcess: {
                ...(base.PostProcess as object),
                addPass: (name: string, shader: number) => {
                    if (this.disposed_) return -1;
                    const idx = (base.PostProcess as any).addPass(name, shader);
                    this.postProcessPasses_.add(name);
                    return idx;
                },
            },

            Material: {
                ...(base.Material as object),
                createShader: (vert: string, frag: string) => {
                    if (this.disposed_) return 0;
                    const handle = (base.Material as any).createShader(vert, frag);
                    if (handle > 0) this.shaderHandles_.add(handle);
                    return handle;
                },
            },

            onDispose: (fn: () => void) => { this.disposables_.push(fn); },
        };
    }

    dispose(): void {
        if (this.disposed_) return;
        this.disposed_ = true;

        for (let i = this.disposables_.length - 1; i >= 0; i--) {
            try { this.disposables_[i](); } catch {}
        }

        for (const id of this.drawCallbackIds_) {
            unregisterDrawCallback(id);
        }

        for (const name of this.postProcessPasses_) {
            try { PostProcess.removePass(name); } catch {}
        }

        for (const handle of this.shaderHandles_) {
            try { Material.releaseShader(handle); } catch {}
        }
    }

    private disposed_ = false;
    private drawCallbackIds_ = new Set<string>();
    private postProcessPasses_ = new Set<string>();
    private shaderHandles_ = new Set<number>();
    private disposables_: (() => void)[] = [];
}
