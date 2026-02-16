/**
 * @file    templates.ts
 * @brief   Build output templates for platform emitters
 */

// =============================================================================
// Playable HTML Template
// =============================================================================

export const PLAYABLE_HTML_TEMPLATE = `<!DOCTYPE html>
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
{{CTA_STYLE}}
</style>
</head>
<body>
<canvas id="canvas"></canvas>
{{CTA_HTML}}
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
var __MANIFEST__={{MANIFEST}};

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

{{CTA_SCRIPT}}

(async function(){
  try{
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

  var sceneOpts={app:app,module:Module,provider:provider,spineModule:spineModule,physicsModule:physicsModule,physicsConfig:{{PHYSICS_CONFIG}},manifest:__MANIFEST__};
  var sceneName='{{SCENE_NAME}}';
  var sceneConfig=es.createRuntimeSceneConfig(sceneName,__SCENE__,sceneOpts);
  var mgr=app.getResource(es.SceneManager);
  mgr.register(sceneConfig);
  mgr.setInitial(sceneName);
  await mgr.load(sceneName);

  var screenAspect=c.width/c.height;
  es.updateCameraAspectRatio(app.world,screenAspect);

  {{CTA_SHOW}}
  app.run();
  }catch(e){console.error('Playable init error:',e)}
})();
</script>
</body>
</html>`;

// =============================================================================
// WeChat game.js Template
// =============================================================================

export interface WeChatGameJsParams {
    userCode: string;
    firstSceneName: string;
    allSceneNames: string[];
    hasSpine: boolean;
    hasPhysics: boolean;
    physicsConfig: string;
}

export function generateWeChatGameJs(params: WeChatGameJsParams): string {
    const { userCode, firstSceneName, allSceneNames, hasSpine, hasPhysics, physicsConfig } = params;

    const spineInit = hasSpine ? `
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
}` : '';

    const physicsInit = hasPhysics ? `
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
}` : '';

    const sceneNamesArray = JSON.stringify(allSceneNames);

    const sceneLoading = firstSceneName ? `
    try {
        var provider = {
            loadPixels: function(ref) { return SDK.wxLoadImagePixels(resolvePath(ref)); },
            loadPixelsRaw: function(ref) { return SDK.wxLoadImagePixels(resolvePath(ref)); },
            readText: function(ref) {
                return new Promise(function(resolve, reject) {
                    wxfs.readFile({ filePath: resolvePath(ref), encoding: 'utf-8',
                        success: function(res) { resolve(res.data); },
                        fail: function(err) { reject(new Error(err.errMsg)); }
                    });
                });
            },
            readBinary: function(ref) {
                return new Promise(function(resolve, reject) {
                    wxfs.readFile({ filePath: resolvePath(ref),
                        success: function(res) { resolve(new Uint8Array(res.data)); },
                        fail: function(err) { reject(new Error(err.errMsg)); }
                    });
                });
            },
            resolvePath: resolvePath
        };

        function readSceneFile(name) {
            return new Promise(function(resolve, reject) {
                wxfs.readFile({ filePath: 'scenes/' + name + '.json', encoding: 'utf-8',
                    success: function(res) { resolve(JSON.parse(res.data)); },
                    fail: function(err) { reject(new Error(err.errMsg)); }
                });
            });
        }

        var sceneNames = ${sceneNamesArray};
        var mgr = app.getResource(SDK.SceneManager);
        var sceneOpts = { app: app, module: module, provider: provider, spineModule: spineModule, physicsModule: physicsModule, physicsConfig: ${physicsConfig}, manifest: manifest };

        for (var i = 0; i < sceneNames.length; i++) {
            var sd = await readSceneFile(sceneNames[i]);
            mgr.register(SDK.createRuntimeSceneConfig(sceneNames[i], sd, sceneOpts));
        }
        mgr.setInitial('${firstSceneName}');
        await mgr.load('${firstSceneName}');

        var screenAspect = canvas.width / canvas.height;
        SDK.updateCameraAspectRatio(app.world, screenAspect);
    } catch (err) {
        console.error('[ESEngine] Failed to load scene:', err);
    }
    ` : '';

    return `
var ESEngineModule = require('./esengine.js');
var SDK = require('./sdk.js');
globalThis.__esengine_sdk = SDK;

var spineModule = null;
${spineInit}

var physicsModule = null;
${physicsInit}

(async function() {
    var wxfs = wx.getFileSystemManager();
    var manifest = await new Promise(function(resolve, reject) {
        wxfs.readFile({ filePath: 'asset-manifest.json', encoding: 'utf-8',
            success: function(res) { resolve(JSON.parse(res.data)); },
            fail: function(err) { reject(new Error(err.errMsg)); }
        });
    });
    var assetIndex = {};
    var pathIndex = {};
    for (var gn in manifest.groups) {
        var g = manifest.groups[gn];
        for (var uuid in g.assets) {
            assetIndex[uuid] = g.assets[uuid];
            pathIndex[g.assets[uuid].path] = g.assets[uuid];
        }
    }
    function resolvePath(ref) {
        var entry = assetIndex[ref] || pathIndex[ref];
        return entry ? entry.path : ref;
    }

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

    ${hasSpine ? 'await initSpineModule();' : ''}
    ${hasPhysics ? 'await initPhysicsModule();' : ''}

    ${sceneLoading}
    app.run();
})();
`;
}
