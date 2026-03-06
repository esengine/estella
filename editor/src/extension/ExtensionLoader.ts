/**
 * @file    ExtensionLoader.ts
 * @brief   Load and compile user editor extensions from project editor/ directory
 */

import * as esbuild from 'esbuild-wasm/esm/browser';
import { editorShimPlugin, esengineShimPlugin, virtualFsPlugin } from '../scripting/esbuildPlugins';
import { findTsFiles } from '../scripting/ScriptLoader';
import type { NativeFS, CompileError } from '../scripting/types';
import { getEditorContext } from '../context/EditorContext';
import { initializeEsbuild } from '../builder/ArtifactBuilder';
import { ExtensionContext } from './ExtensionContext';
import { setEditorAPI } from './editorAPI';
import { getEditorContainer } from '../container';
import { normalizePath, joinPath, getProjectDir } from '../utils/path';
import { discoverPluginPackages } from './pluginDiscovery';
import { getSettingsValue } from '../settings/SettingsRegistry';

// =============================================================================
// Native FS Access
// =============================================================================

function getNativeFS(): NativeFS | null {
    return getEditorContext().fs ?? null;
}

// =============================================================================
// Plugin Info
// =============================================================================

export interface ExtensionPluginInfo {
    id: string;
    type: 'local' | 'npm';
    name: string;
    version?: string;
    description?: string;
    status: 'loaded' | 'error' | 'disabled';
    error?: string;
}

const PLUGIN_ERRORS_KEY = '__esengine_plugin_errors__';

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
        await initializeEsbuild();
        this.initialized_ = true;
    }

    getDiscoveredPlugins(): ExtensionPluginInfo[] {
        return this.discoveredPlugins_;
    }

    async discover(): Promise<string[]> {
        const fs = getNativeFS();
        if (!fs) return [];

        const srcPath = joinPath(this.projectDir_, 'src');
        try {
            if (!await fs.exists(srcPath)) return [];
            return await findTsFiles(fs, srcPath);
        } catch (err) {
            console.error('ExtensionLoader: Failed to discover extensions:', err);
            return [];
        }
    }

    async compile(): Promise<boolean> {
        const fs = getNativeFS();
        if (!fs) return false;

        const disabled = getSettingsValue<string[]>('extensions.disabled') ?? [];
        const disabledSet = new Set(disabled);

        const scripts = await this.discover();
        const infos: ExtensionPluginInfo[] = [];

        const pluginImports: string[] = [];
        try {
            const plugins = await discoverPluginPackages(fs, this.projectDir_, 'editor');
            for (const p of plugins) {
                const info: ExtensionPluginInfo = {
                    id: p.packageName,
                    type: 'npm',
                    name: p.displayName ?? p.packageName,
                    version: p.version,
                    description: p.description,
                    status: disabledSet.has(p.packageName) ? 'disabled' : 'loaded',
                };
                infos.push(info);
                if (info.status !== 'disabled') {
                    pluginImports.push(
                        `try { await import("${p.entryPath}"); } catch(e) { (window.${PLUGIN_ERRORS_KEY} ??= new Map()).set("${p.packageName}", String(e)); console.error("[plugin] ${p.packageName} failed:", e); }`
                    );
                }
            }
        } catch (err) {
            console.warn('ExtensionLoader: Plugin discovery failed:', err);
        }

        for (const path of scripts) {
            const name = path.split('/').pop() ?? path;
            infos.push({
                id: path,
                type: 'local',
                name,
                status: disabledSet.has(path) ? 'disabled' : 'loaded',
            });
        }

        this.discoveredPlugins_ = infos;

        const activeScripts = scripts.filter(p => !disabledSet.has(p));
        if (activeScripts.length === 0 && pluginImports.length === 0) {
            this.lastCompiled_ = null;
            return true;
        }

        try {
            const localImports = activeScripts.map(p => `import "${p}";`).join('\n');
            const entryContent = pluginImports.join('\n') + '\n' + localImports;

            const result = await esbuild.build({
                stdin: {
                    contents: entryContent,
                    loader: 'ts',
                    resolveDir: joinPath(this.projectDir_, 'src'),
                },
                bundle: true,
                format: 'esm',
                write: false,
                sourcemap: true,
                platform: 'browser',
                target: 'es2020',
                define: {
                    'process.env.EDITOR': 'true',
                },
                plugins: [
                    editorShimPlugin(),
                    esengineShimPlugin(),
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
            if (!this.lastCompiled_) return true;
            this.currentContext_ = new ExtensionContext();
            setEditorAPI(this.currentContext_.createAPI(this.baseAPI_, getEditorContainer()));
            const executed = await this.execute();
            this.collectPluginErrors_();
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

    private collectPluginErrors_(): void {
        const errors = (window as any)[PLUGIN_ERRORS_KEY] as Map<string, string> | undefined;
        if (!errors) return;
        for (const info of this.discoveredPlugins_) {
            const err = errors.get(info.id);
            if (err) {
                info.status = 'error';
                info.error = err;
            }
        }
        delete (window as any)[PLUGIN_ERRORS_KEY];
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
    private lastCompiled_: string | null = null;
    private lastSourcemap_: string | null = null;
    private currentBlobUrl_: string | null = null;
    private currentContext_: ExtensionContext | null = null;
    private unwatchFn_: (() => void) | null = null;
    private recompileTimer_: number | null = null;
    private discoveredPlugins_: ExtensionPluginInfo[] = [];
    private onCompileError_?: (errors: CompileError[]) => void;
    private onCompileSuccess_?: () => void;
    private onCleanup_?: () => void;
    private onAfterReload_?: () => void;
}
