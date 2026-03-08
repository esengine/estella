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
import { TextureAtlasPacker, type AtlasResult } from './TextureAtlas';
import { AssetLibrary, isUUID, getComponentRefFields } from '../asset/AssetLibrary';
import { type TextureImporterSettings, getEffectiveImporter } from '../asset/ImporterTypes';
import { BuildCache } from './BuildCache';
import { getAssetType, toAddressableType } from '../asset/AssetTypes';
import { compileMaterials } from './MaterialCompiler';
import { convertPrefabAssetRefs, deserializePrefab } from '../prefab';
import type { PrefabData } from '../types/PrefabTypes';
import { toBuildPath, getComponentAssetFieldDescriptors, getComponentDefaults, registerAssetBuildTransform, getComponentSpineFieldDescriptor } from 'esengine';
import { SpineManager } from 'esengine/spine';
import { normalizePath, joinPath, isAbsolutePath, getParentDir } from '../utils/path';
import { getEsbuildWasmURL } from '../context/EditorContext';
import { getSettingsValue } from '../settings/SettingsRegistry';

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

    const imagePathCandidates = [...assetPaths].filter(p => {
        const ext = p.split('.').pop()?.toLowerCase() ?? '';
        return ext === 'png' || ext === 'jpg' || ext === 'jpeg';
    });

    const imagePaths: string[] = [];
    for (const p of imagePathCandidates) {
        const fullPath = isAbsolutePath(p) ? normalizePath(p) : joinPath(projectDir, p);
        if (await fs.exists(fullPath)) {
            imagePaths.push(p);
        } else {
            progress.log('warn', `Image not found, skipping: ${p}`);
        }
    }

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

    const packer = new TextureAtlasPacker(fs, projectDir, assetLibrary, config.platform);
    const atlasMaxSize = parseInt(getSettingsValue<string>('build.atlasMaxSize') ?? '2048', 10) || 2048;
    const atlasPadding = getSettingsValue<number>('build.atlasPadding') ?? 2;

    let atlasResult;
    let atlasInputHash: string | undefined;
    if (buildCache) {
        const cacheData = await buildCache.loadCache(config.id || 'default');
        const allTextureMetadata: Record<string, unknown> = {};
        for (const { data } of sceneDataList) {
            const meta = data.textureMetadata as Record<string, unknown> | undefined;
            if (meta) {
                Object.assign(allTextureMetadata, meta);
            }
        }
        const importerEntries = imagePaths.map(p => {
            const uuid = assetLibrary.getUuid(p);
            const entry = uuid ? assetLibrary.getEntry(uuid) : null;
            const effective = entry
                ? getEffectiveImporter(entry.importer, entry.platformOverrides, config.platform)
                : {};
            return { path: p, importer: effective };
        });
        const importerHash = await buildCache.computeImporterSettingsHash(importerEntries);
        const combinedMetadata = { ...allTextureMetadata, __importerHash: importerHash };
        atlasInputHash = await buildCache.computeAtlasInputHash(imagePaths, combinedMetadata);

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
            atlasMaxSize,
            [...assetPaths],
            atlasPadding
        );

        if (cachedAtlas && atlasInputHash === cacheData?.atlasInputHash) {
            progress.log('info', `Reused cached atlas (${atlasResult.frameMap.size} textures)`);
        } else {
            progress.log('info', `Packed ${atlasResult.frameMap.size} textures into ${atlasResult.pages.length} atlas page(s)`);
        }
    } else {
        atlasResult = await packer.pack(imagePaths, sceneDataList, atlasMaxSize, [...assetPaths], atlasPadding);

        if (atlasResult.pages.length > 0) {
            progress.log('info', `Packed ${atlasResult.frameMap.size} textures into ${atlasResult.pages.length} atlas page(s)`);
        }
    }

    const packedPaths = new Set<string>(atlasResult.frameMap.keys());

    const nonAtlasTextures = collectNonAtlasCapableTextures(sceneDataList, assetLibrary);
    for (const path of nonAtlasTextures) {
        packedPaths.delete(path);
    }

    progress.setCurrentTask('Compiling materials...', 20);
    const compiledMaterials = await compileMaterials(fs, projectDir, assetLibrary, assetPaths);
    progress.log('info', `Compiled ${compiledMaterials.length} material(s)`);

    progress.setCurrentTask('Processing scenes...', 40);
    const scenes = new Map<string, Record<string, unknown>>();
    for (const { name, data } of sceneDataList) {
        packer.rewriteSceneData(data, atlasResult, '');
        resolveSceneUUIDs(data, assetLibrary);
        embedTextureImporterSettings(data, assetLibrary, config.platform);
        scenes.set(name, data);
    }

    const spineVersions = await scanSpineVersions(fs, projectDir, sceneDataList, assetLibrary);

    return {
        scenes,
        assetPaths,
        atlasResult,
        packedPaths,
        compiledMaterials,
        assetLibrary,
        atlasInputHash,
        spineVersions,
    };
}

