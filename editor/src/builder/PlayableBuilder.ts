/**
 * @file    PlayableBuilder.ts
 * @brief   Builder for playable ads (single HTML file output)
 *
 * Build Pipeline:
 * 1. Load pre-built esengine.single.js (WASM module loader)
 * 2. Compile user scripts to IIFE format (with esengine bundled)
 * 3. Read startup scene JSON
 * 4. Compile materials (.esmaterial + .esshader → single JSON)
 * 5. Collect and inline assets as base64 data URLs (keyed by UUID)
 * 6. Assemble final HTML using scene-driven template
 */

import * as esbuild from 'esbuild-wasm/esm/browser';
import type { BuildResult, BuildContext } from './BuildService';
import { BuildProgressReporter } from './BuildProgress';
import { BuildCache, type BuildCacheData } from './BuildCache';
import { getEditorContext } from '../context/EditorContext';
import { findTsFiles, EDITOR_ONLY_DIRS } from '../scripting/ScriptLoader';
import { BuildAssetCollector, AssetExportConfigService } from './AssetCollector';
import { TextureAtlasPacker, type AtlasResult } from './TextureAtlas';
import { AssetLibrary, isUUID } from '../asset/AssetLibrary';

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

function getDirName(path: string): string {
    const lastSlash = path.lastIndexOf('/');
    return lastSlash > 0 ? path.substring(0, lastSlash) : '';
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
        var ref=comp.data.texture;
        if(!cache[ref]){
          var d=__PA__[ref];
          if(d){
            try{cache[ref]=createTextureFromPixels(mod,await loadImagePixels(d))}
            catch(e){console.warn('Failed to load texture:',ref,e);cache[ref]=0}
          }else{cache[ref]=0}
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
      var skelRef=comp.data.skeletonPath,atlasRef=comp.data.atlasPath;
      if(!skelRef||!atlasRef)continue;
      var atlasData=__PA__[atlasRef];
      if(atlasData){
        var atlasContent=decodeText(atlasData);
        var atlasPath=atlasRef;
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
      var skelData=__PA__[skelRef];
      if(skelData){
        var skelPath=skelRef;
        ensureFSDir(mod,skelPath);
        if(skelPath.endsWith('.skel'))mod.FS.writeFile(skelPath,decodeBinary(skelData));
        else mod.FS.writeFile(skelPath,decodeText(skelData));
      }
    }
  }
}

function loadMaterials(scene){
  var es=window.esengine;
  var materialCache={};
  var shaderCache={};
  for(var i=0;i<scene.entities.length;i++){
    var ent=scene.entities[i];
    for(var j=0;j<ent.components.length;j++){
      var comp=ent.components[j];
      if(!comp.data||typeof comp.data.material!=='string'||!comp.data.material)continue;
      if(comp.type!=='Sprite'&&comp.type!=='SpineAnimation')continue;
      var matRef=comp.data.material;
      if(materialCache[matRef]!==undefined)continue;
      try{
        var matDataUrl=__PA__[matRef];
        if(!matDataUrl){materialCache[matRef]=0;continue}
        var matData=JSON.parse(decodeText(matDataUrl));
        if(!matData.vertexSource||!matData.fragmentSource){materialCache[matRef]=0;continue}
        var shaderKey=matData.vertexSource+matData.fragmentSource;
        var shaderHandle=shaderCache[shaderKey];
        if(!shaderHandle){
          shaderHandle=es.Material.createShader(matData.vertexSource,matData.fragmentSource);
          shaderCache[shaderKey]=shaderHandle;
        }
        materialCache[matRef]=es.Material.createFromAsset(matData,shaderHandle);
      }catch(e){console.warn('Failed to load material:',matRef,e);materialCache[matRef]=0}
    }
  }
  return materialCache;
}

