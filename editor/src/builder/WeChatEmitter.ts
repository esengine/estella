/**
 * @file    WeChatEmitter.ts
 * @brief   Emitter that produces WeChat Mini Game output directory
 */

import * as esbuild from 'esbuild-wasm/esm/browser';
import type { PlatformEmitter, BuildArtifact } from './PlatformEmitter';
import type { BuildResult, BuildContext } from './BuildService';
import { BuildProgressReporter } from './BuildProgress';
import { getEditorContext } from '../context/EditorContext';
import { findTsFiles, EDITOR_ONLY_DIRS } from '../scripting/ScriptLoader';
import { joinPath, getProjectDir } from '../utils/path';
import { isUUID } from '../asset/AssetLibrary';
import { getAssetType, toAddressableType } from '../asset/AssetTypes';
import { resolveShaderPath } from '../utils/shader';
import { initializeEsbuild, createBuildVirtualFsPlugin } from './ArtifactBuilder';
import { convertPrefabAssetRefs, deserializePrefab } from '../prefab';
import type { NativeFS } from '../types/NativeFS';

// =============================================================================
// WeChatEmitter
// =============================================================================

export class WeChatEmitter implements PlatformEmitter {
    async emit(artifact: BuildArtifact, context: BuildContext): Promise<BuildResult> {
        const fs = getEditorContext().fs;
        if (!fs) {
            return { success: false, error: 'Native file system not available' };
        }

        const settings = context.config.wechatSettings;
        if (!settings) {
            return { success: false, error: 'WeChat settings not configured' };
        }

        const progress = context.progress || new BuildProgressReporter();
        const projectDir = getProjectDir(context.projectPath);
        const outputDir = joinPath(projectDir, settings.outputDir);

        try {
            await fs.createDirectory(outputDir);

            // 1. Generate project.config.json
            progress.setCurrentTask('Generating project.config.json...', 10);
            await this.generateProjectConfig(fs, outputDir, settings, context);
            progress.log('info', 'Generated project.config.json');

            // 2. Generate game.json
            progress.setCurrentTask('Generating game.json...', 20);
            await this.generateGameJson(fs, outputDir, settings);
            progress.log('info', 'Generated game.json');

            // 3. Compile and generate game.js
            progress.setPhase('compiling');
            progress.setCurrentTask('Compiling scripts...', 0);
            await this.generateGameJs(fs, projectDir, outputDir, context);
            progress.log('info', 'Generated game.js');

            // 4. Write atlas pages
            progress.setPhase('writing');
            progress.setCurrentTask('Writing atlas pages...', 0);
            for (let i = 0; i < artifact.atlasResult.pages.length; i++) {
                await fs.writeBinaryFile(
                    joinPath(outputDir, `atlas_${i}.png`),
                    artifact.atlasResult.pages[i].imageData
                );
            }
            if (artifact.atlasResult.pages.length > 0) {
                progress.log('info', `Packed ${artifact.atlasResult.frameMap.size} textures into ${artifact.atlasResult.pages.length} atlas page(s)`);
            }

            // 5. Write scenes
            progress.setCurrentTask('Copying scenes...', 10);
            const scenesDir = joinPath(outputDir, 'scenes');
            await fs.createDirectory(scenesDir);
            for (const [name, sceneData] of artifact.scenes) {
                await fs.writeFile(
                    joinPath(scenesDir, `${name}.json`),
                    JSON.stringify(sceneData, null, 2)
                );
            }
            progress.log('info', 'Copied scenes');

            // 6. Copy assets
            progress.setCurrentTask('Copying assets...', 30);
            await this.copyAssets(fs, projectDir, outputDir, artifact);
            progress.log('info', 'Copied assets');

            // 7. Write compiled materials
            progress.setCurrentTask('Writing compiled materials...', 50);
            for (const mat of artifact.compiledMaterials) {
                const matOutputPath = mat.relativePath.replace(/\.esmaterial$/, '.json');
                const destPath = joinPath(outputDir, matOutputPath);
                const destDir = destPath.substring(0, destPath.lastIndexOf('/'));
                await fs.createDirectory(destDir);
                await fs.writeFile(destPath, JSON.stringify(JSON.parse(mat.json), null, 2));
            }
            progress.log('info', `Compiled ${artifact.compiledMaterials.length} material(s)`);

            // 8. Generate asset-manifest.json
            progress.setCurrentTask('Generating asset manifest...', 70);
            await this.generateAssetManifest(fs, outputDir, artifact);
            progress.log('info', 'Generated asset-manifest.json');

            progress.setCurrentTask('Finalizing...', 90);
            progress.log('info', `Build successful: ${outputDir}`);
            return { success: true, outputPath: outputDir };
        } catch (err) {
            console.error('[WeChatEmitter] Build error:', err);
            progress.fail(String(err));
            return { success: false, error: String(err) };
        }
    }

    // =========================================================================
    // Private Methods
    // =========================================================================

