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
import { arrayBufferToBase64, generateAddressableManifest, generateCatalog } from './ArtifactBuilder';
import { renderTemplate, loadTemplate } from './templates';
import type { NativeFS } from '../types/NativeFS';
import { getAssetMimeType, getAssetTypeEntry, toBuildPath } from 'esengine';
import {
    resolvePlayablePlugins,
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
            // 1. Load compiled SDK
            progress.setCurrentTask('Loading SDK...', 0);
            if (!context.customWasm?.jsPath) {
                return { success: false, error: 'WASM not compiled. Toolchain compilation is required.' };
            }
            const wasmSdk = await fs.readFile(context.customWasm.jsPath);
            if (!wasmSdk) {
                return { success: false, error: `Compiled SDK not found at: ${context.customWasm.jsPath}` };
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

            // 4. Load spine modules from compiled output
            progress.setCurrentTask('Loading modules...', 25);
            const spineModules: Array<{ version: string; js: string; wasmBase64: string }> = [];
            if (context.customWasm?.spineModules) {
                for (const mod of context.customWasm.spineModules) {
                    const spineJs = await fs.readFile(mod.jsPath);
                    const spineWasm = await fs.readBinaryFile(mod.wasmPath);
                    if (spineJs && spineWasm && spineWasm.length > 0) {
                        spineModules.push({
                            version: mod.version,
                            js: spineJs,
                            wasmBase64: arrayBufferToBase64(spineWasm),
                        });
                        progress.log('info', `Spine ${mod.version} module loaded`);
                    }
                }
            }

            // 5. Load physics module from compiled output
            let physicsJsSource = '';
            let physicsWasmBase64 = '';
            if (context.customWasm?.physicsJsPath && context.customWasm?.physicsWasmPath) {
                progress.setCurrentTask('Loading physics module...', 27);
                const physicsJs = await fs.readFile(context.customWasm.physicsJsPath);
                const physicsWasm = await fs.readBinaryFile(context.customWasm.physicsWasmPath);
                if (physicsJs && physicsWasm && physicsWasm.length > 0) {
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

            // 6.5 Generate addressable manifest + catalog
            const manifestJson = JSON.stringify(generateAddressableManifest(artifact));
            const catalogJson = JSON.stringify(generateCatalog(artifact));
            assets.set('catalog.json', `data:application/json;base64,${btoa(catalogJson)}`);

            // 7. Load template + assemble HTML
            progress.setCurrentTask('Assembling HTML...', 50);
            const template = await loadTemplate(fs, projectDir, context.config.playableSettings?.templatePath, 'playable');
            const sections = this.prepareSections(
                wasmSdk, gameCode, allScenes, startupSceneName, assets,
                spineModules,
                physicsJsSource, physicsWasmBase64,
                context, manifestJson
            );
            const html = renderTemplate(template, sections);
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

    private async compilePlayableScripts(
        fs: NativeFS,
        projectDir: string,
        context: BuildContext,
        artifact: BuildArtifact,
    ): Promise<string> {
        const { imports, hasSrcDir } = await collectUserScriptImports(fs, projectDir);

        const { imports: pluginImports, list: pluginList } = resolvePlayablePlugins(
            context.config.engineModules,
        );

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
                    const resp = await fetch('/sdk/esm/esengine.js');
                    return { contents: await resp.text(), loader: 'js' as esbuild.Loader };
                }
                if (path === 'esengine/wasm') {
                    return { contents: await fs.getSdkWasmJs(), loader: 'js' as esbuild.Loader };
                }
                const sdkPath = path.replace(/^\.\//, '');
                const resp = await fetch(`/sdk/esm/${sdkPath}`);
                if (resp.ok) {
                    return { contents: await resp.text(), loader: 'js' as esbuild.Loader };
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

    private prepareSections(
        wasmSdk: string, gameCode: string,
        allScenes: Array<{ name: string; data: string }>, startupScene: string,
        assets: Map<string, string>,
        spineModules: Array<{ version: string; js: string; wasmBase64: string }>,
        physicsJs: string, physicsWasmBase64: string,
        context: BuildContext, manifestJson: string
    ): Record<string, string> {
        const entries: string[] = [];
        for (const [path, dataUrl] of assets) {
            entries.push(`"${path}":"${dataUrl}"`);
        }

        let spineScript = '';
        if (spineModules.length > 0) {
            const parts = spineModules.map(m => {
                const tag = m.version.replace('.', '');
                return `var __SPINE_${tag}_WASM_B64__="${m.wasmBase64}";\nvar __SPINE_${tag}_MODULE__=(function(){${m.js};return ESSpineModule;})();`;
            });
            const moduleEntries = spineModules.map(m => {
                const tag = m.version.replace('.', '');
                return `"${m.version}":{factory:__SPINE_${tag}_MODULE__,wasmBase64:__SPINE_${tag}_WASM_B64__}`;
            });
            parts.push(`var __ES_SPINE_MODULES__={${moduleEntries.join(',')}};`);
            spineScript = `<script>\n${parts.join('\n')}\n</script>`;
        }

        let physicsScript = '';
        if (physicsJs && physicsWasmBase64) {
            physicsScript = `<script>\nvar __PHYSICS_WASM_B64__="${physicsWasmBase64}";\n${physicsJs}\n</script>`;
        }

        const enableCTA = context.config.playableSettings?.enableBuiltinCTA ?? false;
        const ctaUrl = JSON.stringify(context.config.playableSettings?.ctaUrl || '');

        const sceneItems = allScenes.map(s => `{name:${JSON.stringify(s.name)},data:${s.data}}`);

        return {
            WASM_SDK: wasmSdk,
            SPINE_SCRIPT: spineScript,
            PHYSICS_SCRIPT: physicsScript,
            GAME_CODE: gameCode,
            ASSETS_MAP: `{${entries.join(',')}}`,
            SCENES_DATA: `[${sceneItems.join(',')}]`,
            STARTUP_SCENE: startupScene,
            PHYSICS_CONFIG: generatePhysicsConfig(context),
            MANIFEST: manifestJson,
            RUNTIME_CONFIG: this.generateRuntimeConfigCode(context),
            RUNTIME_APP_CONFIG: this.generateRuntimeAppConfigCode(context),
            CTA_STYLE: enableCTA
                ? '#cta{position:fixed;bottom:5%;left:50%;transform:translateX(-50%);padding:12px 32px;font-size:18px;font-weight:bold;color:#fff;background:#ff4444;border:none;border-radius:8px;cursor:pointer;z-index:999;text-transform:uppercase;box-shadow:0 2px 8px rgba(0,0,0,0.3)}\n#cta:active{transform:translateX(-50%) scale(0.95)}'
                : '',
            CTA_HTML: enableCTA
                ? '<button id="cta" style="display:none">Install Now</button>'
                : '',
            CTA_SCRIPT: enableCTA
                ? `function installCTA(){\n  if(typeof mraid!=='undefined'&&mraid.open){mraid.open(${ctaUrl})}\n  else{window.open(${ctaUrl},'_blank')}\n}\ndocument.getElementById('cta').addEventListener('click',installCTA);`
                : '',
            CTA_SHOW: enableCTA
                ? "document.getElementById('cta').style.display='block';"
                : '',
        };
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