function updateMaterials(world,scene,materialCache,entityMap){
  var es=window.esengine;
  for(var i=0;i<scene.entities.length;i++){
    var ed=scene.entities[i];
    var entity=entityMap.get(ed.id);
    if(entity===undefined)continue;
    for(var j=0;j<ed.components.length;j++){
      var comp=ed.components[j];
      if(!comp.data||typeof comp.data.material!=='string'||!comp.data.material)continue;
      var h=materialCache[comp.data.material]||0;
      if(!h)continue;
      if(comp.type==='Sprite'){
        var sprite=world.get(entity,es.Sprite);
        if(sprite){sprite.material=h;world.insert(entity,es.Sprite,sprite)}
      }else if(comp.type==='SpineAnimation'){
        var spine=world.get(entity,es.SpineAnimation);
        if(spine){spine.material=h;world.insert(entity,es.SpineAnimation,spine)}
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
  for(var ref in scene.textureMetadata){
    var h=cache[ref];
    if(h&&h>0){
      var m=scene.textureMetadata[ref];
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
  var materialCache=loadMaterials(__SCENE__);
  var entityMap=es.loadSceneData(app.world,__SCENE__);
  updateSpriteTextures(app.world,__SCENE__,textureCache,entityMap);
  updateMaterials(app.world,__SCENE__,materialCache,entityMap);

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
        this.assetLibrary_ = new AssetLibrary();
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
            await this.assetLibrary_.initialize(this.projectDir_, this.fs_);
            this.progress_.log('info', 'Asset library initialized');

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

            // 4. Pack texture atlas
            this.progress_.setPhase('processing_assets');
            this.progress_.setCurrentTask('Packing texture atlas...', 0);
            const { atlasResult, packedPaths } = await this.packTextureAtlas();
            if (atlasResult.pages.length > 0) {
                this.progress_.log('info', `Packed ${atlasResult.frameMap.size} textures into ${atlasResult.pages.length} atlas page(s)`);
            }

            // 5. Rewrite scene data with atlas UVs, then resolve all UUID refs to paths
            const sceneData = JSON.parse(sceneContent);
            const packer = new TextureAtlasPacker(this.fs_!, this.projectDir_, this.assetLibrary_);
            packer.rewriteSceneData(sceneData, atlasResult, '');
            this.resolveSceneUUIDs(sceneData);
            const rewrittenScene = JSON.stringify(sceneData);

            // 6. Compile materials
            this.progress_.setCurrentTask('Compiling materials...', 20);
            const compiledMaterials = await this.compileMaterials();
            this.progress_.log('info', `Compiled ${compiledMaterials.size} material(s)`);

            // 7. Collect assets (keyed by UUID, excluding packed textures, adding atlas pages)
            this.progress_.setCurrentTask('Collecting assets...', 30);
            const assets = await this.collectAssets(packedPaths, compiledMaterials);
            for (let i = 0; i < atlasResult.pages.length; i++) {
                const base64 = this.arrayBufferToBase64(atlasResult.pages[i].imageData);
                assets.set(`atlas_${i}.png`, `data:image/png;base64,${base64}`);
            }
            this.progress_.log('info', `Collected ${assets.size} assets`);

            // 8. Assemble HTML
            this.progress_.setPhase('assembling');
            this.progress_.setCurrentTask('Assembling HTML...', 0);
            const html = this.assembleHTML(wasmSdk, gameCode, rewrittenScene, assets);
            this.progress_.log('info', `HTML assembled: ${html.length} bytes`);

            // 9. Write output
            this.progress_.setPhase('writing');
            this.progress_.setCurrentTask('Writing output...', 0);
            const outputPath = this.resolveOutputPath(settings.outputPath);
            const outputDir = getDir(outputPath);

            await this.fs_.createDirectory(outputDir);
            const success = await this.fs_.writeFile(outputPath, html);

            if (success) {
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

    private parseEsShader(content: string): { vertex: string | null; fragment: string | null } {
        const vm = content.match(/#pragma\s+vertex\s*([\s\S]*?)#pragma\s+end/);
        const fm = content.match(/#pragma\s+fragment\s*([\s\S]*?)#pragma\s+end/);
        return { vertex: vm ? vm[1].trim() : null, fragment: fm ? fm[1].trim() : null };
    }

    private resolveShaderPath(materialPath: string, shaderPath: string): string {
        if (shaderPath.startsWith('/') || shaderPath.startsWith('assets/')) return shaderPath;
        const dir = getDirName(materialPath);
        return dir ? `${dir}/${shaderPath}` : shaderPath;
    }

    private async compileMaterials(): Promise<Map<string, { uuid: string; compiledJson: string }>> {
        const result = new Map<string, { uuid: string; compiledJson: string }>();
        const configService = new AssetExportConfigService(this.projectDir_, this.fs_!);
        const exportConfig = await configService.load();

        const collector = new BuildAssetCollector(this.fs_!, this.projectDir_, this.assetLibrary_);
        const assetPaths = await collector.collect(this.context_.config, exportConfig);

        for (const relativePath of assetPaths) {
            if (!relativePath.endsWith('.esmaterial')) continue;

            const uuid = this.assetLibrary_.getUuid(relativePath);
            if (!uuid) continue;

            const fullPath = joinPath(this.projectDir_, relativePath);
            const content = await this.fs_!.readFile(fullPath);
            if (!content) continue;

            try {
                const matData = JSON.parse(content);
                if (matData.type !== 'material' || !matData.shader) continue;

                const shaderRelPath = this.resolveShaderPath(relativePath, matData.shader);
                const shaderFullPath = joinPath(this.projectDir_, shaderRelPath);
                const shaderContent = await this.fs_!.readFile(shaderFullPath);
                if (!shaderContent) continue;

                const parsed = this.parseEsShader(shaderContent);
                if (!parsed.vertex || !parsed.fragment) continue;

                const compiled = {
                    type: 'material',
                    vertexSource: parsed.vertex,
                    fragmentSource: parsed.fragment,
                    blendMode: matData.blendMode ?? 0,
                    depthTest: matData.depthTest ?? false,
                    properties: matData.properties ?? {},
                };

                result.set(relativePath, {
                    uuid,
                    compiledJson: JSON.stringify(compiled),
                });
            } catch {
                console.warn(`[PlayableBuilder] Failed to compile material: ${relativePath}`);
            }
        }

        return result;
    }

    private async packTextureAtlas(): Promise<{ atlasResult: AtlasResult; packedPaths: Set<string> }> {
        const configService = new AssetExportConfigService(this.projectDir_, this.fs_!);
        const exportConfig = await configService.load();

        const collector = new BuildAssetCollector(this.fs_!, this.projectDir_, this.assetLibrary_);
        const assetPaths = await collector.collect(this.context_.config, exportConfig);

        const imagePaths = [...assetPaths].filter(p => {
            const ext = p.split('.').pop()?.toLowerCase() ?? '';
            return ext === 'png' || ext === 'jpg' || ext === 'jpeg';
        });

        const sceneDataList: Array<{ name: string; data: Record<string, unknown> }> = [];
        for (const scenePath of this.context_.config.scenes) {
            const fullPath = this.resolveScenePath(scenePath);
            const content = await this.fs_!.readFile(fullPath);
            if (content) {
                const name = scenePath.replace(/.*\//, '').replace('.esscene', '');
                sceneDataList.push({ name, data: JSON.parse(content) });
            }
        }

        const packer = new TextureAtlasPacker(this.fs_!, this.projectDir_, this.assetLibrary_);
        const atlasResult = await packer.pack(imagePaths, sceneDataList);

        const packedPaths = new Set<string>(atlasResult.frameMap.keys());
        return { atlasResult, packedPaths };
    }

    private async collectAssets(
        packedPaths: Set<string>,
        compiledMaterials: Map<string, { uuid: string; compiledJson: string }>
    ): Promise<Map<string, string>> {
        const assets = new Map<string, string>();

        const configService = new AssetExportConfigService(this.projectDir_, this.fs_!);
        const exportConfig = await configService.load();

        const collector = new BuildAssetCollector(this.fs_!, this.projectDir_, this.assetLibrary_);
        const assetPaths = await collector.collect(this.context_.config, exportConfig);

        const compiledMaterialPaths = new Set<string>(compiledMaterials.keys());

        for (const relativePath of assetPaths) {
            if (packedPaths.has(relativePath)) continue;
            if (relativePath.endsWith('.esshader')) continue;

            if (compiledMaterialPaths.has(relativePath)) {
                const compiled = compiledMaterials.get(relativePath)!;
                const base64 = btoa(compiled.compiledJson);
                assets.set(relativePath, `data:application/json;base64,${base64}`);
                continue;
            }

            const ext = getFileExtension(relativePath);
            const mimeType = MIME_TYPES[ext];
            if (!mimeType) continue;

            const fullPath = joinPath(this.projectDir_, relativePath);
            const binary = await this.fs_!.readBinaryFile(fullPath);
            if (binary) {
                const base64 = this.arrayBufferToBase64(binary);
                assets.set(relativePath, `data:${mimeType};base64,${base64}`);
            }
        }

        return assets;
    }

    private resolveSceneUUIDs(sceneData: Record<string, unknown>): void {
        const entities = sceneData.entities as Array<{
            components: Array<{ type: string; data: Record<string, unknown> }>;
        }> | undefined;
        if (!entities) return;

        for (const entity of entities) {
            for (const comp of entity.components || []) {
                if (comp.type === 'Sprite' && comp.data) {
                    if (typeof comp.data.texture === 'string' && isUUID(comp.data.texture)) {
                        const path = this.assetLibrary_.getPath(comp.data.texture);
                        if (path) comp.data.texture = path;
                    }
                    if (typeof comp.data.material === 'string' && isUUID(comp.data.material)) {
                        const path = this.assetLibrary_.getPath(comp.data.material);
                        if (path) comp.data.material = path;
                    }
                }
                if (comp.type === 'SpineAnimation' && comp.data) {
                    if (typeof comp.data.skeletonPath === 'string' && isUUID(comp.data.skeletonPath)) {
                        const path = this.assetLibrary_.getPath(comp.data.skeletonPath);
                        if (path) comp.data.skeletonPath = path;
                    }
                    if (typeof comp.data.atlasPath === 'string' && isUUID(comp.data.atlasPath)) {
                        const path = this.assetLibrary_.getPath(comp.data.atlasPath);
                        if (path) comp.data.atlasPath = path;
                    }
                    if (typeof comp.data.material === 'string' && isUUID(comp.data.material)) {
                        const path = this.assetLibrary_.getPath(comp.data.material);
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
                    const path = this.assetLibrary_.getPath(key);
                    resolved[path ?? key] = value;
                } else {
                    resolved[key] = value;
                }
            }
            sceneData.textureMetadata = resolved;
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
    private assetLibrary_: AssetLibrary;
}
