/**
 * @file    PlayableBuilder.ts
 * @brief   Builder for playable ads (single HTML file output)
 *
 * Build Pipeline:
 * 1. Load pre-built esengine.single.js (WASM module loader)
 * 2. Compile user scripts to IIFE format (with esengine bundled)
 * 3. Read startup scene JSON
 * 4. Collect and inline assets as base64 data URLs
 * 5. Assemble final HTML using scene-driven template
 */

import * as esbuild from 'esbuild-wasm/esm/browser';
import type { BuildResult, BuildContext } from './BuildService';
import { BuildProgressReporter } from './BuildProgress';
import { BuildCache, type BuildCacheData } from './BuildCache';
import { getEditorContext } from '../context/EditorContext';
import { findTsFiles, EDITOR_ONLY_DIRS } from '../scripting/ScriptLoader';

// =============================================================================
// Types
// =============================================================================

interface NativeFS {
    exists(path: string): Promise<boolean>;
    readFile(path: string): Promise<string | null>;
    readBinaryFile(path: string): Promise<Uint8Array | null>;
    writeFile(path: string, content: string): Promise<boolean>;
    listDirectoryDetailed(path: string): Promise<Array<{ name: string; isDirectory: boolean }>>;
    createDirectory(path: string): Promise<boolean>;
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

function getDir(filePath: string): string {
    const normalized = normalizePath(filePath);
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash > 0 ? normalized.substring(0, lastSlash) : normalized;
}

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
// HTML Template (Scene-Driven)
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

function createTextureFromPixels(mod,r){
  var rm=mod.getResourceManager();
  var ptr=mod._malloc(r.pixels.length);
  mod.HEAPU8.set(r.pixels,ptr);
  var h=rm.createTexture(r.width,r.height,ptr,r.pixels.length,1);
  mod._free(ptr);
  return h;
}

function decodeText(dataUrl){return atob(dataUrl.split(',')[1])}

function decodeBinary(dataUrl){
  var b=atob(dataUrl.split(',')[1]);
  var a=new Uint8Array(b.length);
  for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);
  return a;
}

function ensureFSDir(mod,path){
  var parts=path.split('/');var cur='';
  for(var i=0;i<parts.length-1;i++){
    cur+=(cur?'/':'')+parts[i];
    try{mod.FS.mkdir(cur)}catch(e){}
  }
}

function parseAtlasTextures(content){
  var textures=[];var lines=content.split('\\n');
  for(var i=0;i<lines.length;i++){
    var line=lines[i].trim();
    if(line&&line.indexOf(':')===-1&&(/\\.png$/i.test(line)||/\\.jpg$/i.test(line)))
      textures.push(line);
  }
  return textures;
}

async function loadSceneTextures(mod,scene){
  var cache={};
  for(var i=0;i<scene.entities.length;i++){
    var ent=scene.entities[i];
    for(var j=0;j<ent.components.length;j++){
      var comp=ent.components[j];
      if(comp.type==='Sprite'&&comp.data.texture&&typeof comp.data.texture==='string'){
        var tp=comp.data.texture;
        if(!cache[tp]){
          var d=__PA__[tp];
          if(d){
            try{cache[tp]=createTextureFromPixels(mod,await loadImagePixels(d))}
            catch(e){console.warn('Failed to load texture:',tp,e);cache[tp]=0}
          }else{cache[tp]=0}
        }
      }
    }
  }
  return cache;
}

async function loadSpineAssets(mod,scene){
  var rm=mod.getResourceManager();
  for(var i=0;i<scene.entities.length;i++){
    var ent=scene.entities[i];
    for(var j=0;j<ent.components.length;j++){
      var comp=ent.components[j];
      if(comp.type!=='SpineAnimation'||!comp.data)continue;
      var skelPath=comp.data.skeletonPath,atlasPath=comp.data.atlasPath;
      if(!skelPath||!atlasPath)continue;
      var atlasData=__PA__[atlasPath];
      if(atlasData){
        var atlasContent=decodeText(atlasData);
        ensureFSDir(mod,atlasPath);
        mod.FS.writeFile(atlasPath,atlasContent);
        var texNames=parseAtlasTextures(atlasContent);
        var atlasDir=atlasPath.substring(0,atlasPath.lastIndexOf('/'));
        for(var k=0;k<texNames.length;k++){
          var texPath=atlasDir+'/'+texNames[k];
          var texData=__PA__[texPath];
          if(texData){
            try{
              var h=createTextureFromPixels(mod,await loadImagePixels(texData));
              rm.registerTextureWithPath(h,texPath);
            }catch(e){console.warn('Failed to load spine texture:',texPath,e)}
          }
        }
      }
      var skelData=__PA__[skelPath];
      if(skelData){
        ensureFSDir(mod,skelPath);
        if(skelPath.endsWith('.skel'))mod.FS.writeFile(skelPath,decodeBinary(skelData));
        else mod.FS.writeFile(skelPath,decodeText(skelData));
      }
    }
  }
}

