/**
 * @file    ExtensionLoader.ts
 * @brief   Load and compile user editor extensions from project editor/ directory
 */

import * as esbuild from 'esbuild-wasm/esm/browser';
import { editorShimPlugin, virtualFsPlugin } from '../scripting/esbuildPlugins';
import type { NativeFS, CompileError } from '../scripting/types';
import { getEditorContext } from '../context/EditorContext';
import { ExtensionContext } from './ExtensionContext';
import { setEditorAPI } from './editorAPI';

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
    baseAPI: Record<string, unknown>;
    onCompileError?: (errors: CompileError[]) => void;
    onCompileSuccess?: () => void;
    onCleanup?: () => void;
    onAfterReload?: () => void;
}

export class ExtensionLoader {
    constructor(options: ExtensionLoaderOptions) {
        this.projectPath_ = normalizePath(options.projectPath);
        this.projectDir_ = getProjectDir(this.projectPath_);
        this.baseAPI_ = options.baseAPI;
        this.onCompileError_ = options.onCompileError;
        this.onCompileSuccess_ = options.onCompileSuccess;
        this.onCleanup_ = options.onCleanup;
        this.onAfterReload_ = options.onAfterReload;
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

        try {
            const editorDirs = await this.findEditorDirs(fs, this.projectDir_);
            const results: string[] = [];

            for (const dir of editorDirs) {
                if (!await fs.exists(dir)) continue;
                const entries = await fs.listDirectoryDetailed(dir);
                for (const e of entries) {
                    if (!e.isDirectory && e.name.endsWith('.ts')) {
                        results.push(joinPath(dir, e.name));
                    }
                }
            }

            this.lastEditorDir_ = editorDirs[0] ?? null;
            return results;
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
                    resolveDir: this.lastEditorDir_ ?? this.projectDir_,
                },
                bundle: true,
                format: 'esm',
                write: false,
                sourcemap: true,
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

            const outputFiles = result.outputFiles ?? [];
            const mapFile = outputFiles.find(f => f.path.endsWith('.map'));
            const jsFile = outputFiles.find(f => !f.path.endsWith('.map'));
            this.lastCompiled_ = jsFile?.text ?? null;
            this.lastSourcemap_ = mapFile?.text ?? null;
            console.log('ExtensionLoader: Extensions compiled successfully');
            this.onCompileSuccess_?.();
            return true;
        } catch (err: any) {
            console.error('ExtensionLoader: Compilation failed:', err);
            const esbuildErrors = err?.errors as esbuild.Message[] | undefined;
            const errors: CompileError[] = esbuildErrors?.length
                ? esbuildErrors.map(e => ({
                    file: e.location?.file || 'unknown',
                    line: e.location?.line || 0,
                    column: e.location?.column || 0,
                    message: e.text,
                }))
                : [{ file: 'unknown', line: 0, column: 0, message: String(err) }];
            this.onCompileError_?.(errors);
            return false;
        }
    }

    async execute(): Promise<boolean> {
        if (!this.lastCompiled_) {
            console.warn('ExtensionLoader: No compiled code to execute');
            return false;
        }

        this.disposeCurrentUrl();

        try {
            let code = this.lastCompiled_;
            if (this.lastSourcemap_) {
                const b64 = btoa(unescape(encodeURIComponent(this.lastSourcemap_)));
                code += '\n//# sourceMappingURL=data:application/json;base64,' + b64;
            }

            const blob = new Blob([code], { type: 'application/javascript' });
            this.currentBlobUrl_ = URL.createObjectURL(blob);
            await import(/* @vite-ignore */ this.currentBlobUrl_);
            console.log('ExtensionLoader: Extensions executed successfully');
            return true;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('ExtensionLoader: Extension execution failed:', msg);
            return false;
        }
    }

    async reload(): Promise<boolean> {
        if (this.isReloading_) return false;
        this.isReloading_ = true;
        try {
            const compiled = await this.compile();
            if (this.currentContext_) {
                this.currentContext_.dispose();
                this.currentContext_ = null;
                this.onCleanup_?.();
            }
            if (!compiled) return false;
            this.currentContext_ = new ExtensionContext();
            setEditorAPI(this.currentContext_.createAPI(this.baseAPI_));
            const executed = await this.execute();
            if (executed) {
                this.onAfterReload_?.();
            }
            return executed;
        } finally {
            this.isReloading_ = false;
        }
    }

    async watch(): Promise<void> {
        const fs = getNativeFS();
        if (!fs) return;

        this.unwatch();

        this.unwatchFn_ = await fs.watchDirectory(
            this.projectDir_,
            (event) => {
                const hasEditorTs = event.paths.some(p => {
                    const normalized = normalizePath(p);
                    return /\/editor\/[^/]+\.ts$/.test(normalized);
                });
                if (!hasEditorTs) return;

                if (this.recompileTimer_ !== null) {
                    clearTimeout(this.recompileTimer_);
                }
                this.recompileTimer_ = window.setTimeout(() => {
                    this.recompileTimer_ = null;
                    this.reload();
                }, 300);
            },
            { recursive: true },
        );
    }

    unwatch(): void {
        if (this.recompileTimer_ !== null) {
            clearTimeout(this.recompileTimer_);
            this.recompileTimer_ = null;
        }
        this.unwatchFn_?.();
        this.unwatchFn_ = null;
    }

    dispose(): void {
        this.unwatch();
        this.currentContext_?.dispose();
        this.currentContext_ = null;
        this.disposeCurrentUrl();
    }

    // =========================================================================
    // Private Methods
    // =========================================================================

    private static readonly IGNORED_DIRS = new Set([
        'node_modules', '.git', '.esengine', 'dist', 'build', '.next', '.cache',
    ]);

    private async findEditorDirs(fs: NativeFS, dir: string): Promise<string[]> {
        const results: string[] = [];
        const entries = await fs.listDirectoryDetailed(dir);

        for (const e of entries) {
            if (!e.isDirectory) continue;
            if (ExtensionLoader.IGNORED_DIRS.has(e.name)) continue;

            const fullPath = joinPath(dir, e.name);
            if (e.name === 'editor') {
                results.push(fullPath);
            } else {
                const nested = await this.findEditorDirs(fs, fullPath);
                results.push(...nested);
            }
        }

        return results;
    }

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
    private baseAPI_: Record<string, unknown>;
    private initialized_ = false;
    private isReloading_ = false;
    private lastEditorDir_: string | null = null;
    private lastCompiled_: string | null = null;
    private lastSourcemap_: string | null = null;
    private currentBlobUrl_: string | null = null;
    private currentContext_: ExtensionContext | null = null;
    private unwatchFn_: (() => void) | null = null;
    private recompileTimer_: number | null = null;
    private onCompileError_?: (errors: CompileError[]) => void;
    private onCompileSuccess_?: () => void;
    private onCleanup_?: () => void;
    private onAfterReload_?: () => void;
}
