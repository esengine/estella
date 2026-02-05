/**
 * @file    WeChatBuilder.ts
 * @brief   Builder for WeChat Mini Game platform
 */

import * as esbuild from 'esbuild-wasm/esm/browser';
import type { BuildResult, BuildContext } from './BuildService';

// =============================================================================
// Types
// =============================================================================

interface NativeFS {
    exists(path: string): Promise<boolean>;
    readFile(path: string): Promise<string | null>;
    readBinaryFile(path: string): Promise<Uint8Array | null>;
    writeFile(path: string, content: string): Promise<boolean>;
    writeBinaryFile(path: string, data: Uint8Array): Promise<boolean>;
    copyFile(src: string, dest: string): Promise<boolean>;
    listDirectoryDetailed(path: string): Promise<Array<{ name: string; isDirectory: boolean }>>;
    createDirectory(path: string): Promise<boolean>;
    getEngineWxgameJs(): Promise<string>;
    getEngineWxgameWasm(): Promise<Uint8Array>;
    getSdkWechatJs(): Promise<string>;
}

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

function getFileExtension(path: string): string {
    const lastDot = path.lastIndexOf('.');
    return lastDot > 0 ? path.substring(lastDot + 1).toLowerCase() : '';
}

function isAbsolutePath(path: string): boolean {
    return path.startsWith('/') || /^[a-zA-Z]:/.test(path);
}

// =============================================================================
// WeChatBuilder
// =============================================================================

export class WeChatBuilder {
    private context_: BuildContext;
    private fs_: NativeFS | null;
    private projectDir_: string;

    constructor(context: BuildContext) {
        this.context_ = context;
        this.fs_ = (window as any).__esengine_fs ?? null;
        this.projectDir_ = getProjectDir(context.projectPath);
    }