function updateSpriteTextures(world,scene,cache,entityMap){
  var es=window.esengine;
  for(var i=0;i<scene.entities.length;i++){
    var ed=scene.entities[i];
    var entity=entityMap.get(ed.id);
    if(entity===undefined)continue;
    for(var j=0;j<ed.components.length;j++){
      var comp=ed.components[j];
      if(comp.type==='Sprite'&&comp.data.texture&&typeof comp.data.texture==='string'){
        var sprite=world.get(entity,es.Sprite);
        if(sprite){sprite.texture=cache[comp.data.texture]||0;world.insert(entity,es.Sprite,sprite)}
      }
    }
  }
}

function applyTextureMetadata(mod,scene,cache){
  if(!scene.textureMetadata)return;
  var rm=mod.getResourceManager();
  for(var tp in scene.textureMetadata){
    var h=cache[tp];
    if(h&&h>0){
      var m=scene.textureMetadata[tp];
      if(m&&m.sliceBorder){
        var b=m.sliceBorder;
        rm.setTextureMetadata(h,b.left,b.right,b.top,b.bottom);
      }
    }
  }
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
  es.flushPendingSystems(app);

  var textureCache=await loadSceneTextures(Module,__SCENE__);
  applyTextureMetadata(Module,__SCENE__,textureCache);
  await loadSpineAssets(Module,__SCENE__);
  var entityMap=es.loadSceneData(app.world,__SCENE__);
  updateSpriteTextures(app.world,__SCENE__,textureCache,entityMap);

  var screenAspect=c.width/c.height;
  es.updateCameraAspectRatio(app.world,screenAspect);

  app.run();
})();
</script>
</body>
</html>`;

// =============================================================================
// PlayableBuilder
// =============================================================================

export class PlayableBuilder {
    constructor(context: BuildContext) {
        this.context_ = context;
        this.fs_ = getEditorContext().fs ?? null;
        this.projectDir_ = getProjectDir(context.projectPath);
        this.progress_ = context.progress || new BuildProgressReporter();
        this.cache_ = context.cache || null;
    }

    // =========================================================================
    // Public Methods
    // =========================================================================

    async build(): Promise<BuildResult> {
        if (!this.fs_) {
            return { success: false, error: 'Native file system not available' };
        }

        const settings = this.context_.config.playableSettings;
        if (!settings) {
            return { success: false, error: 'Playable settings not configured' };
        }

        const startupScene = settings.startupScene || this.context_.config.scenes[0];
        if (!startupScene) {
            return { success: false, error: 'No startup scene configured. Add a scene to the build or set a startup scene.' };
        }

        this.progress_.setPhase('preparing');
        this.progress_.log('info', 'Starting Playable build...');

        try {
            // Check cache for compiled scripts
            let cachedData: BuildCacheData | null = null;
            if (this.cache_) {
                cachedData = await this.cache_.loadCache(this.context_.config.id);
            }

            // 1. Load SDK
            this.progress_.setCurrentTask('Loading SDK...', 0);
            const wasmSdk = await this.loadSdk();
            if (!wasmSdk) {
                return {
                    success: false,
                    error: "SDK not found. Please run 'scripts/build-web-single.bat' first.",
                };
            }
            this.progress_.log('info', `SDK loaded: ${wasmSdk.length} bytes`);

            // 2. Compile user scripts
            this.progress_.setPhase('compiling');
            this.progress_.setCurrentTask('Compiling scripts...', 0);

            let gameCode: string;
            const scriptsPath = joinPath(this.projectDir_, 'src');
            const scriptFiles = await this.getScriptFiles(scriptsPath);

            if (cachedData?.compiledScripts && this.cache_) {
                const changes = await this.cache_.getChangedFiles(scriptFiles, cachedData);
                if (!this.cache_.hasChanges(changes)) {
                    gameCode = cachedData.compiledScripts;
                    this.progress_.log('info', 'Using cached compiled scripts');
                } else {
                    gameCode = await this.compileUserScripts();
                    this.progress_.log('info', `Scripts compiled: ${gameCode.length} bytes`);
                }
            } else {
                gameCode = await this.compileUserScripts();
                this.progress_.log('info', `Scripts compiled: ${gameCode.length} bytes`);
            }

            // 3. Read startup scene
            this.progress_.setCurrentTask('Loading scene...', 50);
            const scenePath = this.resolveScenePath(startupScene);
            const sceneContent = await this.fs_.readFile(scenePath);
            if (!sceneContent) {
                return { success: false, error: `Startup scene not found: ${scenePath}` };
            }
            this.progress_.log('info', `Scene loaded: ${scenePath}`);

            // 4. Collect assets
            this.progress_.setPhase('processing_assets');
            this.progress_.setCurrentTask('Collecting assets...', 0);
            const assets = await this.collectAssets();
            this.progress_.log('info', `Collected ${assets.size} assets`);

            // 5. Assemble HTML
            this.progress_.setPhase('assembling');
            this.progress_.setCurrentTask('Assembling HTML...', 0);
            const html = this.assembleHTML(wasmSdk, gameCode, sceneContent, assets);
            this.progress_.log('info', `HTML assembled: ${html.length} bytes`);

            // 6. Write output
            this.progress_.setPhase('writing');
            this.progress_.setCurrentTask('Writing output...', 0);
            const outputPath = this.resolveOutputPath(settings.outputPath);
            const outputDir = getDir(outputPath);

            await this.fs_.createDirectory(outputDir);
            const success = await this.fs_.writeFile(outputPath, html);

            if (success) {
                // Save cache
                if (this.cache_) {
                    const cacheData = await this.cache_.createCacheData(
                        this.context_.config.id,
                        scriptFiles,
                        gameCode
                    );
                    await this.cache_.saveCache(cacheData);
                }

                this.progress_.log('info', `Build successful: ${outputPath}`);
                return {
                    success: true,
                    outputPath,
                    outputSize: new TextEncoder().encode(html).length,
                };
            } else {
                return { success: false, error: 'Failed to write output file' };
            }
        } catch (err) {
            console.error('[PlayableBuilder] Build error:', err);
            this.progress_.fail(String(err));
            return { success: false, error: String(err) };
        }
    }

    private async getScriptFiles(srcPath: string): Promise<string[]> {
        if (!await this.fs_!.exists(srcPath)) {
            return [];
        }
        return findTsFiles(this.fs_!, srcPath, EDITOR_ONLY_DIRS);
    }

    // =========================================================================
    // Private Methods
    // =========================================================================

    private async loadSdk(): Promise<string | null> {
        try {
            const response = await fetch('/wasm/esengine.single.js');
            if (!response.ok) return null;
            return await response.text();
        } catch {
            return null;
        }
    }

    private resolveScenePath(scenePath: string): string {
        if (isAbsolutePath(scenePath)) {
            return normalizePath(scenePath);
        }
        return joinPath(this.projectDir_, scenePath);
    }

    private resolveOutputPath(outputPath: string): string {
        if (isAbsolutePath(outputPath)) {
            return normalizePath(outputPath);
        }
        return joinPath(this.projectDir_, outputPath);
    }

    private async compileUserScripts(): Promise<string> {
        const scriptsPath = joinPath(this.projectDir_, 'src');

        if (!await this.fs_!.exists(scriptsPath)) {
            return this.createMinimalGameCode();
        }

        const scripts = await findTsFiles(this.fs_!, scriptsPath, EDITOR_ONLY_DIRS);

        if (scripts.length === 0) {
            return this.createMinimalGameCode();
        }

        // Generate entry content that:
        // 1. Imports esengine and exposes it globally
        // 2. Imports all user scripts (to register components)
        const imports = scripts.map(p => `import "${p}";`).join('\n');
        const entryContent = `
