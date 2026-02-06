/**
 * @file    ExtensionLoader.ts
 * @brief   Load and compile user editor extensions from project editor/ directory
 */

import * as esbuild from 'esbuild-wasm/esm/browser';
import { editorShimPlugin, virtualFsPlugin } from '../scripting/esbuildPlugins';
import type { NativeFS, CompileError } from '../scripting/types';
import { getEditorContext } from '../context/EditorContext';

// =============================================================================
// Path Utilities
// =============================================================================

function normalizePath(path: string): string {
    return path.replace(/\\/g, '/');
}

function joinPath(...parts: string[]): string {
    return normalizePath(parts.join('/').replace(/\/+/g, '/'));
}

function getProjectDir(projectPath: string): string {
    const normalized = normalizePath(projectPath);
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash > 0 ? normalized.substring(0, lastSlash) : normalized;
}

// =============================================================================
// Native FS Access
// =============================================================================

function getNativeFS(): NativeFS | null {
    return getEditorContext().fs ?? null;
}

// =============================================================================
// Extension Loader
// =============================================================================

export interface ExtensionLoaderOptions {
    projectPath: string;
    onCompileError?: (errors: CompileError[]) => void;
    onCompileSuccess?: () => void;
}

export class ExtensionLoader {
    constructor(options: ExtensionLoaderOptions) {
        this.projectPath_ = normalizePath(options.projectPath);
        this.projectDir_ = getProjectDir(this.projectPath_);
        this.onCompileError_ = options.onCompileError;
        this.onCompileSuccess_ = options.onCompileSuccess;
    }

    // =========================================================================
    // Public Methods
    // =========================================================================

    async initialize(): Promise<void> {
        if (this.initialized_) return;

        try {
            await esbuild.initialize({
                wasmURL: 'https://cdn.jsdelivr.net/npm/esbuild-wasm@0.27.2/esbuild.wasm',
            });
        } catch {
            // esbuild is a singleton; already initialized by ScriptLoader is fine
        }
        this.initialized_ = true;
    }

    async discover(): Promise<string[]> {
        const fs = getNativeFS();
        if (!fs) return [];

        const editorDir = joinPath(this.projectDir_, 'editor');

        try {
            if (!(await fs.exists(editorDir))) return [];

            const entries = await fs.listDirectoryDetailed(editorDir);
            return entries
                .filter(e => !e.isDirectory && e.name.endsWith('.ts'))
                .map(e => joinPath(editorDir, e.name));
        } catch (err) {
            console.error('ExtensionLoader: Failed to discover extensions:', err);
            return [];
        }
    }

    async compile(): Promise<boolean> {
        const fs = getNativeFS();
        if (!fs) return false;

        const scripts = await this.discover();
        if (scripts.length === 0) {
            this.lastCompiled_ = null;
            return true;
        }

        console.log('ExtensionLoader: Compiling extensions:', scripts);

        try {
            const entryContent = scripts
                .map(p => `import "${p}";`)
                .join('\n');

            const result = await esbuild.build({
                stdin: {
                    contents: entryContent,
                    loader: 'ts',
                    resolveDir: joinPath(this.projectDir_, 'editor'),
                },
                bundle: true,
                format: 'esm',
                write: false,
                platform: 'browser',
                target: 'es2020',
                external: ['esengine'],
                plugins: [
                    editorShimPlugin(),
                    virtualFsPlugin({ fs, projectDir: this.projectDir_ }),
                ],
            });

            if (result.errors.length > 0) {
                const errors: CompileError[] = result.errors.map(e => ({
                    file: e.location?.file || 'unknown',
                    line: e.location?.line || 0,
                    column: e.location?.column || 0,
                    message: e.text,
                }));
                console.error('ExtensionLoader: Compilation errors:', errors);
                this.onCompileError_?.(errors);
                return false;
            }

            this.lastCompiled_ = result.outputFiles?.[0]?.text ?? null;
            console.log('ExtensionLoader: Extensions compiled successfully');
            this.onCompileSuccess_?.();
            return true;
        } catch (err) {
            console.error('ExtensionLoader: Compilation failed:', err);
            const errors: CompileError[] = [{
                file: 'unknown',
                line: 0,
                column: 0,
                message: String(err),
            }];
            this.onCompileError_?.(errors);
            return false;
        }
    }

    async execute(): Promise<boolean> {
        if (!this.lastCompiled_) return false;

        this.disposeCurrentUrl();

        try {
            const blob = new Blob([this.lastCompiled_], { type: 'application/javascript' });
            this.currentBlobUrl_ = URL.createObjectURL(blob);
            await import(/* @vite-ignore */ this.currentBlobUrl_);
            console.log('ExtensionLoader: Extensions executed successfully');
            return true;
        } catch (err) {
            console.error('ExtensionLoader: Extension execution failed:', err);
            return false;
        }
    }

    async reload(): Promise<boolean> {
        const compiled = await this.compile();
        if (!compiled) return false;
        return this.execute();
    }

    dispose(): void {
        this.disposeCurrentUrl();
    }

    // =========================================================================
    // Private Methods
    // =========================================================================

    private disposeCurrentUrl(): void {
        if (this.currentBlobUrl_) {
            URL.revokeObjectURL(this.currentBlobUrl_);
            this.currentBlobUrl_ = null;
        }
    }

    // =========================================================================
    // Member Variables
    // =========================================================================

    private projectPath_: string;
    private projectDir_: string;
    private initialized_ = false;
    private lastCompiled_: string | null = null;
    private currentBlobUrl_: string | null = null;
    private onCompileError_?: (errors: CompileError[]) => void;
    private onCompileSuccess_?: () => void;
}
