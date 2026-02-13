/**
 * @file    ArtifactBuilder.ts
 * @brief   Shared build artifact pipeline: asset collection, atlas packing, material compilation
 */

import * as esbuild from 'esbuild-wasm/esm/browser';
import type { BuildConfig } from '../types/BuildTypes';
import type { BuildArtifact } from './PlatformEmitter';
import type { NativeFS } from '../types/NativeFS';
import { BuildProgressReporter } from './BuildProgress';
import { AssetExportConfigService, BuildAssetCollector } from './AssetCollector';
import { TextureAtlasPacker } from './TextureAtlas';
import { AssetLibrary } from '../asset/AssetLibrary';
import { compileMaterials } from './MaterialCompiler';
import { normalizePath, joinPath, isAbsolutePath, getParentDir } from '../utils/path';
import { getEsbuildWasmURL } from '../context/EditorContext';

// =============================================================================
// buildArtifact
// =============================================================================

export async function buildArtifact(
    fs: NativeFS,
    projectDir: string,
    config: BuildConfig,
    progress: BuildProgressReporter
): Promise<BuildArtifact> {
    const assetLibrary = new AssetLibrary();
    await assetLibrary.initialize(projectDir, fs);
    progress.log('info', 'Asset library initialized');

    const configService = new AssetExportConfigService(projectDir, fs);
    const exportConfig = await configService.load();

    const collector = new BuildAssetCollector(fs, projectDir, assetLibrary);
    const assetPaths = await collector.collect(config, exportConfig);

    progress.setPhase('processing_assets');
    progress.setCurrentTask('Packing texture atlas...', 0);

    const imagePaths = [...assetPaths].filter(p => {
        const ext = p.split('.').pop()?.toLowerCase() ?? '';
        return ext === 'png' || ext === 'jpg' || ext === 'jpeg';
    });

    const sceneDataList: Array<{ name: string; data: Record<string, unknown> }> = [];
    for (const scenePath of config.scenes) {
        const fullPath = isAbsolutePath(scenePath)
            ? normalizePath(scenePath)
            : joinPath(projectDir, scenePath);
        const content = await fs.readFile(fullPath);
        if (content) {
            const name = scenePath.replace(/.*\//, '').replace('.esscene', '');
            sceneDataList.push({ name, data: JSON.parse(content) });
        }
    }

    const packer = new TextureAtlasPacker(fs, projectDir, assetLibrary);
    const atlasResult = await packer.pack(imagePaths, sceneDataList, 2048, [...assetPaths]);
    const packedPaths = new Set<string>(atlasResult.frameMap.keys());

    if (atlasResult.pages.length > 0) {
        progress.log('info', `Packed ${atlasResult.frameMap.size} textures into ${atlasResult.pages.length} atlas page(s)`);
    }

    progress.setCurrentTask('Compiling materials...', 20);
    const compiledMaterials = await compileMaterials(fs, projectDir, assetLibrary, config, exportConfig);
    progress.log('info', `Compiled ${compiledMaterials.length} material(s)`);

    progress.setCurrentTask('Processing scenes...', 40);
    const scenes = new Map<string, Record<string, unknown>>();
    for (const scenePath of config.scenes) {
        const fullPath = isAbsolutePath(scenePath)
            ? normalizePath(scenePath)
            : joinPath(projectDir, scenePath);
        const content = await fs.readFile(fullPath);
        if (content) {
            const name = scenePath.replace(/.*\//, '').replace('.esscene', '');
            const sceneData = JSON.parse(content);
            packer.rewriteSceneData(sceneData, atlasResult, '');
            scenes.set(name, sceneData);
        }
    }

    return {
        scenes,
        assetPaths,
        atlasResult,
        packedPaths,
        compiledMaterials,
        assetLibrary,
    };
}

// =============================================================================
// Shared esbuild utilities
// =============================================================================

export type SdkModuleLoader = (path: string) => Promise<{ contents: string; loader: esbuild.Loader }>;

export async function initializeEsbuild(): Promise<void> {
    try {
        await esbuild.initialize({ wasmURL: getEsbuildWasmURL() });
    } catch (err) {
        if (!String(err).includes('Cannot call "initialize" more than once')) {
            throw err;
        }
    }
}

export function createBuildVirtualFsPlugin(
    fs: NativeFS,
    projectDir: string,
    loadSdkModule: SdkModuleLoader,
    preferEsmEntry = true
): esbuild.Plugin {
    return {
        name: 'virtual-fs',
        setup(build) {
            build.onResolve({ filter: /^esengine(\/wasm)?$/ }, (args) => ({
                path: args.path,
                namespace: 'esengine-sdk',
            }));

            build.onLoad({ filter: /.*/, namespace: 'esengine-sdk' }, async (args) => {
                return loadSdkModule(args.path);
            });

            build.onResolve({ filter: /.*/ }, async (args) => {
                if (args.kind === 'entry-point') {
                    return { path: args.path, namespace: 'virtual' };
                }

                let resolvedPath = args.path;

                if (isAbsolutePath(args.path)) {
                    resolvedPath = normalizePath(args.path);
                } else if (args.path.startsWith('.')) {
                    const baseDir = args.importer ? getParentDir(args.importer) : args.resolveDir;
                    resolvedPath = joinPath(baseDir, args.path);
                } else {
                    const pkgPath = joinPath(projectDir, 'node_modules', args.path, 'package.json');
                    const pkgContent = await fs.readFile(pkgPath);
                    if (pkgContent) {
                        try {
                            const pkg = JSON.parse(pkgContent);
                            let entry = preferEsmEntry
                                ? (pkg.module || pkg.main || 'index.js')
                                : (pkg.main || 'index.js');
                            if (pkg.exports) {
                                const root = pkg.exports['.'];
                                if (typeof root === 'string') {
                                    entry = root;
                                } else if (root?.import) {
                                    entry = root.import;
                                } else if (root?.default) {
                                    entry = root.default;
                                }
                            }
                            resolvedPath = joinPath(projectDir, 'node_modules', args.path, entry);
                        } catch {
                            throw new Error(`Failed to parse package.json for: ${args.path}`);
                        }
                    } else {
                        throw new Error(`Module not found: ${args.path}. Please install it with npm.`);
                    }
                }

                if (!resolvedPath.endsWith('.ts') && !resolvedPath.endsWith('.js')) {
                    if (await fs.exists(resolvedPath + '.ts')) {
                        resolvedPath += '.ts';
                    } else if (await fs.exists(resolvedPath + '.js')) {
                        resolvedPath += '.js';
                    } else if (await fs.exists(joinPath(resolvedPath, 'index.ts'))) {
                        resolvedPath = joinPath(resolvedPath, 'index.ts');
                    } else if (await fs.exists(joinPath(resolvedPath, 'index.js'))) {
                        resolvedPath = joinPath(resolvedPath, 'index.js');
                    } else {
                        resolvedPath += '.ts';
                    }
                }

                return { path: resolvedPath, namespace: 'virtual' };
            });

            build.onLoad({ filter: /.*/, namespace: 'virtual' }, async (args) => {
                const content = await fs.readFile(args.path);
                if (content === null) {
                    return { contents: '', loader: 'ts' };
                }
                const loader = args.path.endsWith('.ts') ? 'ts' : 'js';
                return { contents: content, loader };
            });
        },
    };
}
