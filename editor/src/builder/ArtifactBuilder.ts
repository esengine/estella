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
import { AssetLibrary, isUUID, getComponentRefFields } from '../asset/AssetLibrary';
import { BuildCache } from './BuildCache';
import { getAssetType, toAddressableType } from '../asset/AssetTypes';
import { compileMaterials } from './MaterialCompiler';
import { convertPrefabAssetRefs, deserializePrefab } from '../prefab';
import { normalizePath, joinPath, isAbsolutePath, getParentDir } from '../utils/path';
import { getEsbuildWasmURL } from '../context/EditorContext';

// =============================================================================
// buildArtifact
// =============================================================================

export async function buildArtifact(
    fs: NativeFS,
    projectDir: string,
    config: BuildConfig,
    progress: BuildProgressReporter,
    buildCache?: BuildCache
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

    let atlasResult;
    let atlasInputHash: string | undefined;
    if (buildCache) {
        const cacheData = await buildCache.loadCache(config.id || 'default');
        atlasInputHash = await buildCache.computeAtlasInputHash(imagePaths);

        let cachedAtlas = null;
        if (cacheData?.atlasPages) {
            const deserializedPages = buildCache.deserializeAtlasPages(cacheData.atlasPages);
            if (deserializedPages) {
                const frameMap = new Map();
                deserializedPages.forEach((page, pageIdx) => {
                    page.frames.forEach((frame: any) => {
                        frameMap.set(frame.path, { page: pageIdx, frame });
                    });
                });
                cachedAtlas = { pages: deserializedPages, frameMap };
            }
        }

        atlasResult = await packer.packIncremental(
            imagePaths,
            sceneDataList,
            cachedAtlas,
            atlasInputHash,
            cacheData?.atlasInputHash,
            2048,
            [...assetPaths]
        );

        if (cachedAtlas && atlasInputHash === cacheData?.atlasInputHash) {
            progress.log('info', `Reused cached atlas (${atlasResult.frameMap.size} textures)`);
        } else {
            progress.log('info', `Packed ${atlasResult.frameMap.size} textures into ${atlasResult.pages.length} atlas page(s)`);
        }
    } else {
        atlasResult = await packer.pack(imagePaths, sceneDataList, 2048, [...assetPaths]);

        if (atlasResult.pages.length > 0) {
            progress.log('info', `Packed ${atlasResult.frameMap.size} textures into ${atlasResult.pages.length} atlas page(s)`);
        }
    }

    const packedPaths = new Set<string>(atlasResult.frameMap.keys());

    progress.setCurrentTask('Compiling materials...', 20);
    const compiledMaterials = await compileMaterials(fs, projectDir, assetLibrary, assetPaths);
    progress.log('info', `Compiled ${compiledMaterials.length} material(s)`);

    progress.setCurrentTask('Processing scenes...', 40);
    const scenes = new Map<string, Record<string, unknown>>();
    for (const { name, data } of sceneDataList) {
        packer.rewriteSceneData(data, atlasResult, '');
        resolveSceneUUIDs(data, assetLibrary);
        scenes.set(name, data);
    }

    return {
        scenes,
        assetPaths,
        atlasResult,
        packedPaths,
        compiledMaterials,
        assetLibrary,
        atlasInputHash,
    };
}

function resolveSceneUUIDs(sceneData: Record<string, unknown>, assetLibrary: AssetLibrary): void {
    const entities = sceneData.entities as Array<{
        components: Array<{ type: string; data: Record<string, unknown> }>;
        prefab?: { prefabPath?: string };
    }> | undefined;

    if (!entities) return;

    for (const entity of entities) {
        for (const comp of entity.components || []) {
            if (!comp.data) continue;
            const refFields = getComponentRefFields(comp.type);
            if (!refFields) continue;
            for (const field of refFields) {
                const value = comp.data[field];
                if (typeof value === 'string' && isUUID(value)) {
                    const path = assetLibrary.getPath(value);
                    if (path) {
                        comp.data[field] = path;
                    }
                }
            }
        }
        if (entity.prefab?.prefabPath && isUUID(entity.prefab.prefabPath)) {
            const path = assetLibrary.getPath(entity.prefab.prefabPath);
            if (path) {
                entity.prefab.prefabPath = path;
            }
        }
    }

    const textureMetadata = sceneData.textureMetadata as Record<string, unknown> | undefined;
    if (textureMetadata) {
        const resolved: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(textureMetadata)) {
            if (isUUID(key)) {
                const path = assetLibrary.getPath(key);
                resolved[path ?? key] = value;
            } else {
                resolved[key] = value;
            }
        }
        sceneData.textureMetadata = resolved;
    }
}

