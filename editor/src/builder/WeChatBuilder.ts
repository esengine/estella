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
// ESEngine WeChat Mini Game Entry
var ESEngineModule = require('./esengine.js');
var SDK = require('./sdk.js');

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

    // Create WebGL context in JS and register with Emscripten
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

    // Load scene
    ${firstSceneName ? `
    try {
        var sceneJson = wx.getFileSystemManager().readFileSync('scenes/${firstSceneName}.json', 'utf-8');
        var sceneData = JSON.parse(sceneJson);
        SDK.loadSceneData(app.world, sceneData);
        console.log('[ESEngine] Scene loaded: ${firstSceneName}');
    } catch (err) {
        console.error('[ESEngine] Failed to load scene:', err);
    }
    ` : '// No scene configured'}

    // User scripts
    ${userCode}

    // Start game loop
    app.run();
    console.log('[ESEngine] Game started');
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

        const isAbsolutePath = (p: string): boolean => {
            return p.startsWith('/') || /^[a-zA-Z]:/.test(p);
        };

        const getDir = (filePath: string): string => {
            const normalized = normalizePath(filePath);
            const lastSlash = normalized.lastIndexOf('/');
            return lastSlash > 0 ? normalized.substring(0, lastSlash) : normalized;
        };

        return {
            name: 'virtual-fs',
            setup(build) {
                // Mark esengine as external for WeChat (will use require)
                build.onResolve({ filter: /^esengine$/ }, () => {
                    return { path: 'esengine', external: true };
                });

                build.onResolve({ filter: /.*/ }, (args) => {
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
                        resolvedPath = joinPath(projectDir, 'node_modules', args.path);
                    }

                    if (!resolvedPath.endsWith('.ts') && !resolvedPath.endsWith('.js')) {
                        resolvedPath += '.ts';
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
            const fullPath = scenePath.startsWith('/')
                ? scenePath
                : joinPath(this.projectDir_, scenePath);

            const content = await this.fs_!.readFile(fullPath);
            if (content) {
                const name = scenePath.replace(/.*\//, '').replace('.esscene', '');
                await this.fs_!.writeFile(joinPath(scenesDir, `${name}.json`), content);
            }
        }
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
            const destPath = joinPath(destDir, entry.name);

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
}
