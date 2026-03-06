import {
    PostProcess, Material,
    unregisterDrawCallback,
} from 'esengine';
import type { EditorContainer } from '../container/EditorContainer';
import { EditorExtensionAPI } from './EditorExtensionAPI';

export class ExtensionContext {
    private editorAPI_: EditorExtensionAPI | null = null;

    createAPI(base: Record<string, unknown>, container?: EditorContainer): Record<string, unknown> {
        if (container) {
            this.editorAPI_ = new EditorExtensionAPI(container);
        }

        return {
            ...base,
            editor: this.editorAPI_,
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
                bind: (camera: number, stack: unknown) => {
                    if (this.disposed_) return;
                    PostProcess.bind(camera, stack as any);
                    this.postProcessCameras_.add(camera);
                },
                unbind: (camera: number) => {
                    PostProcess.unbind(camera);
                    this.postProcessCameras_.delete(camera);
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

        this.editorAPI_?.dispose();
        this.editorAPI_ = null;

        for (let i = this.disposables_.length - 1; i >= 0; i--) {
            try { this.disposables_[i](); } catch {}
        }

        for (const id of this.drawCallbackIds_) {
            unregisterDrawCallback(id);
        }

        for (const camera of this.postProcessCameras_) {
            try { PostProcess.unbind(camera); } catch {}
        }

        for (const handle of this.shaderHandles_) {
            try { Material.releaseShader(handle); } catch {}
        }
    }

    private disposed_ = false;
    private drawCallbackIds_ = new Set<string>();
    private postProcessCameras_ = new Set<number>();
    private shaderHandles_ = new Set<number>();
    private disposables_: (() => void)[] = [];
}
