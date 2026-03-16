/**
 * @file    ScriptLoader.ts
 * @brief   Load and compile user TypeScript scripts for preview
 */

import * as esbuild from 'esbuild-wasm/esm/browser';
import * as esengineModule from 'esengine';
import { virtualFsPlugin, playModeShimPlugin } from './esbuildPlugins';
import type { NativeFS, ScriptLoaderOptions, CompileError } from './types';
import { ComponentSwapper } from './ComponentSwapper';
import type { ScriptContent } from './ComponentSwapper';
import {
    extractComponentDefs,
    registerComponentEntries,
    safeParseObjectLiteral,
    extractObjectLiteral,
    type ComponentDefEntry,
} from './componentExtraction';
import { getEditorContext } from '../context/EditorContext';
import { initializeEsbuild } from '../builder/ArtifactBuilder';
import { normalizePath, joinPath, getProjectDir } from '../utils/path';
import { discoverPluginPackages } from '../extension/pluginDiscovery';

// =============================================================================
// Native FS Access
// =============================================================================

function getNativeFS(): NativeFS | null {
    return getEditorContext().fs ?? null;
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
        await initializeEsbuild();
        this.initialized_ = true;
    }

    async discoverScripts(): Promise<string[]> {
        const fs = getNativeFS();
        if (!fs) {
            console.warn('ScriptLoader: NativeFS not available');
            return [];
        }

        const srcPath = joinPath(this.projectDir_, 'src');

        try {
            if (!await fs.exists(srcPath)) return [];
            return await findTsFiles(fs, srcPath, EDITOR_ONLY_DIRS);
        } catch (err) {
            console.error('ScriptLoader: Failed to discover scripts:', err);
            return [];
        }
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

        const scripts = await this.discoverScripts();

        const pluginImports: string[] = [];
        try {
            const plugins = await discoverPluginPackages(fs, this.projectDir_, 'main');
            for (const p of plugins) {
                pluginImports.push(`import "${p.entryPath}";`);
            }
        } catch (err) {
            console.warn('ScriptLoader: Plugin discovery failed:', err);
        }

        if (scripts.length === 0 && pluginImports.length === 0) {
            this.swapper_.prepare([]);
            this.swapper_.swap();
            this.lastCompiled_ = null;
            this.onCompileSuccess_?.();
            return true;
        }

        try {
            const localImports = scripts.map(p => `import "${p}";`).join('\n');
            const entryContent = pluginImports.join('\n') + '\n' + localImports;

            const shimModules = new Map<string, Record<string, unknown>>([
                ['esengine', esengineModule as unknown as Record<string, unknown>],
            ]);

            const result = await esbuild.build({
                stdin: {
                    contents: entryContent,
                    loader: 'ts',
                    resolveDir: joinPath(this.projectDir_, 'src'),
                },
                bundle: true,
                format: 'esm',
                write: false,
                sourcemap: 'inline',
                platform: 'browser',
                target: 'es2020',
                plugins: [
                    playModeShimPlugin(shimModules),
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
            const scriptContents = await this.readScriptContents_(fs, scripts);
            this.swapper_.prepare(scriptContents);
            this.swapper_.swap();
            this.onCompileSuccess_?.();
            return true;
        } catch (err: any) {
            console.error('ScriptLoader: Compilation failed:', err);
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

    async reload(): Promise<boolean> {
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
    private swapper_ = new ComponentSwapper();
    private onCompileError_?: (errors: CompileError[]) => void;
    private onCompileSuccess_?: () => void;
}

// =============================================================================
// Script Discovery
// =============================================================================

const IGNORED_SCRIPT_DIRS = new Set(['node_modules', 'dist', 'build']);
const EDITOR_ONLY_DIRS = new Set(['editor']);

interface DirListable {
    listDirectoryDetailed(path: string): Promise<{ name: string; isDirectory: boolean }[]>;
}

async function findTsFiles(
    fs: DirListable,
    dir: string,
    excludeDirs?: Set<string>,
): Promise<string[]> {
    const results: string[] = [];
    const entries = await fs.listDirectoryDetailed(dir);
    for (const e of entries) {
        if (e.isDirectory) {
            if (!IGNORED_SCRIPT_DIRS.has(e.name) && !e.name.startsWith('.')
                && !(excludeDirs?.has(e.name))) {
                results.push(...await findTsFiles(fs, joinPath(dir, e.name), excludeDirs));
            }
        } else if (e.name.endsWith('.ts')) {
            results.push(joinPath(dir, e.name));
        }
    }
    return results;
}

export { findTsFiles, IGNORED_SCRIPT_DIRS, EDITOR_ONLY_DIRS };

// Re-export for backward compatibility (used in tests)
function extractAndRegisterComponents(source: string): string[] {
    const entries = extractComponentDefs(source);
    registerComponentEntries(entries);
    return entries.map(e => e.name);
}

export { extractAndRegisterComponents, extractComponentDefs, safeParseObjectLiteral, extractObjectLiteral };
export type { ComponentDefEntry };