async function scanSpineVersions(
    fs: NativeFS,
    projectDir: string,
    sceneDataList: Array<{ name: string; data: Record<string, unknown> }>,
    assetLibrary: AssetLibrary,
): Promise<Set<string>> {
    const versions = new Set<string>();
    const scanned = new Set<string>();

    for (const { data } of sceneDataList) {
        const entities = data.entities as Array<{
            components: Array<{ type: string; data: Record<string, unknown> }>;
        }> | undefined;
        if (!entities) continue;

        for (const entity of entities) {
            for (const comp of entity.components || []) {
                const spineDesc = getComponentSpineFieldDescriptor(comp.type);
                if (!spineDesc || !comp.data) continue;

                let skelRef = comp.data[spineDesc.skeletonField] as string;
                if (!skelRef) continue;
                if (isUUID(skelRef)) {
                    skelRef = assetLibrary.getPath(skelRef) ?? skelRef;
                }
                if (scanned.has(skelRef)) continue;
                scanned.add(skelRef);

                const fullPath = joinPath(projectDir, skelRef);
                try {
                    const isBinary = skelRef.endsWith('.skel');
                    if (isBinary) {
                        const data = await fs.readBinaryFile(fullPath);
                        if (data) {
                            const ver = SpineManager.detectVersion(data);
                            if (ver) versions.add(ver);
                        }
                    } else {
                        const text = await fs.readFile(fullPath);
                        if (text) {
                            const ver = SpineManager.detectVersionJson(text);
                            if (ver) versions.add(ver);
                        }
                    }
                } catch { /* skip unreadable skeleton */ }
            }
        }
    }

    return versions;
}

