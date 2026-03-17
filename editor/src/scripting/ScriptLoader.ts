/**
 * @file    ScriptLoader.ts
 * @brief   Load and compile user TypeScript scripts for preview
 */

import * as esengineModule from 'esengine';
import type { NativeFS, ScriptLoaderOptions, CompileError, CompileTarget } from './types';
import { ComponentSwapper } from './ComponentSwapper';
import type { ScriptContent } from './ComponentSwapper';
import { ScriptCompiler } from './ScriptCompiler';
import {
    extractComponentDefs,
    registerComponentEntries,
    safeParseObjectLiteral,
    extractObjectLiteral,
    type ComponentDefEntry,
} from './componentExtraction';
import { getEditorContext } from '../context/EditorContext';
import { normalizePath, joinPath, getProjectDir } from '../utils/path';

// =============================================================================
// Native FS Access
// =============================================================================

function getNativeFS(): NativeFS | null {
    return getEditorContext().fs ?? null;
}

// =============================================================================
// Play Mode Compile Target
// =============================================================================

const PLAY_MODE_TARGET: CompileTarget = {
    format: 'esm',
    sdk: {
        type: 'shim',
        modules: new Map<string, Record<string, unknown>>([
            ['esengine', esengineModule as unknown as Record<string, unknown>],
        ]),
    },
    sourcemap: 'inline',
};

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
        this.initialized_ = true;
    }

    async discoverScripts(): Promise<string[]> {
        const fs = getNativeFS();
        if (!fs) {
            console.warn('ScriptLoader: NativeFS not available');
            return [];
        }
        return this.compiler_.discoverScripts(fs, this.projectDir_);
    }

    async compile(): Promise<boolean> {
        if (this.compiling_) {
            this.pendingCompile_ = true;
            return false;
        }
        this.compiling_ = true;
        this.pendingCompile_ = false;

        try {
            return await this.compileInternal_();
        } finally {
            this.compiling_ = false;
            if (this.pendingCompile_) {
                this.pendingCompile_ = false;
                void this.compile();
            }
        }
    }

    private async compileInternal_(): Promise<boolean> {
        const fs = getNativeFS();
        if (!fs) {
            console.warn('ScriptLoader: NativeFS not available');
            return false;
        }

        const scripts = await this.compiler_.discoverScripts(fs, this.projectDir_);
        const plugins = await this.compiler_.discoverPlugins(fs, this.projectDir_, 'main');

        if (scripts.length === 0 && plugins.length === 0) {
            this.swapper_.prepare([]);
            this.swapper_.swap();
            this.lastCompiled_ = null;
            this.onCompileSuccess_?.();
            return true;
        }

        try {
            const entryContent = this.compiler_.buildEntry(plugins, scripts);

            const result = await this.compiler_.compileIncremental(
                fs,
                this.projectDir_,
                entryContent,
                PLAY_MODE_TARGET,
            );

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
            const scriptContents = await this.readScriptContents_(fs, scripts);
            this.swapper_.prepare(scriptContents);
            this.swapper_.swap();
            this.onCompileSuccess_?.();
            return true;
        } catch (err: any) {
            console.error('ScriptLoader: Compilation failed:', err);
            const esbuildErrors = err?.errors as Array<{ location?: { file?: string; line?: number; column?: number }; text: string }> | undefined;
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

    async reload(): Promise<boolean> {
        this.compiler_.invalidateIncremental();
        return this.compile();
    }

    async watch(): Promise<void> {
        const fs = getNativeFS();
        if (!fs) return;

        this.unwatch();

        const srcPath = joinPath(this.projectDir_, 'src');
        if (!await fs.exists(srcPath)) return;

        this.unwatchFn_ = await fs.watchDirectory(
            srcPath,
            (event) => {
                const hasTsChange = event.paths.some(p =>
                    normalizePath(p).endsWith('.ts')
                );
                if (!hasTsChange) return;

                if (this.recompileTimer_ !== null) {
                    clearTimeout(this.recompileTimer_);
                }
                this.recompileTimer_ = window.setTimeout(() => {
                    this.recompileTimer_ = null;
                    this.compile();
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
        void this.compiler_.dispose();
    }

    // =========================================================================
    // Private Helpers
    // =========================================================================

    private async readScriptContents_(
        fs: { readFile(path: string): Promise<string | null> },
        scripts: string[]
    ): Promise<ScriptContent[]> {
        const reads = await Promise.all(
            scripts.map(async (path) => {
                const content = await fs.readFile(path);
                return content ? { path, content } : null;
            })
        );
        return reads.filter((r): r is ScriptContent => r !== null);
    }

    // =========================================================================
    // Member Variables
    // =========================================================================

    private projectPath_: string;
    private projectDir_: string;
    private initialized_ = false;
    private lastCompiled_: string | null = null;
    private unwatchFn_: (() => void) | null = null;
    private recompileTimer_: number | null = null;
    private compiling_ = false;
    private pendingCompile_ = false;
    private compiler_ = new ScriptCompiler();
    private swapper_ = new ComponentSwapper();
    private onCompileError_?: (errors: CompileError[]) => void;
    private onCompileSuccess_?: () => void;
}

// Re-export script discovery utilities
export { findTsFiles, IGNORED_SCRIPT_DIRS, EDITOR_ONLY_DIRS } from './scriptDiscovery';

function extractAndRegisterComponents(source: string): string[] {
    const entries = extractComponentDefs(source);
    registerComponentEntries(entries);
    return entries.map(e => e.name);
}

export { extractAndRegisterComponents, extractComponentDefs, safeParseObjectLiteral, extractObjectLiteral };
export type { ComponentDefEntry };