    async build(): Promise<BuildResult> {
        if (!this.fs_) {
            return { success: false, error: 'Native file system not available' };
        }

        const settings = this.context_.config.wechatSettings;
        if (!settings) {
            return { success: false, error: 'WeChat settings not configured' };
        }

        console.log('[WeChatBuilder] Starting build...');

        try {
            const outputDir = joinPath(this.projectDir_, settings.outputDir);

            // Create output directory
            await this.fs_.createDirectory(outputDir);

            // 1. Generate project.config.json
            await this.generateProjectConfig(outputDir, settings);
            console.log('[WeChatBuilder] Generated project.config.json');

            // 2. Generate game.json
            await this.generateGameJson(outputDir);
            console.log('[WeChatBuilder] Generated game.json');

            // 3. Compile and generate game.js
            await this.generateGameJs(outputDir);
            console.log('[WeChatBuilder] Generated game.js');

            // 4. Copy scenes
            await this.copyScenes(outputDir);
            console.log('[WeChatBuilder] Copied scenes');

            // 5. Copy assets
            await this.copyAssets(outputDir);
            console.log('[WeChatBuilder] Copied assets');

            console.log(`[WeChatBuilder] Build successful: ${outputDir}`);
            return { success: true, outputPath: outputDir };
        } catch (err) {
            console.error('[WeChatBuilder] Build error:', err);
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
        const scriptsPath = joinPath(this.projectDir_, 'assets/scripts');

        let userCode = '';
        if (await this.fs_!.exists(scriptsPath)) {
            const entries = await this.fs_!.listDirectoryDetailed(scriptsPath);
            const scripts = entries
                .filter(e => !e.isDirectory && e.name.endsWith('.ts'))
                .map(e => joinPath(scriptsPath, e.name));

            if (scripts.length > 0) {
                userCode = await this.compileScripts(scripts);
            }
        }

        const firstScene = this.context_.config.scenes[0];
        const firstSceneName = firstScene ? firstScene.replace(/.*\//, '').replace('.esscene', '') : '';

        const gameJs = `
var ESEngineModule = require('./esengine.js');
var SDK = require('./sdk.js');

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
                var texturePath = comp.data.texture;
                if (!textureCache[texturePath]) {
                    try {
                        var result = await SDK.wxLoadImagePixels(texturePath);
                        textureCache[texturePath] = createTextureFromPixels(module, result);
                    } catch (err) {
                        console.warn('Failed to load texture:', texturePath, err);
                        textureCache[texturePath] = 0;
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
    for (var texturePath in sceneData.textureMetadata) {
        var handle = textureCache[texturePath];
        if (handle && handle > 0) {
            var metadata = sceneData.textureMetadata[texturePath];
            if (metadata && metadata.sliceBorder) {
                var border = metadata.sliceBorder;
                rm.setTextureMetadata(handle, border.left, border.right, border.top, border.bottom);
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

    ${firstSceneName ? `
    try {
        var sceneJson = wx.getFileSystemManager().readFileSync('scenes/${firstSceneName}.json', 'utf-8');
        var sceneData = JSON.parse(sceneJson);

        var textureCache = await loadSceneTextures(module, sceneData);
        applyTextureMetadata(module, sceneData, textureCache);
        var entityMap = SDK.loadSceneData(app.world, sceneData);
        updateSpriteTextures(app.world, sceneData, textureCache, entityMap);

        var screenAspect = canvas.width / canvas.height;
        SDK.updateCameraAspectRatio(app.world, screenAspect);
    } catch (err) {
        console.error('[ESEngine] Failed to load scene:', err);
    }
    ` : ''}

    ${userCode}

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

        let sdkJs = await this.fs_!.readFile(
            joinPath(this.projectDir_, 'node_modules/esengine/dist/index.wechat.js')
        );

        if (!sdkJs) {
            sdkJs = await this.fs_!.getSdkWechatJs();
        }

        if (sdkJs) {
            await this.fs_!.writeFile(joinPath(outputDir, 'sdk.js'), sdkJs);
            console.log(`[WeChatBuilder] Copied SDK`);
        }
    }

    private async compileScripts(scripts: string[]): Promise<string> {
        const entryContent = scripts.map(p => `import "${p}";`).join('\n');

        const defines: Record<string, string> = {};
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
                resolveDir: joinPath(this.projectDir_, 'assets/scripts'),
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

        const getDir = (filePath: string): string => {
            const normalized = normalizePath(filePath);
            const lastSlash = normalized.lastIndexOf('/');
            return lastSlash > 0 ? normalized.substring(0, lastSlash) : normalized;
        };

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
                build.onResolve({ filter: /.*/ }, async (args) => {
                    if (args.kind === 'entry-point') {
                        return { path: args.path, namespace: 'virtual' };
                    }

                    let resolvedPath = args.path;

                    if (isAbsolutePath(args.path)) {
                        resolvedPath = normalizePath(args.path);
                    } else if (args.path.startsWith('.')) {
                        const baseDir = args.importer ? getDir(args.importer) : args.resolveDir;
                        resolvedPath = joinPath(baseDir, args.path);
                    } else {
                        // Bare module specifier - resolve from node_modules
                        const pkgEntry = await resolvePackageEntry(args.path);
                        if (pkgEntry) {
                            resolvedPath = pkgEntry;
                        } else {
                            resolvedPath = joinPath(projectDir, 'node_modules', args.path);
                        }
                    }

                    // Add extension if missing
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

    private async copyScenes(outputDir: string): Promise<void> {
        const scenesDir = joinPath(outputDir, 'scenes');
        await this.fs_!.createDirectory(scenesDir);

        for (const scenePath of this.context_.config.scenes) {
            const fullPath = isAbsolutePath(scenePath)
                ? normalizePath(scenePath)
                : joinPath(this.projectDir_, scenePath);

            const content = await this.fs_!.readFile(fullPath);
            if (content) {
                const name = scenePath.replace(/.*\//, '').replace('.esscene', '');
                const encodedContent = this.encodeTexturePathsInScene(content);
                await this.fs_!.writeFile(joinPath(scenesDir, `${name}.json`), encodedContent);
            }
        }
    }

    private encodeTexturePathsInScene(sceneJson: string): string {
        try {
            const scene = JSON.parse(sceneJson);
            for (const entity of scene.entities || []) {
                for (const comp of entity.components || []) {
                    if (comp.type === 'Sprite' && comp.data?.texture) {
                        comp.data.texture = this.encodeAssetPath(comp.data.texture);
                    }
                }
            }
            if (scene.textureMetadata) {
                const encodedMetadata: Record<string, unknown> = {};
                for (const [path, metadata] of Object.entries(scene.textureMetadata)) {
                    encodedMetadata[this.encodeAssetPath(path)] = metadata;
                }
                scene.textureMetadata = encodedMetadata;
            }
            return JSON.stringify(scene, null, 2);
        } catch {
            return sceneJson;
        }
    }

    private encodeAssetPath(path: string): string {
        if (!path || typeof path !== 'string') return path;
        const parts = path.split('/');
        const encodedParts = parts.map(part => {
            const dotIndex = part.lastIndexOf('.');
            if (dotIndex > 0) {
                const name = part.substring(0, dotIndex);
                const ext = part.substring(dotIndex);
                return encodeURIComponent(name) + ext;
            }
            return encodeURIComponent(part);
        });
        return encodedParts.join('/');
    }

    private async copyAssets(outputDir: string): Promise<void> {
        const srcTexturesPath = joinPath(this.projectDir_, 'assets/textures');
        const destTexturesPath = joinPath(outputDir, 'assets/textures');

        if (await this.fs_!.exists(srcTexturesPath)) {
            await this.copyDirectoryRecursive(srcTexturesPath, destTexturesPath);
        }

        const srcAudioPath = joinPath(this.projectDir_, 'assets/audio');
        const destAudioPath = joinPath(outputDir, 'assets/audio');

        if (await this.fs_!.exists(srcAudioPath)) {
            await this.copyDirectoryRecursive(srcAudioPath, destAudioPath);
        }
    }

    private async copyDirectoryRecursive(srcDir: string, destDir: string): Promise<void> {
        await this.fs_!.createDirectory(destDir);

        const entries = await this.fs_!.listDirectoryDetailed(srcDir);

        for (const entry of entries) {
            const srcPath = joinPath(srcDir, entry.name);
            const encodedName = this.encodeFileName(entry.name);
            const destPath = joinPath(destDir, encodedName);

            if (entry.isDirectory) {
                await this.copyDirectoryRecursive(srcPath, destPath);
            } else {
                const ext = getFileExtension(entry.name);
                if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'mp3', 'wav', 'ogg'].includes(ext)) {
                    const data = await this.fs_!.readBinaryFile(srcPath);
                    if (data) {
                        await this.fs_!.writeBinaryFile(destPath, data);
                    }
                }
            }
        }
    }

    private encodeFileName(name: string): string {
        const dotIndex = name.lastIndexOf('.');
        if (dotIndex > 0) {
            const baseName = name.substring(0, dotIndex);
            const ext = name.substring(dotIndex);
            return encodeURIComponent(baseName) + ext;
        }
        return encodeURIComponent(name);
    }
}