function collectNonAtlasCapableTextures(
    sceneDataList: Array<{ name: string; data: Record<string, unknown> }>,
    assetLibrary: AssetLibrary,
): Set<string> {
    const result = new Set<string>();
    for (const { data } of sceneDataList) {
        const entities = data.entities as Array<{
            components: Array<{ type: string; data: Record<string, unknown> }>;
        }> | undefined;
        if (!entities) continue;
        for (const entity of entities) {
            for (const comp of entity.components || []) {
                if (!comp.data || isAtlasCapable(comp.type)) continue;
                const descriptors = getComponentAssetFieldDescriptors(comp.type);
                for (const desc of descriptors) {
                    if (desc.type !== 'texture') continue;
                    const ref = comp.data[desc.field];
                    if (typeof ref === 'string' && ref) {
                        const resolved = isUUID(ref)
                            ? (assetLibrary.getPath(ref) ?? ref)
                            : ref;
                        result.add(resolved);
                    }
                }
            }
        }
    }
    return result;
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
                        comp.data[field] = toBuildPath(path);
                    }
                }
            }
        }
        if (entity.prefab?.prefabPath) {
            if (isUUID(entity.prefab.prefabPath)) {
                const path = assetLibrary.getPath(entity.prefab.prefabPath);
                if (path) {
                    entity.prefab.prefabPath = toBuildPath(path);
                }
            } else {
                entity.prefab.prefabPath = toBuildPath(entity.prefab.prefabPath);
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

function embedTextureImporterSettings(sceneData: Record<string, unknown>, assetLibrary: AssetLibrary, platform: string): void {
    const entities = sceneData.entities as Array<{
        components: Array<{ type: string; data: Record<string, unknown> }>;
    }> | undefined;
    if (!entities) return;

    const settings: Record<string, { filterMode?: string; wrapMode?: string }> = {};

    for (const entity of entities) {
        for (const comp of entity.components || []) {
            const refFields = getComponentRefFields(comp.type);
            if (!refFields || !comp.data) continue;
            for (const field of refFields) {
                const value = comp.data[field];
                if (typeof value !== 'string' || !value) continue;
                if (settings[value]) continue;

                const uuid = isUUID(value) ? value : assetLibrary.getUuid(value);
                if (!uuid) continue;
                const entry = assetLibrary.getEntry(uuid);
                if (!entry || entry.type !== 'texture') continue;

                const effective = getEffectiveImporter(entry.importer, entry.platformOverrides, platform) as TextureImporterSettings;

                const hasNonDefault = (effective.filterMode && effective.filterMode !== 'linear') ||
                                      (effective.wrapMode && effective.wrapMode !== 'repeat');
                if (hasNonDefault) {
                    settings[entry.path] = {
                        filterMode: effective.filterMode,
                        wrapMode: effective.wrapMode,
                    };
                }
            }
        }
    }

    if (Object.keys(settings).length > 0) {
        sceneData.textureImporterSettings = settings;
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

        path = toBuildPath(path);

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

function transformPrefab(content: string, context: unknown): string {
    const artifact = context as BuildArtifact;
    const prefab = deserializePrefab(content);
    const converted = convertPrefabAssetRefs(prefab, (value) => {
        const resolved = isUUID(value)
            ? (artifact.assetLibrary.getPath(value) ?? value)
            : value;
        return toBuildPath(resolved);
    });
    rewritePrefabAtlasRefs(converted, artifact.atlasResult);
    return JSON.stringify(converted);
}

function transformAnimClip(content: string, context: unknown): string {
    const artifact = context as BuildArtifact;
    const data = JSON.parse(content);
    if (!Array.isArray(data.frames)) return content;
    for (const frame of data.frames) {
        if (typeof frame.texture !== 'string') continue;
        const resolved = isUUID(frame.texture)
            ? (artifact.assetLibrary.getPath(frame.texture) ?? frame.texture)
            : frame.texture;
        const buildPath = toBuildPath(resolved);
        const entry = artifact.atlasResult.frameMap.get(resolved)
            ?? artifact.atlasResult.frameMap.get(buildPath);
        if (entry) {
            frame.texture = `atlas_${entry.page}.png`;
            const page = artifact.atlasResult.pages[entry.page];
            frame.atlasFrame = {
                x: entry.frame.x,
                y: entry.frame.y,
                width: entry.frame.width,
                height: entry.frame.height,
                pageWidth: page.width,
                pageHeight: page.height,
            };
        } else {
            frame.texture = buildPath;
        }
    }
    return JSON.stringify(data);
}

registerAssetBuildTransform('prefab', transformPrefab);
registerAssetBuildTransform('anim-clip', transformAnimClip);

function isAtlasCapable(componentType: string): boolean {
    const defaults = getComponentDefaults(componentType);
    if (!defaults) return false;
    return 'uvOffset' in defaults && 'uvScale' in defaults;
}

function rewritePrefabAtlasRefs(
    prefab: PrefabData,
    atlasResult: AtlasResult,
): void {
    for (const entity of prefab.entities) {
        for (const comp of entity.components) {
            if (!comp.data || !isAtlasCapable(comp.type)) continue;

            const descriptors = getComponentAssetFieldDescriptors(comp.type);
            for (const desc of descriptors) {
                if (desc.type !== 'texture') continue;

                const textureRef = comp.data[desc.field];
                if (typeof textureRef !== 'string') continue;

                const entry = atlasResult.frameMap.get(textureRef);
                if (!entry) continue;

                const page = atlasResult.pages[entry.page];
                const frame = entry.frame;
                comp.data[desc.field] = `atlas_${entry.page}.png`;
                comp.data.uvOffset = {
                    x: frame.x / page.width,
                    y: 1.0 - (frame.y + frame.height) / page.height,
                };
                comp.data.uvScale = {
                    x: frame.width / page.width,
                    y: frame.height / page.height,
                };
            }
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
