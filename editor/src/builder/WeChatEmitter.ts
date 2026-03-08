/**
 * @file    WeChatEmitter.ts
 * @brief   Emitter that produces WeChat Mini Game output directory
 */

import * as esbuild from 'esbuild-wasm/esm/browser';
import type { PlatformEmitter, BuildArtifact } from './PlatformEmitter';
import type { BuildResult, BuildContext, OutputFileEntry } from './BuildService';
import { BuildProgressReporter } from './BuildProgress';
import { getEditorContext } from '../context/EditorContext';
import { joinPath, getProjectDir } from '../utils/path';
import { resolveShaderPath } from '../utils/shader';
import { generateAddressableManifest } from './ArtifactBuilder';
import { generateWeChatGameJs } from './templates';
import type { NativeFS } from '../types/NativeFS';
import { getWeChatPackOptions, getAssetTypeEntry, toBuildPath } from 'esengine';
import {
    collectUserScriptImports,
    compileUserScripts,
    generatePhysicsConfig,
} from './EmitterUtils';

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
            await this.generateGameJs(fs, projectDir, outputDir, context, artifact);
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
                const matOutputPath = toBuildPath(mat.relativePath);
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
            const outputFiles = await this.collectOutputFiles(fs, outputDir, outputDir);
            const totalSize = outputFiles.reduce((sum, f) => sum + f.size, 0);
            progress.log('info', `Build successful: ${outputDir}`);
            return { success: true, outputPath: outputDir, outputSize: totalSize, outputFiles };
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
                include: getWeChatPackOptions(),
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
        context: BuildContext,
        artifact: BuildArtifact,
    ): Promise<void> {
        const { imports, hasSrcDir } = await collectUserScriptImports(fs, projectDir);

        let userCode = '';
        if (imports) {
            userCode = await compileUserScripts(fs, projectDir, context, {
                entryContent: imports,
                resolveDir: joinPath(projectDir, 'src'),
                minify: !context.config.defines.includes('DEBUG'),
                sdkResolver: async () => ({
                    contents: 'module.exports = globalThis.__esengine_sdk;',
                    loader: 'js' as esbuild.Loader,
                }),
                preferEsmEntry: false,
            });
        }

        const allSceneNames = context.config.scenes.map(
            s => s.replace(/.*\//, '').replace('.esscene', '')
        );
        const firstSceneName = allSceneNames[0] ?? '';

        const physicsConfig = generatePhysicsConfig(context);

        const gameJs = generateWeChatGameJs({
            userCode,
            firstSceneName,
            allSceneNames,
            spineVersions: [...artifact.spineVersions],
            hasPhysics: !!context.enablePhysics,
            physicsConfig,
            runtimeConfig: context.runtimeConfig,
        });

        await fs.writeFile(joinPath(outputDir, 'game.js'), gameJs);
        await this.copyWeChatSdk(fs, outputDir, context, artifact);
    }

    private async copyWeChatSdk(
        fs: NativeFS,
        outputDir: string,
        context: BuildContext,
        artifact: BuildArtifact,
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

        for (const version of artifact.spineVersions) {
            if (version === '4.2') continue;
            const spineJs = await fs.getSpineJs(version);
            const spineWasm = await fs.getSpineWasm(version);
            if (spineJs && spineWasm.length > 0) {
                const tag = version.replace('.', '');
                await fs.writeFile(joinPath(outputDir, `spine_${tag}.js`), spineJs);
                await fs.writeBinaryFile(joinPath(outputDir, `spine_${tag}.wasm`), spineWasm);
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
            const entry = getAssetTypeEntry(relativePath);
            if (entry?.editorType === 'shader') continue;

            const srcPath = joinPath(projectDir, relativePath);
            const outputPath = toBuildPath(relativePath);
            const destPath = joinPath(outputDir, outputPath);
            const destDir = destPath.substring(0, destPath.lastIndexOf('/'));
            await fs.createDirectory(destDir);

            if (entry?.buildTransform) {
                const content = await fs.readFile(srcPath);
                if (content) {
                    const json = entry.buildTransform(content, artifact);
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

    private async collectOutputFiles(
        fs: NativeFS,
        dir: string,
        rootDir: string,
    ): Promise<OutputFileEntry[]> {
        const results: OutputFileEntry[] = [];
        const entries = await fs.listDirectoryDetailed(dir);

        for (const entry of entries) {
            const fullPath = joinPath(dir, entry.name);
            if (entry.isDirectory) {
                const children = await this.collectOutputFiles(fs, fullPath, rootDir);
                results.push(...children);
            } else {
                const stats = await fs.getFileStats(fullPath);
                results.push({
                    path: fullPath.substring(rootDir.length + 1),
                    size: stats?.size ?? 0,
                });
            }
        }

        return results;
    }
}
