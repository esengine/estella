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
import { resolveShaderPath } from '../utils/shader';
import { initializeEsbuild, createBuildVirtualFsPlugin, generateAddressableManifest, convertPrefabWithResolvedRefs } from './ArtifactBuilder';
import { generateWeChatGameJs } from './templates';
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
            if (await fs.exists(outputDir)) {
                await fs.removeDirectory(outputDir);
            }
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

        const physicsConfig = JSON.stringify({
            gravity: context.physicsGravity ?? { x: 0, y: -9.81 },
            fixedTimestep: context.physicsFixedTimestep ?? 1 / 60,
            subStepCount: context.physicsSubStepCount ?? 4,
        });

        const gameJs = generateWeChatGameJs({
            userCode,
            firstSceneName,
            hasSpine: !!context.spineVersion,
            hasPhysics: !!context.enablePhysics,
            physicsConfig,
        });

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
                    const json = convertPrefabWithResolvedRefs(content, artifact);
                    await fs.writeFile(destPath, JSON.stringify(JSON.parse(json), null, 2));
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
        const manifest = generateAddressableManifest(artifact);
        await fs.writeFile(
            joinPath(outputDir, 'asset-manifest.json'),
            JSON.stringify(manifest, null, 2)
        );
    }
}
