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
import { isUUID } from '../asset/AssetLibrary';
import { initializeEsbuild, createBuildVirtualFsPlugin } from './ArtifactBuilder';
import type { NativeFS } from '../types/NativeFS';

// =============================================================================
// MIME Types
// =============================================================================

const MIME_TYPES: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    atlas: 'text/plain',
    json: 'application/json',
    skel: 'application/octet-stream',
};

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
                    spineWasmBase64 = this.arrayBufferToBase64(spineWasm);
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
                    physicsWasmBase64 = this.arrayBufferToBase64(physicsWasm);
                    progress.log('info', 'Physics module loaded');
                }
            }

            // 6. Collect inline assets
            progress.setPhase('assembling');
            progress.setCurrentTask('Collecting assets...', 0);
            const assets = await this.collectInlineAssets(fs, projectDir, artifact);
            for (let i = 0; i < artifact.atlasResult.pages.length; i++) {
                const base64 = this.arrayBufferToBase64(artifact.atlasResult.pages[i].imageData);
                assets.set(`atlas_${i}.png`, `data:image/png;base64,${base64}`);
            }
            progress.log('info', `Collected ${assets.size} assets`);

            // 7. Assemble HTML
            progress.setCurrentTask('Assembling HTML...', 50);
            const html = this.assembleHTML(
                wasmSdk, gameCode, rewrittenScene, assets,
                spineJsSource, spineWasmBase64,
                physicsJsSource, physicsWasmBase64,
                context
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
            treeShaking: false,
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
        }> | undefined;
        if (!entities) return;

        for (const entity of entities) {
            for (const comp of entity.components || []) {
                if (comp.type === 'Sprite' && comp.data) {
                    if (typeof comp.data.texture === 'string' && isUUID(comp.data.texture)) {
                        const path = artifact.assetLibrary.getPath(comp.data.texture);
                        if (path) comp.data.texture = path;
                    }
                    if (typeof comp.data.material === 'string' && isUUID(comp.data.material)) {
                        const path = artifact.assetLibrary.getPath(comp.data.material);
                        if (path) comp.data.material = path;
                    }
                }
                if (comp.type === 'SpineAnimation' && comp.data) {
                    if (typeof comp.data.skeletonPath === 'string' && isUUID(comp.data.skeletonPath)) {
                        const path = artifact.assetLibrary.getPath(comp.data.skeletonPath);
                        if (path) comp.data.skeletonPath = path;
                    }
                    if (typeof comp.data.atlasPath === 'string' && isUUID(comp.data.atlasPath)) {
                        const path = artifact.assetLibrary.getPath(comp.data.atlasPath);
                        if (path) comp.data.atlasPath = path;
                    }
                    if (typeof comp.data.material === 'string' && isUUID(comp.data.material)) {
                        const path = artifact.assetLibrary.getPath(comp.data.material);
                        if (path) comp.data.material = path;
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
        const assetsDir = joinPath(projectDir, 'assets');
        if (await fs.exists(assetsDir)) {
            await this.walkDirectory(fs, assetsDir, 'assets', allFiles);
        }

        for (const relativePath of allFiles) {
            if (artifact.packedPaths.has(relativePath)) continue;
            if (relativePath.endsWith('.esshader')) continue;

            if (compiledMaterialPaths.has(relativePath)) {
                const mat = artifact.compiledMaterials.find(m => m.relativePath === relativePath);
                if (mat) {
                    const base64 = btoa(mat.json);
                    assets.set(relativePath, `data:application/json;base64,${base64}`);
                }
                continue;
            }

            const ext = getFileExtension(relativePath);
            const mimeType = MIME_TYPES[ext];
            if (!mimeType) continue;

            const fullPath = joinPath(projectDir, relativePath);
            const binary = await fs.readBinaryFile(fullPath);
            if (binary) {
                const base64 = this.arrayBufferToBase64(binary);
                assets.set(relativePath, `data:${mimeType};base64,${base64}`);
            }
        }

        return assets;
    }

    private async walkDirectory(
        fs: NativeFS,
        absolutePath: string,
        relativePath: string,
        result: Set<string>
    ): Promise<void> {
        const entries = await fs.listDirectoryDetailed(absolutePath);
        for (const entry of entries) {
            const childAbsolute = joinPath(absolutePath, entry.name);
            const childRelative = `${relativePath}/${entry.name}`;
            if (entry.isDirectory) {
                await this.walkDirectory(fs, childAbsolute, childRelative, result);
            } else {
                result.add(childRelative);
            }
        }
    }

    private assembleHTML(
        wasmSdk: string, gameCode: string, sceneData: string,
        assets: Map<string, string>,
        spineJs: string, spineWasmBase64: string,
        physicsJs: string, physicsWasmBase64: string,
        context: BuildContext
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

        return HTML_TEMPLATE
            .replace('{{WASM_SDK}}', () => wasmSdk)
            .replace('{{SPINE_SCRIPT}}', () => spineScript)
            .replace('{{PHYSICS_SCRIPT}}', () => physicsScript)
            .replace('{{GAME_CODE}}', () => gameCode)
            .replace('{{ASSETS_MAP}}', () => `{${entries.join(',')}}`)
            .replace('{{SCENE_DATA}}', () => sceneData)
            .replace('{{PHYSICS_CONFIG}}', () => physicsConfig);
    }

    private arrayBufferToBase64(buffer: Uint8Array): string {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }
}

// =============================================================================
// HTML Template
// =============================================================================

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<meta name="ad.size" content="width=320,height=480">
<title>Playable</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:#000}
#canvas{display:block;width:100%;height:100%;touch-action:none}
</style>
</head>
<body>
<canvas id="canvas"></canvas>
<script>
{{WASM_SDK}}
</script>
{{SPINE_SCRIPT}}
{{PHYSICS_SCRIPT}}
<script>
{{GAME_CODE}}
</script>
<script>
var __PA__={{ASSETS_MAP}};
var __SCENE__={{SCENE_DATA}};

function loadImagePixels(dataUrl){
  return new Promise(function(resolve,reject){
    var img=new Image();
    img.onload=function(){
      var cv=document.createElement('canvas');
      cv.width=img.width;cv.height=img.height;
      var ctx=cv.getContext('2d');
      ctx.drawImage(img,0,0);
      var id=ctx.getImageData(0,0,img.width,img.height);
      resolve({width:img.width,height:img.height,pixels:new Uint8Array(id.data.buffer)});
    };
    img.onerror=reject;
    img.src=dataUrl;
  });
}

function decodeText(dataUrl){return atob(dataUrl.split(',')[1])}

function decodeBinary(dataUrl){
  var b=atob(dataUrl.split(',')[1]);
  var a=new Uint8Array(b.length);
  for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);
  return a;
}

(async function(){
  var c=document.getElementById('canvas');
  function resize(){var dpr=window.devicePixelRatio||1;c.width=window.innerWidth*dpr;c.height=window.innerHeight*dpr}
  window.addEventListener('resize',resize);
  resize();

  var Module=await ESEngineModule({canvas:c,print:function(t){console.log(t)},printErr:function(t){console.error(t)}});
  var es=window.esengine;
  if(!es||!es.createWebApp){console.error('esengine not found');return}

  var app=es.createWebApp(Module);
  if(typeof __PA__!=='undefined')es.registerEmbeddedAssets(app,__PA__);
  es.flushPendingSystems(app);

  var spineModule=null;
  if(typeof ESSpineModule!=='undefined'){
    try{
      spineModule=await ESSpineModule({
        instantiateWasm:function(imports,cb){
          var b=atob(__SPINE_WASM_B64__);
          var a=new Uint8Array(b.length);
          for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);
          WebAssembly.instantiate(a,imports).then(function(r){cb(r.instance,r.module)});
          return {};
        }
      });
    }catch(e){console.warn('Spine module not available:',e)}
  }

  var physicsModule=null;
  if(typeof ESPhysicsModule!=='undefined'){
    try{
      physicsModule=await ESPhysicsModule({
        instantiateWasm:function(imports,cb){
          var b=atob(__PHYSICS_WASM_B64__);
          var a=new Uint8Array(b.length);
          for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);
          WebAssembly.instantiate(a,imports).then(function(r){cb(r.instance,r.module)});
          return {};
        }
      });
    }catch(e){console.warn('Physics module not available:',e)}
  }

  var provider={
    loadPixels:function(ref){var d=__PA__[ref];if(!d)throw new Error('Asset not found: '+ref);return loadImagePixels(d)},
    readText:function(ref){var d=__PA__[ref];if(!d)throw new Error('Asset not found: '+ref);return decodeText(d)},
    readBinary:function(ref){var d=__PA__[ref];if(!d)throw new Error('Asset not found: '+ref);return decodeBinary(d)},
    resolvePath:function(ref){return ref}
  };

  await es.loadRuntimeScene(app,Module,__SCENE__,provider,spineModule,physicsModule,{{PHYSICS_CONFIG}});

  var screenAspect=c.width/c.height;
  es.updateCameraAspectRatio(app.world,screenAspect);

  app.run();
})();
</script>
</body>
</html>`;
