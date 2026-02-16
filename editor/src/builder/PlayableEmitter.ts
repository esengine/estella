/**
 * @file    PlayableEmitter.ts
 * @brief   Emitter that produces a single HTML file for playable ads
 */

import * as esbuild from 'esbuild-wasm/esm/browser';
import type { PlatformEmitter, BuildArtifact } from './PlatformEmitter';
import type { BuildResult, BuildContext } from './BuildService';
import { BuildProgressReporter } from './BuildProgress';
import { getEditorContext } from '../context/EditorContext';
import { findTsFiles, EDITOR_ONLY_DIRS } from '../scripting/ScriptLoader';
import { joinPath, getFileExtension, isAbsolutePath, getParentDir, normalizePath, getProjectDir } from '../utils/path';
import { isUUID, getComponentRefFields } from '../asset/AssetLibrary';
import { initializeEsbuild, createBuildVirtualFsPlugin, arrayBufferToBase64, generateAddressableManifest, convertPrefabWithResolvedRefs } from './ArtifactBuilder';
import { PLAYABLE_HTML_TEMPLATE } from './templates';
import type { NativeFS } from '../types/NativeFS';
import { getAssetMimeType, getAssetTypeEntry } from 'esengine';

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
            const gameCode = await this.compileUserScripts(fs, projectDir, context);
            progress.log('info', `Scripts compiled: ${gameCode.length} bytes`);

            // 3. Process startup scene (resolve UUIDs)
            const sceneName = startupScene.replace(/.*\//, '').replace('.esscene', '');
            const sceneData = artifact.scenes.get(sceneName);
            if (!sceneData) {
                return { success: false, error: `Startup scene not found: ${startupScene}` };
            }
            const sceneDataCopy = JSON.parse(JSON.stringify(sceneData));
            this.resolveSceneUUIDs(sceneDataCopy, artifact);
            const rewrittenScene = JSON.stringify(sceneDataCopy);

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
                wasmSdk, gameCode, rewrittenScene, sceneName, assets,
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
                progress.log('info', `Build successful: ${outputPath}`);
                return {
                    success: true,
                    outputPath,
                    outputSize: new TextEncoder().encode(html).length,
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

    private async compileUserScripts(fs: NativeFS, projectDir: string, context: BuildContext): Promise<string> {
        const scriptsPath = joinPath(projectDir, 'src');
        const hasSrcDir = await fs.exists(scriptsPath);

        let imports = '';
        if (hasSrcDir) {
            const scripts = await findTsFiles(fs, scriptsPath, EDITOR_ONLY_DIRS);
            imports = scripts.map(p => `import "${p}";`).join('\n');
        }

        const entryContent = `
import * as esengine from 'esengine';
(window as any).esengine = esengine;
${imports}
`;

        const settings = context.config.playableSettings!;
        const defines: Record<string, string> = {
            'process.env.EDITOR': 'false',
        };
        for (const def of context.config.defines) {
            defines[`process.env.${def}`] = 'true';
        }

        await initializeEsbuild();

        const plugin = createBuildVirtualFsPlugin(fs, projectDir, async (path) => {
            if (path === 'esengine') {
                return { contents: await fs.getSdkEsmJs(), loader: 'js' as esbuild.Loader };
            }
            if (path === 'esengine/wasm') {
                return { contents: await fs.getSdkWasmJs(), loader: 'js' as esbuild.Loader };
            }
            return { contents: '', loader: 'js' as esbuild.Loader };
        });

        const result = await esbuild.build({
            stdin: {
                contents: entryContent,
                loader: 'ts',
                resolveDir: hasSrcDir ? scriptsPath : projectDir,
            },
            bundle: true,
            format: 'iife',
            write: false,
            platform: 'browser',
            target: 'es2020',
            treeShaking: true,
            minify: settings.minifyCode,
            define: defines,
            plugins: [plugin],
        });

        const output = result.outputFiles?.[0]?.text;
        if (!output) {
            throw new Error('esbuild produced no output');
        }
        return output;
    }

    private resolveSceneUUIDs(sceneData: Record<string, unknown>, artifact: BuildArtifact): void {
        const entities = sceneData.entities as Array<{
            components: Array<{ type: string; data: Record<string, unknown> }>;
            prefab?: { prefabPath: string };
        }> | undefined;
        if (!entities) return;

        for (const entity of entities) {
            if (entity.prefab && typeof entity.prefab.prefabPath === 'string' && isUUID(entity.prefab.prefabPath)) {
                const path = artifact.assetLibrary.getPath(entity.prefab.prefabPath);
                if (path) entity.prefab.prefabPath = path;
            }
            for (const comp of entity.components || []) {
                const refFields = getComponentRefFields(comp.type);
                if (!refFields || !comp.data) continue;
                for (const field of refFields) {
                    const value = comp.data[field];
                    if (typeof value === 'string' && isUUID(value)) {
                        const path = artifact.assetLibrary.getPath(value);
                        if (path) comp.data[field] = path;
                    }
                }
            }
        }

        const textureMetadata = sceneData.textureMetadata as Record<string, unknown> | undefined;
        if (textureMetadata) {
            const resolved: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(textureMetadata)) {
                if (isUUID(key)) {
                    const path = artifact.assetLibrary.getPath(key);
                    resolved[path ?? key] = value;
                } else {
                    resolved[key] = value;
                }
            }
            sceneData.textureMetadata = resolved;
        }
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
            if (artifact.packedPaths.has(relativePath)) continue;
            const entry = getAssetTypeEntry(relativePath);
            if (entry?.editorType === 'shader') continue;

            if (compiledMaterialPaths.has(relativePath)) {
                const mat = artifact.compiledMaterials.find(m => m.relativePath === relativePath);
                if (mat) {
                    const base64 = btoa(mat.json);
                    assets.set(relativePath, `data:application/json;base64,${base64}`);
                }
                continue;
            }

            if (entry?.editorType === 'prefab') {
                pending.push(
                    fs.readFile(joinPath(projectDir, relativePath)).then(content => {
                        if (content) {
                            const json = convertPrefabWithResolvedRefs(content, artifact);
                            assets.set(relativePath, `data:application/json;base64,${btoa(json)}`);
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
        return assets;
    }

    private assembleHTML(
        wasmSdk: string, gameCode: string, sceneData: string, sceneName: string,
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

        const physicsConfig = JSON.stringify({
            gravity: context.physicsGravity ?? { x: 0, y: -9.81 },
            fixedTimestep: context.physicsFixedTimestep ?? 1 / 60,
            subStepCount: context.physicsSubStepCount ?? 4,
        });

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
            .replace('{{SCENE_DATA}}', () => sceneData)
            .replace('{{SCENE_NAME}}', () => sceneName)
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
