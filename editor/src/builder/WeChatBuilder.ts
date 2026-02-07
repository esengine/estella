/**
 * @file    WeChatBuilder.ts
 * @brief   Builder for WeChat Mini Game platform
 */

import * as esbuild from 'esbuild-wasm/esm/browser';
import type { BuildResult, BuildContext } from './BuildService';
import { BuildProgressReporter } from './BuildProgress';
import { BuildCache } from './BuildCache';
import { getEditorContext } from '../context/EditorContext';
import { findTsFiles, EDITOR_ONLY_DIRS } from '../scripting/ScriptLoader';
import { BuildAssetCollector, AssetExportConfigService } from './AssetCollector';
import { TextureAtlasPacker, type AtlasResult } from './TextureAtlas';
import { AssetLibrary } from '../asset/AssetLibrary';
import { normalizePath, joinPath, getProjectDir, isAbsolutePath, getParentDir } from '../utils/path';
import { resolveShaderPath } from '../utils/shader';
import { getAssetType } from '../asset/AssetTypes';
import { compileMaterials } from './MaterialCompiler';
import type { NativeFS } from '../types/NativeFS';

// =============================================================================
// Types
// =============================================================================

interface AssetManifestEntry {
    path: string;
    type: string;
}

// =============================================================================
// WeChatBuilder
// =============================================================================

export class WeChatBuilder {
    private context_: BuildContext;
    private fs_: NativeFS | null;
    private projectDir_: string;
    private progress_: BuildProgressReporter;
    private cache_: BuildCache | null;
    private assetLibrary_: AssetLibrary;

    constructor(context: BuildContext) {
        this.context_ = context;
        this.fs_ = getEditorContext().fs ?? null;
        this.projectDir_ = getProjectDir(context.projectPath);
        this.progress_ = context.progress || new BuildProgressReporter();
        this.cache_ = context.cache || null;
        this.assetLibrary_ = new AssetLibrary();
    }

    async build(): Promise<BuildResult> {
        if (!this.fs_) {
            return { success: false, error: 'Native file system not available' };
        }

        const settings = this.context_.config.wechatSettings;
        if (!settings) {
            return { success: false, error: 'WeChat settings not configured' };
        }

        this.progress_.setPhase('preparing');
        this.progress_.log('info', 'Starting WeChat MiniGame build...');

        try {
            await this.assetLibrary_.initialize(this.projectDir_, this.fs_);
            this.progress_.log('info', 'Asset library initialized');

            const outputDir = joinPath(this.projectDir_, settings.outputDir);
            await this.fs_.createDirectory(outputDir);

            // 1. Generate project.config.json
            this.progress_.setCurrentTask('Generating project.config.json...', 10);
            await this.generateProjectConfig(outputDir, settings);
            this.progress_.log('info', 'Generated project.config.json');

            // 2. Generate game.json
            this.progress_.setCurrentTask('Generating game.json...', 20);
            await this.generateGameJson(outputDir);
            this.progress_.log('info', 'Generated game.json');

            // 3. Compile and generate game.js
            this.progress_.setPhase('compiling');
            this.progress_.setCurrentTask('Compiling scripts...', 0);
            await this.generateGameJs(outputDir);
            this.progress_.log('info', 'Generated game.js');

            // 4. Collect assets and pack atlas
            this.progress_.setPhase('processing_assets');
            this.progress_.setCurrentTask('Packing texture atlas...', 0);
            const { atlasResult, packedPaths } = await this.packTextureAtlas(outputDir);
            if (atlasResult.pages.length > 0) {
                this.progress_.log('info', `Packed ${atlasResult.frameMap.size} textures into ${atlasResult.pages.length} atlas page(s)`);
            }

            // 5. Compile materials
            this.progress_.setCurrentTask('Compiling materials...', 20);
            const compiledMaterials = await this.compileMaterials_();
            this.progress_.log('info', `Compiled ${compiledMaterials.size} material(s)`);

            // 6. Copy scenes (with atlas rewriting, UUID preserved)
            this.progress_.setCurrentTask('Copying scenes...', 30);
            await this.copyScenes(outputDir, atlasResult);
            this.progress_.log('info', 'Copied scenes');

            // 7. Copy assets (excluding packed textures, .esmaterial, .esshader)
            this.progress_.setCurrentTask('Copying assets...', 50);
            await this.copyAssets(outputDir, packedPaths, compiledMaterials);
            this.progress_.log('info', 'Copied assets');

            // 8. Generate asset-manifest.json
            this.progress_.setCurrentTask('Generating asset manifest...', 70);
            await this.generateAssetManifest(outputDir, packedPaths, compiledMaterials, atlasResult);
            this.progress_.log('info', 'Generated asset-manifest.json');

            // 9. Write output
            this.progress_.setPhase('writing');
            this.progress_.setCurrentTask('Finalizing...', 0);

            this.progress_.log('info', `Build successful: ${outputDir}`);
            return { success: true, outputPath: outputDir };
        } catch (err) {
            console.error('[WeChatBuilder] Build error:', err);
            this.progress_.fail(String(err));
            return { success: false, error: String(err) };
        }
    }

