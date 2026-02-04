/**
 * @file    ScriptLoader.ts
 * @brief   Load and compile user TypeScript scripts for preview
 */

import * as esbuild from 'esbuild-wasm/esm/browser';
import { virtualFsPlugin } from './esbuildPlugins';
import type { NativeFS, ScriptLoaderOptions, CompileError } from './types';

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
    return (window as any).__esengine_fs ?? null;
}

// =============================================================================
// Script Loader
// =============================================================================

export class ScriptLoader {
    constructor(options: ScriptLoaderOptions) {
        this.projectPath_ = normalizePath(options.projectPath);
        this.projectDir_ = getProjectDir(this.projectPath_);
        this.onCompileError_ = options.onCompileError;
        this.onCompileSuccess_ = options.onCompileSuccess;
    }

    // =========================================================================
    // Public Methods
    // =========================================================================

    getCompiledCode(): string | null {
        return this.lastCompiled_;
    }

    async initialize(): Promise<void> {
        if (this.initialized_) return;

        try {
            await esbuild.initialize({
                wasmURL: 'https://cdn.jsdelivr.net/npm/esbuild-wasm@0.27.2/esbuild.wasm',
            });
            this.initialized_ = true;
        } catch (err) {
            if (String(err).includes('Cannot call "initialize" more than once')) {
                this.initialized_ = true;
            } else {
                throw err;
            }
        }
    }

    async discoverScripts(): Promise<string[]> {
        const fs = getNativeFS();
        if (!fs) {
            console.warn('ScriptLoader: NativeFS not available');
            return [];
        }

        const scriptsPath = joinPath(this.projectDir_, 'assets/scripts');

        try {
            const exists = await fs.exists(scriptsPath);
            if (!exists) {
                return [];
            }

            const entries = await fs.listDirectoryDetailed(scriptsPath);
            return entries
                .filter(e => !e.isDirectory && e.name.endsWith('.ts'))
                .map(e => joinPath(scriptsPath, e.name));
        } catch (err) {
            console.error('ScriptLoader: Failed to discover scripts:', err);
            return [];
        }
    }

    async compile(): Promise<boolean> {
        const fs = getNativeFS();
        if (!fs) {
            console.warn('ScriptLoader: NativeFS not available');
            return false;
        }

        const scripts = await this.discoverScripts();
        if (scripts.length === 0) {
            console.log('ScriptLoader: No scripts found');
            this.lastCompiled_ = null;
            return true;
        }

        console.log('ScriptLoader: Compiling scripts:', scripts);

        try {
            const entryContent = scripts
                .map(p => `import "${p}";`)
                .join('\n');

            const result = await esbuild.build({
                stdin: {
                    contents: entryContent,
                    loader: 'ts',
                    resolveDir: joinPath(this.projectDir_, 'assets/scripts'),
                },
                bundle: true,
                format: 'esm',
                write: false,
                platform: 'browser',
                target: 'es2020',
                external: ['esengine'],
                plugins: [
                    virtualFsPlugin({
                        fs,
                        projectDir: this.projectDir_,
                    }),
                ],
            });

            if (result.errors.length > 0) {
                const errors: CompileError[] = result.errors.map(e => ({
                    file: e.location?.file || 'unknown',
                    line: e.location?.line || 0,
                    column: e.location?.column || 0,
                    message: e.text,
                }));
                console.error('ScriptLoader: Compilation errors:', errors);
                this.onCompileError_?.(errors);
                return false;
            }

            this.lastCompiled_ = result.outputFiles?.[0]?.text ?? null;
            console.log('ScriptLoader: Scripts compiled successfully');
            this.onCompileSuccess_?.();
            return true;
        } catch (err) {
            console.error('ScriptLoader: Compilation failed:', err);
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

    async reload(): Promise<boolean> {
        return this.compile();
    }

    // =========================================================================
    // Member Variables
    // =========================================================================

    private projectPath_: string;
    private projectDir_: string;
    private initialized_ = false;
    private lastCompiled_: string | null = null;
    private onCompileError_?: (errors: CompileError[]) => void;
    private onCompileSuccess_?: () => void;
}
