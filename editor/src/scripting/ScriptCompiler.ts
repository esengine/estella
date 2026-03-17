/**
 * @file    ScriptCompiler.ts
 * @brief   Unified script compilation pipeline for Play Mode and Build export
 */

import * as esbuild from 'esbuild-wasm/esm/browser';
import type { NativeFS, CompileTarget } from './types';
import { sdkResolvePlugin, virtualFsPlugin } from './esbuildPlugins';
import { findTsFiles, EDITOR_ONLY_DIRS } from './ScriptLoader';
import { discoverPluginPackages, type DiscoveredPlugin } from '../extension/pluginDiscovery';
import { joinPath } from '../utils/path';
import { initializeEsbuild } from '../builder/ArtifactBuilder';

// =============================================================================
// ScriptCompiler
// =============================================================================

export class ScriptCompiler {
    private ctx_: esbuild.BuildContext | null = null;
    private lastEntry_: string | null = null;
    private lastTargetKey_: string | null = null;

    // =========================================================================
    // Script & Plugin Discovery
    // =========================================================================

    async discoverScripts(fs: NativeFS, projectDir: string): Promise<string[]> {
        const srcPath = joinPath(projectDir, 'src');
        try {
            if (!await fs.exists(srcPath)) return [];
            return await findTsFiles(fs, srcPath, EDITOR_ONLY_DIRS);
        } catch (err) {
            console.error('ScriptCompiler: Failed to discover scripts:', err);
            return [];
        }
    }

    async discoverPlugins(
        fs: NativeFS,
        projectDir: string,
        entry: 'main' | 'editor',
    ): Promise<DiscoveredPlugin[]> {
        try {
            return await discoverPluginPackages(fs, projectDir, entry);
        } catch (err) {
            console.warn('ScriptCompiler: Plugin discovery failed:', err);
            return [];
        }
    }

    buildEntry(
        plugins: DiscoveredPlugin[],
        scriptPaths: string[],
        preamble?: string,
    ): string {
        const parts: string[] = [];
        if (preamble) parts.push(preamble);
        for (const p of plugins) {
            parts.push(`import "${p.entryPath}";`);
        }
        for (const s of scriptPaths) {
            parts.push(`import "${s}";`);
        }
        return parts.join('\n');
    }

    // =========================================================================
    // One-shot Compilation (Build export path)
    // =========================================================================

    async compile(
        fs: NativeFS,
        projectDir: string,
        entryContent: string,
        target: CompileTarget,
    ): Promise<string> {
        await initializeEsbuild();

        const result = await esbuild.build({
            ...this.buildOptions_(fs, projectDir, entryContent, target),
        });

        const output = result.outputFiles?.[0]?.text;
        if (!output) {
            throw new Error('esbuild produced no output');
        }
        return output;
    }

    // =========================================================================
    // Incremental Compilation (Play Mode path)
    // =========================================================================

    async compileIncremental(
        fs: NativeFS,
        projectDir: string,
        entryContent: string,
        target: CompileTarget,
    ): Promise<esbuild.BuildResult> {
        await initializeEsbuild();

        const targetKey = this.targetKey_(target);
        const entryChanged = entryContent !== this.lastEntry_;
        const targetChanged = targetKey !== this.lastTargetKey_;

        if (this.ctx_ && (entryChanged || targetChanged)) {
            await this.ctx_.dispose();
            this.ctx_ = null;
        }

        if (!this.ctx_) {
            this.ctx_ = await esbuild.context({
                ...this.buildOptions_(fs, projectDir, entryContent, target),
            });
            this.lastEntry_ = entryContent;
            this.lastTargetKey_ = targetKey;
        }

        return this.ctx_.rebuild();
    }

    invalidateIncremental(): void {
        // Force context recreation on next compileIncremental call
        this.lastEntry_ = null;
    }

    async dispose(): Promise<void> {
        if (this.ctx_) {
            await this.ctx_.dispose();
            this.ctx_ = null;
        }
        this.lastEntry_ = null;
        this.lastTargetKey_ = null;
    }

    // =========================================================================
    // Private
    // =========================================================================

    private buildOptions_(
        fs: NativeFS,
        projectDir: string,
        entryContent: string,
        target: CompileTarget,
    ): esbuild.BuildOptions {
        const preferEsm = target.sdk.type === 'loader'
            ? (target.sdk.preferEsmEntry ?? true)
            : true;

        const plugins: esbuild.Plugin[] = [
            sdkResolvePlugin(target.sdk),
            virtualFsPlugin({ fs, projectDir, preferEsmEntry: preferEsm }),
        ];

        return {
            stdin: {
                contents: entryContent,
                loader: 'ts',
                resolveDir: joinPath(projectDir, 'src'),
            },
            bundle: true,
            format: target.format,
            write: false,
            platform: 'browser',
            target: 'es2020',
            treeShaking: true,
            sourcemap: target.sourcemap,
            minify: target.minify,
            define: target.defines,
            plugins,
        };
    }

    private targetKey_(target: CompileTarget): string {
        return `${target.format}|${target.sdk.type}|${target.minify ?? false}|${target.sourcemap ?? false}`;
    }
}
