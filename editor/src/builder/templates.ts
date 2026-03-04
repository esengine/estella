/**
 * @file    templates.ts
 * @brief   Build output templates for platform emitters
 */

import type { RuntimeBuildConfig } from './BuildService';

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
var __SCENES__={{SCENES_DATA}};
var __MANIFEST__={{MANIFEST}};
var _fetch=window.fetch;
window.fetch=function(u,o){var d=typeof u==='string'&&__PA__[u];return d?_fetch.call(this,d,o):_fetch.call(this,u,o)};

{{CTA_SCRIPT}}

(async function(){
  try{
  var c=document.getElementById('canvas');
  function resize(){var dpr=window.devicePixelRatio||1;c.width=window.innerWidth*dpr;c.height=window.innerHeight*dpr}
  window.addEventListener('resize',resize);
  resize();

  var Module=await ESEngineModule({canvas:c,print:function(t){console.log(t)},printErr:function(t){console.error(t)}});
  var es=window.esengine;
  if(!es||!es.initPlayableRuntime){console.error('esengine not found');return}

  {{RUNTIME_CONFIG}}
  var app=es.createWebApp(Module);
  {{RUNTIME_APP_CONFIG}}

  {{CTA_SHOW}}
  await es.initPlayableRuntime({
    app:app,module:Module,canvas:c,
    assets:__PA__,scenes:__SCENES__,firstScene:'{{STARTUP_SCENE}}',
    spineWasmBase64:typeof __SPINE_WASM_B64__!=='undefined'?__SPINE_WASM_B64__:undefined,
    physicsWasmBase64:typeof __PHYSICS_WASM_B64__!=='undefined'?__PHYSICS_WASM_B64__:undefined,
    physicsConfig:{{PHYSICS_CONFIG}},manifest:__MANIFEST__
  });
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
    runtimeConfig?: RuntimeBuildConfig;
}

export function generateWeChatGameJs(params: WeChatGameJsParams): string {
    const { userCode, firstSceneName, allSceneNames, hasSpine, hasPhysics, physicsConfig, runtimeConfig } = params;

    const runtimeConfigJson = runtimeConfig ? JSON.stringify(runtimeConfig) : 'undefined';

    return `
var ESEngineModule = require('./esengine.js');
var SDK = require('./sdk.js');
globalThis.__esengine_sdk = SDK;

${userCode}

(async function() {
    try {
        await SDK.initWeChatRuntime({
            engineFactory: ESEngineModule,
            sceneNames: ${JSON.stringify(allSceneNames)},
            firstScene: ${JSON.stringify(firstSceneName)},
            runtimeConfig: ${runtimeConfigJson},
            physicsConfig: ${physicsConfig},
            ${hasSpine ? "spineFactory: require('./spine.js')," : ''}
            ${hasPhysics ? "physicsFactory: require('./physics.js')," : ''}
        });
    } catch (err) {
        console.error('[ESEngine] Runtime init error:', err);
    }
})();
`;
}