    private async generateProjectConfig(
        outputDir: string,
        settings: NonNullable<typeof this.context_.config.wechatSettings>
    ): Promise<void> {
        const config = {
            description: 'ESEngine Game',
            packOptions: {
                ignore: [],
                include: [],
            },
            setting: {
                urlCheck: false,
                es6: true,
                enhance: true,
                compileHotReLoad: false,
                postcss: false,
                preloadBackgroundData: false,
                minified: !this.context_.config.defines.includes('DEBUG'),
                newFeature: true,
                coverView: true,
                nodeModules: false,
                autoAudits: false,
                showShadowRootInWxmlPanel: true,
                scopeDataCheck: false,
                uglifyFileName: false,
                checkInvalidKey: true,
                checkSiteMap: true,
                uploadWithSourceMap: true,
                compileWorklet: false,
                babelSetting: {
                    ignore: [],
                    disablePlugins: [],
                    outputPath: '',
                },
            },
            compileType: 'minigame',
            libVersion: '3.0.0',
            appid: settings.appId || 'touristappid',
            projectname: 'ESEngineGame',
            condition: {},
            editorSetting: {
                tabIndent: 'auto',
                tabSize: 4,
            },
        };

        await this.fs_!.writeFile(
            joinPath(outputDir, 'project.config.json'),
            JSON.stringify(config, null, 2)
        );
    }

    private async generateGameJson(outputDir: string): Promise<void> {
        const settings = this.context_.config.wechatSettings;

        const gameJson: Record<string, unknown> = {
            deviceOrientation: settings?.orientation || 'portrait',
            networkTimeout: {
                request: 10000,
                connectSocket: 10000,
                uploadFile: 10000,
                downloadFile: 10000,
            },
        };

        if (settings?.subpackages && settings.subpackages.length > 0) {
            gameJson.subpackages = settings.subpackages;
        }

        if (settings?.workers) {
            gameJson.workers = settings.workers;
        }

        if (settings?.openDataContext) {
            gameJson.openDataContext = settings.openDataContext;
        }

        await this.fs_!.writeFile(
            joinPath(outputDir, 'game.json'),
            JSON.stringify(gameJson, null, 2)
        );
    }

