/**
 * @file    ScriptLoader.ts
 * @brief   Load and compile user TypeScript scripts for preview
 */

import * as esbuild from 'esbuild-wasm/esm/browser';
import { defineComponent, defineTag, clearUserComponents } from 'esengine';
import { virtualFsPlugin } from './esbuildPlugins';
import type { NativeFS, ScriptLoaderOptions, CompileError } from './types';
import { clearScriptComponents } from '../schemas/ComponentSchemas';
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
        } catch {
            // esbuild is a singleton; already initialized is fine
        }
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
        const fs = getNativeFS();
        if (!fs) {
            console.warn('ScriptLoader: NativeFS not available');
            return false;
        }

        clearUserComponents();
        clearScriptComponents();

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
                    resolveDir: joinPath(this.projectDir_, 'src'),
                },
                bundle: true,
                format: 'esm',
                write: false,
                sourcemap: 'inline',
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
            await this.registerDiscoveredComponents(fs, scripts);
            console.log('ScriptLoader: Scripts compiled successfully');
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
    // Component Discovery
    // =========================================================================

    private async registerDiscoveredComponents(
        fs: { readFile(path: string): Promise<string | null> },
        scripts: string[]
    ): Promise<void> {
        const sourceMap = new Map<string, string>();

        for (const scriptPath of scripts) {
            const content = await fs.readFile(scriptPath);
            if (!content) continue;
            const names = extractAndRegisterComponents(content);
            for (const name of names) {
                sourceMap.set(name, scriptPath);
            }
        }

        if (typeof window !== 'undefined') {
            window.__esengine_componentSourceMap = sourceMap;
        }
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

// =============================================================================
// Component Extraction
// =============================================================================

const DEFINE_COMPONENT_RE = /defineComponent\s*(?:<[^>]*>\s*)?\(\s*['"]([^'"]+)['"]\s*,/g;
const DEFINE_TAG_RE = /defineTag\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function extractAndRegisterComponents(source: string): string[] {
    const names: string[] = [];

    DEFINE_COMPONENT_RE.lastIndex = 0;
    let match;
    while ((match = DEFINE_COMPONENT_RE.exec(source)) !== null) {
        const name = match[1];
        const rest = source.substring(match.index + match[0].length);
        const objStr = extractObjectLiteral(rest);
        if (!objStr) continue;
        try {
            const defaults = new Function(`return ${objStr}`)() as Record<string, unknown>;
            defineComponent(name, defaults);
            names.push(name);
        } catch { /* skip complex expressions */ }
    }

    DEFINE_TAG_RE.lastIndex = 0;
    while ((match = DEFINE_TAG_RE.exec(source)) !== null) {
        defineTag(match[1]);
        names.push(match[1]);
    }

    return names;
}

function extractObjectLiteral(source: string): string | null {
    const trimmed = source.trimStart();
    if (trimmed[0] !== '{') return null;

    let depth = 0;
    let inString = false;
    let quote = '';

    for (let i = 0; i < trimmed.length; i++) {
        const ch = trimmed[i];

        if (inString) {
            if (ch === quote && trimmed[i - 1] !== '\\') inString = false;
            continue;
        }

        if (ch === '"' || ch === "'" || ch === '`') {
            inString = true;
            quote = ch;
            continue;
        }

        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return trimmed.substring(0, i + 1);
        }
    }

    return null;
}
