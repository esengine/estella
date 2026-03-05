/**
 * @file    PlayableEmitter.ts
 * @brief   Emitter that produces a single HTML file for playable ads
 */

import * as esbuild from 'esbuild-wasm/esm/browser';
import type { PlatformEmitter, BuildArtifact } from './PlatformEmitter';
import type { BuildResult, BuildContext, OutputFileEntry } from './BuildService';
import { BuildProgressReporter } from './BuildProgress';
import { getEditorContext } from '../context/EditorContext';
import { joinPath, getFileExtension, isAbsolutePath, getParentDir, normalizePath, getProjectDir } from '../utils/path';
import { arrayBufferToBase64, generateAddressableManifest } from './ArtifactBuilder';
import { PLAYABLE_HTML_TEMPLATE } from './templates';
import type { NativeFS } from '../types/NativeFS';
import { getAssetMimeType, getAssetTypeEntry, toBuildPath } from 'esengine';
import {
    analyzeUsedPlugins,
    collectUserScriptImports,
    compileUserScripts,
    resolveSceneUUIDs,
    generatePhysicsConfig,
} from './EmitterUtils';

// =============================================================================
// PlayableEmitter
// =============================================================================

export class PlayableEmitter implements PlatformEmitter {
    async emit(artifact: BuildArtifact, context: BuildContext): Promise<BuildResult> {
        const fs = getEditorContext().fs;
        if (!fs) {
            return { success: false, error: 'Native file system not available' };
        }

        const settings = context.config.playableSettings;
        if (!settings) {
            return { success: false, error: 'Playable settings not configured' };
        }

        const startupScene = settings.startupScene || context.config.scenes[0];
        if (!startupScene) {
            return { success: false, error: 'No startup scene configured. Add a scene to the build or set a startup scene.' };
        }

        const progress = context.progress || new BuildProgressReporter();
        const projectDir = getProjectDir(context.projectPath);

        try {
            // 1. Load SDK
            progress.setCurrentTask('Loading SDK...', 0);
            const wasmSdk = await this.loadSdk(fs);
            if (!wasmSdk) {
                return { success: false, error: "SDK not found. Please run 'scripts/build-web-single.bat' first." };
            }
            progress.log('info', `SDK loaded: ${wasmSdk.length} bytes`);

            // 2. Compile user scripts
            progress.setPhase('compiling');
            progress.setCurrentTask('Compiling scripts...', 0);
            const gameCode = await this.compilePlayableScripts(fs, projectDir, context, artifact);
            progress.log('info', `Scripts compiled: ${gameCode.length} bytes`);

            // 3. Process all scenes (resolve UUIDs)
            const startupSceneName = startupScene.replace(/.*\//, '').replace('.esscene', '');
            const allScenes: Array<{ name: string; data: string }> = [];
            for (const [name, data] of artifact.scenes) {
                const copy = JSON.parse(JSON.stringify(data));
                resolveSceneUUIDs(copy, artifact);
                allScenes.push({ name, data: JSON.stringify(copy) });
            }
            if (!allScenes.some(s => s.name === startupSceneName)) {
                return { success: false, error: `Startup scene not found: ${startupScene}` };
            }

            // 4. Load spine module if needed
            progress.setCurrentTask('Loading modules...', 25);
            let spineJsSource = '';
            let spineWasmBase64 = '';
            if (context.spineVersion && fs.getSpineJs) {
                const spineJs = await fs.getSpineJs(context.spineVersion);
                const spineWasm = await fs.getSpineWasm(context.spineVersion);
                if (spineJs && spineWasm.length > 0) {
                    spineJsSource = spineJs;
                    spineWasmBase64 = arrayBufferToBase64(spineWasm);
                    progress.log('info', `Spine ${context.spineVersion} module loaded`);
                }
            }

            // 5. Load physics module if needed
            let physicsJsSource = '';
            let physicsWasmBase64 = '';
            if (context.enablePhysics && fs.getPhysicsJs) {
                progress.setCurrentTask('Loading physics module...', 27);
                const physicsJs = await fs.getPhysicsJs();
                const physicsWasm = await fs.getPhysicsWasm();
                if (physicsJs && physicsWasm.length > 0) {
                    physicsJsSource = physicsJs;
                    physicsWasmBase64 = arrayBufferToBase64(physicsWasm);
                    progress.log('info', 'Physics module loaded');
                }
            }

            // 6. Collect inline assets
            progress.setPhase('assembling');
            progress.setCurrentTask('Collecting assets...', 0);
            const assets = await this.collectInlineAssets(fs, projectDir, artifact);
            for (let i = 0; i < artifact.atlasResult.pages.length; i++) {
                const base64 = arrayBufferToBase64(artifact.atlasResult.pages[i].imageData);
                assets.set(`atlas_${i}.png`, `data:image/png;base64,${base64}`);
            }
            progress.log('info', `Collected ${assets.size} assets`);

            // 6.5 Generate addressable manifest
            const manifestJson = JSON.stringify(generateAddressableManifest(artifact));

            // 7. Assemble HTML
            progress.setCurrentTask('Assembling HTML...', 50);
            const html = this.assembleHTML(
                wasmSdk, gameCode, allScenes, startupSceneName, assets,
                spineJsSource, spineWasmBase64,
                physicsJsSource, physicsWasmBase64,
                context, manifestJson
            );
            progress.log('info', `HTML assembled: ${html.length} bytes`);

            // 8. Write output
            progress.setPhase('writing');
            progress.setCurrentTask('Writing output...', 0);
            const outputPath = isAbsolutePath(settings.outputPath)
                ? normalizePath(settings.outputPath)
                : joinPath(projectDir, settings.outputPath);
            const outputDir = getParentDir(outputPath);

            await fs.createDirectory(outputDir);
            const success = await fs.writeFile(outputPath, html);

            if (success) {
                const fileSize = new TextEncoder().encode(html).length;
                progress.log('info', `Build successful: ${outputPath}`);
                return {
                    success: true,
                    outputPath,
                    outputSize: fileSize,
                    outputFiles: [{ path: outputPath, size: fileSize }],
                };
            }
            return { success: false, error: 'Failed to write output file' };
        } catch (err) {
            console.error('[PlayableEmitter] Build error:', err);
            progress.fail(String(err));
            return { success: false, error: String(err) };
        }
    }

    // =========================================================================
    // Private Methods
    // =========================================================================

    private async loadSdk(fs: NativeFS): Promise<string | null> {
        try {
            if (fs.getEngineSingleJs) {
                return await fs.getEngineSingleJs();
            }
            const response = await fetch('/wasm/esengine.single.js');
            if (!response.ok) return null;
            return await response.text();
        } catch {
            return null;
        }
    }

    private async compilePlayableScripts(
        fs: NativeFS,
        projectDir: string,
        context: BuildContext,
        artifact: BuildArtifact,
    ): Promise<string> {
        const { imports, hasSrcDir } = await collectUserScriptImports(fs, projectDir);

        const usedPlugins = analyzeUsedPlugins(artifact);
        const alwaysPlugins = ['animationPlugin', 'audioPlugin', 'particlePlugin'];
        const allPlugins = [...new Set([...usedPlugins, ...alwaysPlugins])];
        const pluginImports = allPlugins.join(', ');
        const pluginList = allPlugins.join(', ');

        const entryContent = `
import { createWebApp as _cwa, initPlayableRuntime, RuntimeConfig, ${pluginImports} } from 'esengine';
${imports}

const __plugins = [${pluginList}];
(window as any).esengine = {
    createWebApp: (m: any, o?: any) => _cwa(m, { plugins: __plugins, ...o }),
    initPlayableRuntime,
    RuntimeConfig,
};
`;

        const settings = context.config.playableSettings!;
        const scriptsPath = joinPath(projectDir, 'src');

        return compileUserScripts(fs, projectDir, context, {
            entryContent,
            resolveDir: hasSrcDir ? scriptsPath : projectDir,
            minify: settings.minifyCode,
            sdkResolver: async (path) => {
                if (path === 'esengine') {
                    return { contents: await fs.getSdkEsmJs(), loader: 'js' as esbuild.Loader };
                }
                if (path === 'esengine/wasm') {
                    return { contents: await fs.getSdkWasmJs(), loader: 'js' as esbuild.Loader };
                }
                return { contents: '', loader: 'js' as esbuild.Loader };
            },
        });
    }

    private async collectInlineAssets(
        fs: NativeFS,
        projectDir: string,
        artifact: BuildArtifact
    ): Promise<Map<string, string>> {
        const assets = new Map<string, string>();
        const compiledMaterialPaths = new Set(artifact.compiledMaterials.map(m => m.relativePath));

        const allFiles = new Set(artifact.assetPaths);

        const pending: Array<Promise<void>> = [];

        for (const relativePath of allFiles) {
            const entry = getAssetTypeEntry(relativePath);
            if (entry?.editorType === 'shader') continue;

            const outputPath = toBuildPath(relativePath);

            if (compiledMaterialPaths.has(relativePath)) {
                const mat = artifact.compiledMaterials.find(m => m.relativePath === relativePath);
                if (mat) {
                    const base64 = btoa(mat.json);
                    assets.set(outputPath, `data:application/json;base64,${base64}`);
                }
                continue;
            }

            if (entry?.buildTransform) {
                const transform = entry.buildTransform;
                pending.push(
                    fs.readFile(joinPath(projectDir, relativePath)).then(content => {
                        if (content) {
                            const json = transform(content, artifact);
                            assets.set(outputPath, `data:application/json;base64,${btoa(json)}`);
                        }
                    })
                );
                continue;
            }

            const ext = getFileExtension(relativePath);
            const mimeType = getAssetMimeType(ext);
            if (!mimeType) continue;

            pending.push(
                fs.readBinaryFile(joinPath(projectDir, relativePath)).then(binary => {
                    if (binary) {
                        const base64 = arrayBufferToBase64(binary);
                        assets.set(relativePath, `data:${mimeType};base64,${base64}`);
                    }
                })
            );
        }

        await Promise.all(pending);

        await this.collectUntrackedAudioAssets(fs, projectDir, allFiles, assets);

        return assets;
    }

    private async collectUntrackedAudioAssets(
        fs: NativeFS,
        projectDir: string,
        trackedPaths: Set<string>,
        assets: Map<string, string>
    ): Promise<void> {
        const audioExts = new Set(['mp3', 'wav', 'ogg', 'aac', 'flac', 'webm']);
        const assetsDir = joinPath(projectDir, 'assets');
        if (!await fs.exists(assetsDir)) return;

        const scan = async (absDir: string, relDir: string): Promise<void> => {
            const entries = await fs.listDirectoryDetailed(absDir);
            const pending: Array<Promise<void>> = [];
            for (const entry of entries) {
                const childAbs = joinPath(absDir, entry.name);
                const childRel = `${relDir}/${entry.name}`;
                if (entry.isDirectory) {
                    pending.push(scan(childAbs, childRel));
                } else {
                    const ext = getFileExtension(childRel);
                    if (audioExts.has(ext) && !trackedPaths.has(childRel)) {
                        const mimeType = getAssetMimeType(ext);
                        if (!mimeType) continue;
                        pending.push(
                            fs.readBinaryFile(childAbs).then(binary => {
                                if (binary) {
                                    assets.set(childRel, `data:${mimeType};base64,${arrayBufferToBase64(binary)}`);
                                }
                            })
                        );
                    }
                }
            }
            await Promise.all(pending);
        };

        await scan(assetsDir, 'assets');
    }

    private assembleHTML(
        wasmSdk: string, gameCode: string,
        allScenes: Array<{ name: string; data: string }>, startupScene: string,
        assets: Map<string, string>,
        spineJs: string, spineWasmBase64: string,
        physicsJs: string, physicsWasmBase64: string,
        context: BuildContext, manifestJson: string
    ): string {
        const entries: string[] = [];
        for (const [path, dataUrl] of assets) {
            entries.push(`"${path}":"${dataUrl}"`);
        }

        let spineScript = '';
        if (spineJs && spineWasmBase64) {
            spineScript = `<script>\nvar __SPINE_WASM_B64__="${spineWasmBase64}";\n${spineJs}\n</script>`;
        }

        let physicsScript = '';
        if (physicsJs && physicsWasmBase64) {
            physicsScript = `<script>\nvar __PHYSICS_WASM_B64__="${physicsWasmBase64}";\n${physicsJs}\n</script>`;
        }

        const physicsConfig = generatePhysicsConfig(context);

        const enableCTA = context.config.playableSettings?.enableBuiltinCTA ?? false;
        const ctaUrl = JSON.stringify(context.config.playableSettings?.ctaUrl || '');

        const ctaStyle = enableCTA
            ? '#cta{position:fixed;bottom:5%;left:50%;transform:translateX(-50%);padding:12px 32px;font-size:18px;font-weight:bold;color:#fff;background:#ff4444;border:none;border-radius:8px;cursor:pointer;z-index:999;text-transform:uppercase;box-shadow:0 2px 8px rgba(0,0,0,0.3)}\n#cta:active{transform:translateX(-50%) scale(0.95)}'
            : '';
        const ctaHtml = enableCTA
            ? '<button id="cta" style="display:none">Install Now</button>'
            : '';
        const ctaScript = enableCTA
            ? `function installCTA(){\n  if(typeof mraid!=='undefined'&&mraid.open){mraid.open(${ctaUrl})}\n  else{window.open(${ctaUrl},'_blank')}\n}\ndocument.getElementById('cta').addEventListener('click',installCTA);`
            : '';
        const ctaShow = enableCTA
            ? "document.getElementById('cta').style.display='block';"
            : '';

        const runtimeConfigCode = this.generateRuntimeConfigCode(context);
        const runtimeAppConfigCode = this.generateRuntimeAppConfigCode(context);

        return PLAYABLE_HTML_TEMPLATE
            .replace('{{WASM_SDK}}', () => wasmSdk)
            .replace('{{SPINE_SCRIPT}}', () => spineScript)
            .replace('{{PHYSICS_SCRIPT}}', () => physicsScript)
            .replace('{{GAME_CODE}}', () => gameCode)
            .replace('{{ASSETS_MAP}}', () => `{${entries.join(',')}}`)
            .replace('{{SCENES_DATA}}', () => {
                const items = allScenes.map(s => `{name:${JSON.stringify(s.name)},data:${s.data}}`);
                return `[${items.join(',')}]`;
            })
            .replace('{{STARTUP_SCENE}}', () => startupScene)
            .replace('{{PHYSICS_CONFIG}}', () => physicsConfig)
            .replace('{{MANIFEST}}', () => manifestJson)
            .replace('{{RUNTIME_CONFIG}}', () => runtimeConfigCode)
            .replace('{{RUNTIME_APP_CONFIG}}', () => runtimeAppConfigCode)
            .replace('{{CTA_STYLE}}', () => ctaStyle)
            .replace('{{CTA_HTML}}', () => ctaHtml)
            .replace('{{CTA_SCRIPT}}', () => ctaScript)
            .replace('{{CTA_SHOW}}', () => ctaShow);
    }

    private generateRuntimeConfigCode(context: BuildContext): string {
        const rc = context.runtimeConfig;
        if (!rc) return '';
        const lines: string[] = [];
        if (rc.maxDeltaTime !== undefined) lines.push(`es.RuntimeConfig.maxDeltaTime=${rc.maxDeltaTime};`);
        if (rc.maxFixedSteps !== undefined) lines.push(`es.RuntimeConfig.maxFixedSteps=${rc.maxFixedSteps};`);
        if (rc.textCanvasSize !== undefined) lines.push(`es.RuntimeConfig.textCanvasSize=${rc.textCanvasSize};`);
        if (rc.defaultFontFamily !== undefined) lines.push(`es.RuntimeConfig.defaultFontFamily=${JSON.stringify(rc.defaultFontFamily)};`);
        if (rc.sceneTransitionDuration !== undefined) lines.push(`es.RuntimeConfig.sceneTransitionDuration=${rc.sceneTransitionDuration};`);
        if (rc.sceneTransitionColor) {
            const hex = rc.sceneTransitionColor.replace('#', '');
            const r = parseInt(hex.substring(0, 2), 16) / 255;
            const g = parseInt(hex.substring(2, 4), 16) / 255;
            const b = parseInt(hex.substring(4, 6), 16) / 255;
            lines.push(`es.RuntimeConfig.sceneTransitionColor={r:${r},g:${g},b:${b},a:1};`);
        }
        if (rc.canvasScaleMode !== undefined) {
            const modeMap: Record<string, number> = { FixedWidth: 0, FixedHeight: 1, Expand: 2, Shrink: 3, Match: 4 };
            lines.push(`es.RuntimeConfig.canvasScaleMode=${modeMap[rc.canvasScaleMode] ?? 1};`);
        }
        if (rc.canvasMatchWidthOrHeight !== undefined) lines.push(`es.RuntimeConfig.canvasMatchWidthOrHeight=${rc.canvasMatchWidthOrHeight};`);
        return lines.join('\n  ');
    }

    private generateRuntimeAppConfigCode(context: BuildContext): string {
        const rc = context.runtimeConfig;
        if (!rc) return '';
        const lines: string[] = [];
        if (rc.maxDeltaTime !== undefined) lines.push(`app.setMaxDeltaTime(${rc.maxDeltaTime});`);
        if (rc.maxFixedSteps !== undefined) lines.push(`app.setMaxFixedSteps(${rc.maxFixedSteps});`);
        return lines.join('\n  ');
    }

}