import * as esengine from 'esengine';
(window as any).esengine = esengine;
${imports}
`;

        console.log('[PlayableBuilder] Compiling scripts...');

        const settings = this.context_.config.playableSettings!;
        const defines: Record<string, string> = {
            'process.env.EDITOR': 'false',
        };
        for (const def of this.context_.config.defines) {
            defines[`process.env.${def}`] = 'true';
        }

        await this.initializeEsbuild();

        const result = await esbuild.build({
            stdin: {
                contents: entryContent,
                loader: 'ts',
                resolveDir: scriptsPath,
            },
            bundle: true,
            format: 'iife',
            write: false,
            platform: 'browser',
            target: 'es2020',
            minify: settings.minifyCode,
            define: defines,
            plugins: [this.createVirtualFsPlugin()],
        });

        return result.outputFiles?.[0]?.text ?? this.createMinimalGameCode();
    }

    private createMinimalGameCode(): string {
        return `
(function(){
  var esengine = window.esengine || {};
  // Minimal esengine stub if no user scripts
})();
`;
    }

    private async initializeEsbuild(): Promise<void> {
        try {
            await esbuild.initialize({
                wasmURL: 'https://cdn.jsdelivr.net/npm/esbuild-wasm@0.27.2/esbuild.wasm',
            });
        } catch (err) {
            if (!String(err).includes('Cannot call "initialize" more than once')) {
                throw err;
            }
        }
    }

    private createVirtualFsPlugin(): esbuild.Plugin {
        const fs = this.fs_!;
        const projectDir = this.projectDir_;

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
                        // Bare module specifier
                        if (args.path === 'esengine') {
                            resolvedPath = joinPath(projectDir, '.esengine/sdk/index.js');
                        } else if (args.path === 'esengine/wasm') {
                            resolvedPath = joinPath(projectDir, '.esengine/sdk/wasm.js');
                        } else {
                            const pkgPath = joinPath(projectDir, 'node_modules', args.path, 'package.json');
                            const pkgContent = await fs.readFile(pkgPath);
                            if (pkgContent) {
                                try {
                                    const pkg = JSON.parse(pkgContent);
                                    let entry = pkg.module || pkg.main || 'index.js';
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
                                    resolvedPath = joinPath(projectDir, 'node_modules', args.path, entry);
                                } catch {
                                    throw new Error(`Failed to parse package.json for: ${args.path}`);
                                }
                            } else {
                                throw new Error(`Module not found: ${args.path}. Please install it with npm.`);
                            }
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
                        } else {
                            resolvedPath += '.ts';
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

    private async collectAssets(): Promise<Map<string, string>> {
        const assets = new Map<string, string>();
        const assetsPath = joinPath(this.projectDir_, 'assets');

        if (await this.fs_!.exists(assetsPath)) {
            await this.collectAssetsRecursive(assetsPath, 'assets', assets);
        }

        return assets;
    }

    private async collectAssetsRecursive(
        dirPath: string,
        relativePath: string,
        assets: Map<string, string>
    ): Promise<void> {
        const entries = await this.fs_!.listDirectoryDetailed(dirPath);

        for (const entry of entries) {
            const fullPath = joinPath(dirPath, entry.name);
            const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

            if (entry.isDirectory) {
                await this.collectAssetsRecursive(fullPath, entryRelativePath, assets);
            } else {
                const ext = getFileExtension(entry.name);
                const mimeType = MIME_TYPES[ext];

                if (mimeType) {
                    const binary = await this.fs_!.readBinaryFile(fullPath);
                    if (binary) {
                        const base64 = this.arrayBufferToBase64(binary);
                        const dataUrl = `data:${mimeType};base64,${base64}`;
                        assets.set(entryRelativePath, dataUrl);
                    }
                }
            }
        }
    }

    private assembleHTML(wasmSdk: string, gameCode: string, sceneData: string, assets: Map<string, string>): string {
        const entries: string[] = [];
        for (const [path, dataUrl] of assets) {
            entries.push(`"${path}":"${dataUrl}"`);
        }
        return HTML_TEMPLATE
            .replace('{{WASM_SDK}}', wasmSdk)
            .replace('{{GAME_CODE}}', gameCode)
            .replace('{{ASSETS_MAP}}', `{${entries.join(',')}}`)
            .replace('{{SCENE_DATA}}', sceneData);
    }

    private arrayBufferToBase64(buffer: Uint8Array): string {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    // =========================================================================
    // Member Variables
    // =========================================================================

    private context_: BuildContext;
    private fs_: NativeFS | null;
    private projectDir_: string;
    private progress_: BuildProgressReporter;
    private cache_: BuildCache | null;
}