    private async generateGameJs(outputDir: string): Promise<void> {
        const scriptsPath = joinPath(this.projectDir_, 'src');

        let userCode = '';
        if (await this.fs_!.exists(scriptsPath)) {
            const scripts = await findTsFiles(this.fs_!, scriptsPath, EDITOR_ONLY_DIRS);

            if (scripts.length > 0) {
                userCode = await this.compileScripts(scripts);
            }
        }

        const firstScene = this.context_.config.scenes[0];
        const firstSceneName = firstScene ? firstScene.replace(/.*\//, '').replace('.esscene', '') : '';

        const gameJs = `
var ESEngineModule = require('./esengine.js');
var SDK = require('./sdk.js');
globalThis.__esengine_sdk = SDK;

var manifest = JSON.parse(wx.getFileSystemManager().readFileSync('asset-manifest.json', 'utf-8'));

function resolveAsset(uuid) {
    return manifest[uuid] || null;
}

function createTextureFromPixels(module, result) {
    var rm = module.getResourceManager();
    var ptr = module._malloc(result.pixels.length);
    module.HEAPU8.set(result.pixels, ptr);
    var handle = rm.createTexture(result.width, result.height, ptr, result.pixels.length, 1);
    module._free(ptr);
    return handle;
}

async function loadSceneTextures(module, sceneData) {
    var textureCache = {};
    for (var i = 0; i < sceneData.entities.length; i++) {
        var entity = sceneData.entities[i];
        for (var j = 0; j < entity.components.length; j++) {
            var comp = entity.components[j];
            if (comp.type === 'Sprite' && comp.data.texture && typeof comp.data.texture === 'string') {
                var textureRef = comp.data.texture;
                if (!textureCache[textureRef]) {
                    var entry = resolveAsset(textureRef);
                    var texturePath = entry ? entry.path : textureRef;
                    try {
                        var result = await SDK.wxLoadImagePixels(texturePath);
                        textureCache[textureRef] = createTextureFromPixels(module, result);
                    } catch (err) {
                        console.warn('Failed to load texture:', texturePath, err);
                        textureCache[textureRef] = 0;
                    }
                }
            }
        }
    }
    return textureCache;
}

function updateSpriteTextures(world, sceneData, textureCache, entityMap) {
    for (var i = 0; i < sceneData.entities.length; i++) {
        var entityData = sceneData.entities[i];
        var entity = entityMap.get(entityData.id);
        if (entity === undefined) continue;
        for (var j = 0; j < entityData.components.length; j++) {
            var comp = entityData.components[j];
            if (comp.type === 'Sprite' && comp.data.texture && typeof comp.data.texture === 'string') {
                var handle = textureCache[comp.data.texture] || 0;
                var sprite = world.get(entity, SDK.Sprite);
                if (sprite) {
                    sprite.texture = handle;
                    world.insert(entity, SDK.Sprite, sprite);
                }
            }
        }
    }
}

function applyTextureMetadata(module, sceneData, textureCache) {
    if (!sceneData.textureMetadata) return;
    var rm = module.getResourceManager();
    for (var textureRef in sceneData.textureMetadata) {
        var handle = textureCache[textureRef];
        if (handle && handle > 0) {
            var metadata = sceneData.textureMetadata[textureRef];
            if (metadata && metadata.sliceBorder) {
                var border = metadata.sliceBorder;
                rm.setTextureMetadata(handle, border.left, border.right, border.top, border.bottom);
            }
        }
    }
}

function ensureFSDir(module, path) {
    var parts = path.split('/');
    var cur = '';
    for (var i = 0; i < parts.length - 1; i++) {
        cur += (cur ? '/' : '') + parts[i];
        try { module.FS.mkdir(cur); } catch(e) {}
    }
}

function parseAtlasTextures(content) {
    var textures = [];
    var lines = content.split('\\n');
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line && line.indexOf(':') === -1 && (/\\.png$/i.test(line) || /\\.jpg$/i.test(line)))
            textures.push(line);
    }
    return textures;
}

async function loadSpineAssets(module, sceneData) {
    var rm = module.getResourceManager();
    var wxfs = wx.getFileSystemManager();
    for (var i = 0; i < sceneData.entities.length; i++) {
        var entity = sceneData.entities[i];
        for (var j = 0; j < entity.components.length; j++) {
            var comp = entity.components[j];
            if (comp.type !== 'SpineAnimation' || !comp.data) continue;
            var skelRef = comp.data.skeletonPath;
            var atlasRef = comp.data.atlasPath;
            if (!skelRef || !atlasRef) continue;
            var skelEntry = resolveAsset(skelRef);
            var atlasEntry = resolveAsset(atlasRef);
            var skelPath = skelEntry ? skelEntry.path : skelRef;
            var atlasPath = atlasEntry ? atlasEntry.path : atlasRef;
            comp.data.skeletonPath = skelPath;
            comp.data.atlasPath = atlasPath;
            try {
                var atlasContent = wxfs.readFileSync(atlasPath, 'utf-8');
                ensureFSDir(module, atlasPath);
                module.FS.writeFile(atlasPath, atlasContent);
                var texNames = parseAtlasTextures(atlasContent);
                var atlasDir = atlasPath.substring(0, atlasPath.lastIndexOf('/'));
                for (var k = 0; k < texNames.length; k++) {
                    var texPath = atlasDir + '/' + texNames[k];
                    try {
                        var result = await SDK.wxLoadImagePixels(texPath, false);
                        var handle = createTextureFromPixels(module, result);
                        rm.registerTextureWithPath(handle, texPath);
                    } catch(e) { console.warn('Failed to load spine texture:', texPath, e); }
                }
                ensureFSDir(module, skelPath);
                if (skelPath.endsWith('.skel')) {
                    module.FS.writeFile(skelPath, new Uint8Array(wxfs.readFileSync(skelPath)));
                } else {
                    module.FS.writeFile(skelPath, wxfs.readFileSync(skelPath, 'utf-8'));
                }
            } catch(e) { console.warn('Failed to load spine:', skelPath, e); }
        }
    }
}

function loadMaterials(sceneData) {
    var wxfs = wx.getFileSystemManager();
    var materialCache = {};
    var shaderCache = {};
    for (var i = 0; i < sceneData.entities.length; i++) {
        var entity = sceneData.entities[i];
        for (var j = 0; j < entity.components.length; j++) {
            var comp = entity.components[j];
            if (!comp.data || typeof comp.data.material !== 'string' || !comp.data.material) continue;
            if (comp.type !== 'Sprite' && comp.type !== 'SpineAnimation') continue;
            var matRef = comp.data.material;
            if (materialCache[matRef] !== undefined) continue;
            try {
                var entry = resolveAsset(matRef);
                if (!entry) { materialCache[matRef] = 0; continue; }
                var matJson = wxfs.readFileSync(entry.path, 'utf-8');
                var matData = JSON.parse(matJson);
                if (!matData.vertexSource || !matData.fragmentSource) { materialCache[matRef] = 0; continue; }
                var shaderKey = matData.vertexSource + matData.fragmentSource;
                var shaderHandle = shaderCache[shaderKey];
                if (!shaderHandle) {
                    shaderHandle = SDK.Material.createShader(matData.vertexSource, matData.fragmentSource);
                    shaderCache[shaderKey] = shaderHandle;
                }
                materialCache[matRef] = SDK.Material.createFromAsset(matData, shaderHandle);
            } catch (e) {
                console.warn('Failed to load material:', matRef, e);
                materialCache[matRef] = 0;
            }
        }
    }
    return materialCache;
}

function updateMaterials(world, sceneData, materialCache, entityMap) {
    for (var i = 0; i < sceneData.entities.length; i++) {
        var entityData = sceneData.entities[i];
        var entity = entityMap.get(entityData.id);
        if (entity === undefined) continue;
        for (var j = 0; j < entityData.components.length; j++) {
            var comp = entityData.components[j];
            if (!comp.data || typeof comp.data.material !== 'string' || !comp.data.material) continue;
            var handle = materialCache[comp.data.material] || 0;
            if (!handle) continue;
            if (comp.type === 'Sprite') {
                var sprite = world.get(entity, SDK.Sprite);
                if (sprite) { sprite.material = handle; world.insert(entity, SDK.Sprite, sprite); }
            } else if (comp.type === 'SpineAnimation') {
                var spine = world.get(entity, SDK.SpineAnimation);
                if (spine) { spine.material = handle; world.insert(entity, SDK.SpineAnimation, spine); }
            }
        }
    }
}

(async function() {
    var canvas = wx.createCanvas();
    var info = wx.getSystemInfoSync();
    canvas.width = info.windowWidth * info.pixelRatio;
    canvas.height = info.windowHeight * info.pixelRatio;

    var module = await ESEngineModule({
        canvas: canvas,
        instantiateWasm: function(imports, successCallback) {
            WXWebAssembly.instantiate('esengine.wasm', imports).then(function(result) {
                successCallback(result.instance, result.module);
            });
            return {};
        }
    });

    var gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) {
        console.error('[ESEngine] Failed to create WebGL context');
        return;
    }
    var glHandle = module.GL.registerContext(gl, {
        majorVersion: gl.getParameter(gl.VERSION).indexOf('WebGL 2') === 0 ? 2 : 1,
        minorVersion: 0,
        enableExtensionsByDefault: true
    });

    var app = SDK.createWebApp(module, {
        glContextHandle: glHandle,
        getViewportSize: function() {
            return { width: canvas.width, height: canvas.height };
        }
    });

    ${userCode}

    SDK.flushPendingSystems(app);

    ${firstSceneName ? `
    try {
        var sceneJson = wx.getFileSystemManager().readFileSync('scenes/${firstSceneName}.json', 'utf-8');
        var sceneData = JSON.parse(sceneJson);

        var textureCache = await loadSceneTextures(module, sceneData);
        applyTextureMetadata(module, sceneData, textureCache);
        await loadSpineAssets(module, sceneData);
        var materialCache = loadMaterials(sceneData);
        var entityMap = SDK.loadSceneData(app.world, sceneData);
        updateSpriteTextures(app.world, sceneData, textureCache, entityMap);
        updateMaterials(app.world, sceneData, materialCache, entityMap);

        var screenAspect = canvas.width / canvas.height;
        SDK.updateCameraAspectRatio(app.world, screenAspect);
    } catch (err) {
        console.error('[ESEngine] Failed to load scene:', err);
    }
    ` : ''}
    app.run();
})();
`;

        await this.fs_!.writeFile(joinPath(outputDir, 'game.js'), gameJs);

        await this.copyWeChatSdk(outputDir);
    }

    private async copyWeChatSdk(outputDir: string): Promise<void> {
        const engineJs = await this.fs_!.getEngineWxgameJs();
        const engineWasm = await this.fs_!.getEngineWxgameWasm();

        if (!engineJs || engineJs.length === 0) {
            throw new Error(
                'WeChat engine not found. Please run: scripts/build-wxgame.sh'
            );
        }

        await this.fs_!.writeFile(joinPath(outputDir, 'esengine.js'), engineJs);
        await this.fs_!.writeBinaryFile(joinPath(outputDir, 'esengine.wasm'), engineWasm);
        console.log(`[WeChatBuilder] Copied WeChat engine files`);

        const sdkJs = await this.fs_!.getSdkWechatJs();
        if (sdkJs) {
            await this.fs_!.writeFile(joinPath(outputDir, 'sdk.js'), sdkJs);
            console.log(`[WeChatBuilder] Copied SDK`);
        }
    }

    private async compileScripts(scripts: string[]): Promise<string> {
        const entryContent = scripts.map(p => `import "${p}";`).join('\n');

        const defines: Record<string, string> = {
            'process.env.EDITOR': 'false',
        };
        for (const def of this.context_.config.defines) {
            defines[`process.env.${def}`] = 'true';
        }

        try {
            await esbuild.initialize({
                wasmURL: 'https://cdn.jsdelivr.net/npm/esbuild-wasm@0.27.2/esbuild.wasm',
            });
        } catch (err) {
            if (!String(err).includes('Cannot call "initialize" more than once')) {
                throw err;
            }
        }

        const result = await esbuild.build({
            stdin: {
                contents: entryContent,
                loader: 'ts',
                resolveDir: joinPath(this.projectDir_, 'src'),
            },
            bundle: true,
            format: 'iife',
            write: false,
            platform: 'browser',
            target: 'es2020',
            minify: !this.context_.config.defines.includes('DEBUG'),
            define: defines,
            plugins: [this.createVirtualFsPlugin()],
        });

        return result.outputFiles?.[0]?.text ?? '';
    }

    private createVirtualFsPlugin(): esbuild.Plugin {
        const fs = this.fs_!;
        const projectDir = this.projectDir_;


        const resolvePackageEntry = async (pkgName: string): Promise<string | null> => {
            const pkgJsonPath = joinPath(projectDir, 'node_modules', pkgName, 'package.json');
            const pkgContent = await fs.readFile(pkgJsonPath);
            if (!pkgContent) return null;

            try {
                const pkg = JSON.parse(pkgContent);
                let entry = pkg.main || 'index.js';
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
                return joinPath(projectDir, 'node_modules', pkgName, entry);
            } catch {
                return joinPath(projectDir, 'node_modules', pkgName, 'index.js');
            }
        };

        return {
            name: 'virtual-fs',
            setup(build) {
                build.onResolve({ filter: /^esengine(\/wasm)?$/ }, (args) => ({
                    path: args.path,
                    namespace: 'sdk-shim',
                }));

                build.onLoad({ filter: /.*/, namespace: 'sdk-shim' }, () => ({
                    contents: 'module.exports = globalThis.__esengine_sdk;',
                    loader: 'js',
                }));

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
                        const pkgEntry = await resolvePackageEntry(args.path);
                        if (pkgEntry) {
                            resolvedPath = pkgEntry;
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

    private async compileMaterials_(): Promise<Map<string, { uuid: string; outputPath: string; json: string }>> {
        const configService = new AssetExportConfigService(this.projectDir_, this.fs_!);
        const exportConfig = await configService.load();
        const compiled = await compileMaterials(this.fs_!, this.projectDir_, this.assetLibrary_, this.context_.config, exportConfig);

        const result = new Map<string, { uuid: string; outputPath: string; json: string }>();
        for (const mat of compiled) {
            result.set(mat.relativePath, {
                uuid: mat.uuid,
                outputPath: mat.relativePath.replace(/\.esmaterial$/, '.json'),
                json: JSON.stringify(JSON.parse(mat.json), null, 2),
            });
        }
        return result;
    }


    private async packTextureAtlas(
        outputDir: string
    ): Promise<{ atlasResult: AtlasResult; packedPaths: Set<string> }> {
        const configService = new AssetExportConfigService(this.projectDir_, this.fs_!);
        const exportConfig = await configService.load();

        const collector = new BuildAssetCollector(this.fs_!, this.projectDir_, this.assetLibrary_);
        const assetPaths = await collector.collect(this.context_.config, exportConfig);

        const imagePaths = [...assetPaths].filter(p => {
            const ext = p.split('.').pop()?.toLowerCase() ?? '';
            return ext === 'png' || ext === 'jpg' || ext === 'jpeg';
        });

        const sceneDataList: Array<{ name: string; data: Record<string, unknown> }> = [];
        for (const scenePath of this.context_.config.scenes) {
            const fullPath = isAbsolutePath(scenePath)
                ? normalizePath(scenePath)
                : joinPath(this.projectDir_, scenePath);
            const content = await this.fs_!.readFile(fullPath);
            if (content) {
                const name = scenePath.replace(/.*\//, '').replace('.esscene', '');
                sceneDataList.push({ name, data: JSON.parse(content) });
            }
        }

        const packer = new TextureAtlasPacker(this.fs_!, this.projectDir_, this.assetLibrary_);
        const atlasResult = await packer.pack(imagePaths, sceneDataList);

        for (let i = 0; i < atlasResult.pages.length; i++) {
            const atlasPath = joinPath(outputDir, `atlas_${i}.png`);
            await this.fs_!.writeBinaryFile(atlasPath, atlasResult.pages[i].imageData);
        }

        const packedPaths = new Set<string>(atlasResult.frameMap.keys());
        return { atlasResult, packedPaths };
    }

    private async copyScenes(outputDir: string, atlasResult: AtlasResult): Promise<void> {
        const scenesDir = joinPath(outputDir, 'scenes');
        await this.fs_!.createDirectory(scenesDir);

        const packer = new TextureAtlasPacker(this.fs_!, this.projectDir_, this.assetLibrary_);

        for (const scenePath of this.context_.config.scenes) {
            const fullPath = isAbsolutePath(scenePath)
                ? normalizePath(scenePath)
                : joinPath(this.projectDir_, scenePath);

            const content = await this.fs_!.readFile(fullPath);
            if (content) {
                const name = scenePath.replace(/.*\//, '').replace('.esscene', '');
                const sceneData = JSON.parse(content);
                packer.rewriteSceneData(sceneData, atlasResult, '');
                await this.fs_!.writeFile(joinPath(scenesDir, `${name}.json`), JSON.stringify(sceneData, null, 2));
            }
        }
    }

    private async copyAssets(
        outputDir: string,
        packedPaths: Set<string>,
        compiledMaterials: Map<string, { uuid: string; outputPath: string; json: string }>
    ): Promise<void> {
        const configService = new AssetExportConfigService(this.projectDir_, this.fs_!);
        const exportConfig = await configService.load();

        const collector = new BuildAssetCollector(this.fs_!, this.projectDir_, this.assetLibrary_);
        const assetPaths = await collector.collect(this.context_.config, exportConfig);

        const compiledMaterialPaths = new Set<string>();
        const compiledShaderPaths = new Set<string>();
        for (const [matPath, compiled] of compiledMaterials) {
            compiledMaterialPaths.add(matPath);
            const fullPath = joinPath(this.projectDir_, matPath);
            const content = await this.fs_!.readFile(fullPath);
            if (content) {
                try {
                    const matData = JSON.parse(content);
                    if (matData.shader) {
                        compiledShaderPaths.add(resolveShaderPath(matPath, matData.shader));
                    }
                } catch {
                    // ignore
                }
            }
        }

        for (const relativePath of assetPaths) {
            if (packedPaths.has(relativePath)) continue;
            if (compiledMaterialPaths.has(relativePath)) continue;
            if (compiledShaderPaths.has(relativePath)) continue;
            if (relativePath.endsWith('.esshader')) continue;

            const srcPath = joinPath(this.projectDir_, relativePath);
            const destPath = joinPath(outputDir, relativePath);

            const destDir = destPath.substring(0, destPath.lastIndexOf('/'));
            await this.fs_!.createDirectory(destDir);

            const data = await this.fs_!.readBinaryFile(srcPath);
            if (data) {
                await this.fs_!.writeBinaryFile(destPath, data);
            }
        }

        for (const [, compiled] of compiledMaterials) {
            const destPath = joinPath(outputDir, compiled.outputPath);
            const destDir = destPath.substring(0, destPath.lastIndexOf('/'));
            await this.fs_!.createDirectory(destDir);
            await this.fs_!.writeFile(destPath, compiled.json);
        }
    }

    private async generateAssetManifest(
        outputDir: string,
        packedPaths: Set<string>,
        compiledMaterials: Map<string, { uuid: string; outputPath: string; json: string }>,
        atlasResult: AtlasResult
    ): Promise<void> {
        const manifest: Record<string, AssetManifestEntry> = {};

        const configService = new AssetExportConfigService(this.projectDir_, this.fs_!);
        const exportConfig = await configService.load();
        const collector = new BuildAssetCollector(this.fs_!, this.projectDir_, this.assetLibrary_);
        const assetPaths = await collector.collect(this.context_.config, exportConfig);

        for (const relativePath of assetPaths) {
            if (relativePath.endsWith('.esshader')) continue;

            const uuid = this.assetLibrary_.getUuid(relativePath);
            if (!uuid) continue;

            if (packedPaths.has(relativePath)) {
                const entry = atlasResult.frameMap.get(relativePath);
                if (entry) {
                    manifest[uuid] = {
                        path: `atlas_${entry.page}.png`,
                        type: 'texture',
                    };
                }
                continue;
            }

            const compiled = compiledMaterials.get(relativePath);
            if (compiled) {
                manifest[uuid] = {
                    path: compiled.outputPath,
                    type: 'material',
                };
                continue;
            }

            manifest[uuid] = {
                path: relativePath,
                type: getAssetType(relativePath),
            };
        }

        await this.fs_!.writeFile(
            joinPath(outputDir, 'asset-manifest.json'),
            JSON.stringify(manifest, null, 2)
        );
    }

}
