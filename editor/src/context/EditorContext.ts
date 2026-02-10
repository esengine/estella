import type { NativeFS } from '../scripting/types';
import type { Editor } from '../Editor';

export interface NativeShell {
    openFile(path: string): Promise<void>;
    openUrl(url: string): Promise<void>;
    openInEditor(projectPath: string, filePath: string): Promise<void>;
    execute(
        cmd: string,
        args: string[],
        cwd: string,
        onOutput?: (stream: 'stdout' | 'stderr', data: string) => void
    ): Promise<{ code: number }>;
}

export interface EditorContextConfig {
    fs?: NativeFS;
    invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
    shell?: NativeShell;
    esbuildWasmURL?: string;
    version?: string;
    onCheckUpdate?: () => void;
}

let ctx: EditorContextConfig = {};
let editorInstance: Editor | null = null;

export function setEditorContext(config: EditorContextConfig): void {
    ctx = config;
}

export function getEditorContext(): EditorContextConfig {
    return ctx;
}

export function setEditorInstance(editor: Editor): void {
    editorInstance = editor;
}

export function getEditorInstance(): Editor | null {
    return editorInstance;
}

const ESBUILD_WASM_CDN = 'https://cdn.jsdelivr.net/npm/esbuild-wasm@0.27.2/esbuild.wasm';

export function getEsbuildWasmURL(): string {
    return ctx.esbuildWasmURL ?? ESBUILD_WASM_CDN;
}