    private async generateProjectConfig(
        fs: NativeFS,
        outputDir: string,
        settings: NonNullable<BuildContext['config']['wechatSettings']>,
        context: BuildContext
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
                minified: !context.config.defines.includes('DEBUG'),
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

        await fs.writeFile(
            joinPath(outputDir, 'project.config.json'),
            JSON.stringify(config, null, 2)
        );
    }

    private async generateGameJson(
        fs: NativeFS,
        outputDir: string,
        settings: NonNullable<BuildContext['config']['wechatSettings']>
    ): Promise<void> {
        const gameJson: Record<string, unknown> = {
            deviceOrientation: settings.orientation || 'portrait',
            networkTimeout: {
                request: 10000,
                connectSocket: 10000,
                uploadFile: 10000,
                downloadFile: 10000,
            },
        };

        if (settings.subpackages && settings.subpackages.length > 0) {
            gameJson.subpackages = settings.subpackages;
        }

        if (settings.workers) {
            gameJson.workers = settings.workers;
        }

        if (settings.openDataContext) {
            gameJson.openDataContext = settings.openDataContext;
        }

        await fs.writeFile(
            joinPath(outputDir, 'game.json'),
            JSON.stringify(gameJson, null, 2)
        );
    }

    private async generateGameJs(
        fs: NativeFS,
        projectDir: string,
        outputDir: string,
        context: BuildContext
    ): Promise<void> {
        const scriptsPath = joinPath(projectDir, 'src');

        let userCode = '';
        if (await fs.exists(scriptsPath)) {
            const scripts = await findTsFiles(fs, scriptsPath, EDITOR_ONLY_DIRS);
            if (scripts.length > 0) {
                userCode = await this.compileScripts(fs, projectDir, scripts, context);
            }
        }

        const firstScene = context.config.scenes[0];
        const firstSceneName = firstScene ? firstScene.replace(/.*\//, '').replace('.esscene', '') : '';

        const gameJs = `
var ESEngineModule = require('./esengine.js');
var SDK = require('./sdk.js');
globalThis.__esengine_sdk = SDK;

var manifest = JSON.parse(wx.getFileSystemManager().readFileSync('asset-manifest.json', 'utf-8'));
var assetIndex = {};
for (var gn in manifest.groups) {
    var g = manifest.groups[gn];
    for (var uuid in g.assets) {
        assetIndex[uuid] = g.assets[uuid];
    }
}
function resolvePath(ref) {
    var entry = assetIndex[ref];
    return entry ? entry.path : ref;
}

var spineModule = null;
${context.spineVersion ? `
async function initSpineModule() {
    try {
        var SpineFactory = require('./spine.js');
        spineModule = await SpineFactory({
            instantiateWasm: function(imports, successCallback) {
                WXWebAssembly.instantiate('spine.wasm', imports).then(function(result) {
                    successCallback(result.instance, result.module);
                });
                return {};
            }
        });
    } catch(e) { console.warn('Spine module not available:', e); }
}` : ''}

var physicsModule = null;
${context.enablePhysics ? `
async function initPhysicsModule() {
    try {
        var PhysicsFactory = require('./physics.js');
        physicsModule = await PhysicsFactory({
            instantiateWasm: function(imports, successCallback) {
                WXWebAssembly.instantiate('physics.wasm', imports).then(function(result) {
                    successCallback(result.instance, result.module);
                });
                return {};
            }
        });
    } catch(e) { console.warn('Physics module not available:', e); }
}` : ''}

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

    ${context.spineVersion ? 'await initSpineModule();' : ''}
    ${context.enablePhysics ? 'await initPhysicsModule();' : ''}

    ${firstSceneName ? `
    try {
        var wxfs = wx.getFileSystemManager();
        var provider = {
            loadPixels: function(ref) { return SDK.wxLoadImagePixels(resolvePath(ref)); },
            loadPixelsRaw: function(ref) { return SDK.wxLoadImagePixels(resolvePath(ref)); },
            readText: function(ref) { return wxfs.readFileSync(resolvePath(ref), 'utf-8'); },
            readBinary: function(ref) { return new Uint8Array(wxfs.readFileSync(resolvePath(ref))); },
            resolvePath: resolvePath
        };

        var sceneJson = wxfs.readFileSync('scenes/${firstSceneName}.json', 'utf-8');
        var sceneData = JSON.parse(sceneJson);

        await SDK.loadRuntimeScene(app, module, sceneData, provider, spineModule, physicsModule, ${JSON.stringify({
            gravity: context.physicsGravity ?? { x: 0, y: -9.81 },
            fixedTimestep: context.physicsFixedTimestep ?? 1 / 60,
            subStepCount: context.physicsSubStepCount ?? 4,
        })}, manifest);

        var screenAspect = canvas.width / canvas.height;
        SDK.updateCameraAspectRatio(app.world, screenAspect);
    } catch (err) {
        console.error('[ESEngine] Failed to load scene:', err);
    }
    ` : ''}
    app.run();
})();
`;

        await fs.writeFile(joinPath(outputDir, 'game.js'), gameJs);
        await this.copyWeChatSdk(fs, outputDir, context);
    }

    private async compileScripts(
        fs: NativeFS,
        projectDir: string,
        scripts: string[],
        context: BuildContext
    ): Promise<string> {
        const entryContent = scripts.map(p => `import "${p}";`).join('\n');

        const defines: Record<string, string> = {
            'process.env.EDITOR': 'false',
        };
        for (const def of context.config.defines) {
            defines[`process.env.${def}`] = 'true';
        }

        await initializeEsbuild();

        const plugin = createBuildVirtualFsPlugin(fs, projectDir, async () => ({
            contents: 'module.exports = globalThis.__esengine_sdk;',
            loader: 'js' as esbuild.Loader,
        }), false);

        const result = await esbuild.build({
            stdin: {
                contents: entryContent,
                loader: 'ts',
                resolveDir: joinPath(projectDir, 'src'),
            },
            bundle: true,
            format: 'iife',
            write: false,
            platform: 'browser',
            target: 'es2020',
            minify: !context.config.defines.includes('DEBUG'),
            define: defines,
            plugins: [plugin],
        });

        return result.outputFiles?.[0]?.text ?? '';
    }

    private async copyWeChatSdk(
        fs: NativeFS,
        outputDir: string,
        context: BuildContext
    ): Promise<void> {
        const engineJs = await fs.getEngineWxgameJs();
        const engineWasm = await fs.getEngineWxgameWasm();

        if (!engineJs || engineJs.length === 0) {
            throw new Error(
                'WeChat engine not found. Please run: scripts/build-wxgame.sh'
            );
        }

        await fs.writeFile(joinPath(outputDir, 'esengine.js'), engineJs);
        await fs.writeBinaryFile(joinPath(outputDir, 'esengine.wasm'), engineWasm);

        const sdkJs = await fs.getSdkWechatJs();
        if (sdkJs) {
            await fs.writeFile(joinPath(outputDir, 'sdk.js'), sdkJs);
        }

        const spineVersion = context.spineVersion;
        if (spineVersion) {
            const spineJs = await fs.getSpineJs(spineVersion);
            const spineWasm = await fs.getSpineWasm(spineVersion);
            if (spineJs && spineWasm.length > 0) {
                await fs.writeFile(joinPath(outputDir, 'spine.js'), spineJs);
                await fs.writeBinaryFile(joinPath(outputDir, 'spine.wasm'), spineWasm);
            }
        }

        if (context.enablePhysics) {
            const physicsJs = await fs.getPhysicsJs();
            const physicsWasm = await fs.getPhysicsWasm();
            if (physicsJs && physicsWasm.length > 0) {
                await fs.writeFile(joinPath(outputDir, 'physics.js'), physicsJs);
                await fs.writeBinaryFile(joinPath(outputDir, 'physics.wasm'), physicsWasm);
            }
        }
    }

    private async copyAssets(
        fs: NativeFS,
        projectDir: string,
        outputDir: string,
        artifact: BuildArtifact
    ): Promise<void> {
        const compiledMaterialPaths = new Set(artifact.compiledMaterials.map(m => m.relativePath));
        const compiledShaderPaths = new Set<string>();

        for (const mat of artifact.compiledMaterials) {
            const fullPath = joinPath(projectDir, mat.relativePath);
            const content = await fs.readFile(fullPath);
            if (content) {
                try {
                    const matData = JSON.parse(content);
                    if (matData.shader) {
                        compiledShaderPaths.add(resolveShaderPath(mat.relativePath, matData.shader));
                    }
                } catch {
                    // ignore
                }
            }
        }

        for (const relativePath of artifact.assetPaths) {
            if (artifact.packedPaths.has(relativePath)) continue;
            if (compiledMaterialPaths.has(relativePath)) continue;
            if (compiledShaderPaths.has(relativePath)) continue;
            if (relativePath.endsWith('.esshader')) continue;

            const srcPath = joinPath(projectDir, relativePath);
            const destPath = joinPath(outputDir, relativePath);
            const destDir = destPath.substring(0, destPath.lastIndexOf('/'));
            await fs.createDirectory(destDir);

            if (relativePath.endsWith('.esprefab')) {
                const content = await fs.readFile(srcPath);
                if (content) {
                    const prefab = deserializePrefab(content);
                    const converted = convertPrefabAssetRefs(prefab, (value) => {
                        if (isUUID(value)) {
                            return artifact.assetLibrary.getPath(value) ?? value;
                        }
                        return value;
                    });
                    await fs.writeFile(destPath, JSON.stringify(converted, null, 2));
                }
                continue;
            }

            const data = await fs.readBinaryFile(srcPath);
            if (data) {
                await fs.writeBinaryFile(destPath, data);
            }
        }
    }

    private async generateAssetManifest(
        fs: NativeFS,
        outputDir: string,
        artifact: BuildArtifact
    ): Promise<void> {
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

        const manifest = { version: '2.0', groups };
        await fs.writeFile(
            joinPath(outputDir, 'asset-manifest.json'),
            JSON.stringify(manifest, null, 2)
        );
    }
}