// =============================================================================
// Shared esbuild utilities
// =============================================================================

export type SdkModuleLoader = (path: string) => Promise<{ contents: string; loader: esbuild.Loader }>;

let esbuildInitialized = false;

export async function initializeEsbuild(): Promise<void> {
    if (esbuildInitialized) return;
    try {
        await esbuild.initialize({ wasmURL: getEsbuildWasmURL() });
    } catch (e) {
        if (!String(e).includes('initialize')) {
            throw e;
        }
    }
    esbuildInitialized = true;
}

// =============================================================================
// Shared emitter utilities
// =============================================================================

export function arrayBufferToBase64(buffer: Uint8Array): string {
    const CHUNK_SIZE = 0x2000;
    const bytes = new Uint8Array(buffer);
    const chunks: string[] = [];
    for (let i = 0; i < bytes.byteLength; i += CHUNK_SIZE) {
        const slice = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.byteLength));
        chunks.push(String.fromCharCode.apply(null, slice as unknown as number[]));
    }
    return btoa(chunks.join(''));
}

export function generateAddressableManifest(
    artifact: BuildArtifact
): { version: string; groups: Record<string, { bundleMode: string; labels: string[]; assets: Record<string, unknown> }> } {
    const groupService = artifact.assetLibrary.getGroupService();
    const groups: Record<string, { bundleMode: string; labels: string[]; assets: Record<string, unknown> }> = {};

    const spineAtlasPaths = new Map<string, string>();
    for (const relativePath of artifact.assetPaths) {
        if (getAssetType(relativePath) === 'spine-atlas') {
            const dir = relativePath.substring(0, relativePath.lastIndexOf('/'));
            spineAtlasPaths.set(dir, relativePath);
        }
    }

    for (const relativePath of artifact.assetPaths) {
        if (relativePath.endsWith('.esshader')) continue;

        const editorType = getAssetType(relativePath);
        const addressableType = toAddressableType(editorType);
        if (!addressableType) continue;

        const uuid = artifact.assetLibrary.getUuid(relativePath);
        if (!uuid) continue;

        const entry = artifact.assetLibrary.getEntry(uuid);
        const groupName = entry?.group ?? 'default';

        if (!groups[groupName]) {
            const groupDef = groupService?.getGroup(groupName);
            groups[groupName] = {
                bundleMode: groupDef?.bundleMode ?? 'together',
                labels: groupDef?.labels ?? [],
                assets: {},
            };
        }

        let path = relativePath;
        const metadata: Record<string, unknown> = {};

        if (artifact.packedPaths.has(relativePath)) {
            const frame = artifact.atlasResult.frameMap.get(relativePath);
            if (frame) {
                path = `atlas_${frame.page}.png`;
                metadata.atlasPage = frame.page;
                metadata.atlasFrame = {
                    x: frame.frame.x,
                    y: frame.frame.y,
                    width: frame.frame.width,
                    height: frame.frame.height,
                };
            }
        }

        const compiledMat = artifact.compiledMaterials.find(m => m.relativePath === relativePath);
        if (compiledMat) {
            path = relativePath.replace(/\.esmaterial$/, '.json');
        }

        if (addressableType === 'spine') {
            const dir = relativePath.substring(0, relativePath.lastIndexOf('/'));
            const atlasPath = spineAtlasPaths.get(dir);
            if (atlasPath) {
                metadata.atlas = atlasPath;
            }
        }

        const asset: Record<string, unknown> = {
            path,
            type: addressableType,
            size: entry?.fileSize ?? 0,
            labels: entry ? [...entry.labels] : [],
        };
        if (entry?.address) {
            asset.address = entry.address;
        }
        if (Object.keys(metadata).length > 0) {
            asset.metadata = metadata;
        }

        groups[groupName].assets[uuid] = asset;
    }

    return { version: '2.0', groups };
}

export function convertPrefabWithResolvedRefs(
    prefabContent: string,
    artifact: BuildArtifact
): string {
    const prefab = deserializePrefab(prefabContent);
    const converted = convertPrefabAssetRefs(prefab, (value) => {
        if (isUUID(value)) {
            return artifact.assetLibrary.getPath(value) ?? value;
        }
        return value;
    });
    return JSON.stringify(converted);
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
