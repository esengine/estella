/**
 * @file    templates.ts
 * @brief   Build output templates for platform emitters
 */

import type { RuntimeBuildConfig } from './BuildService';
import type { BuildPlatform } from '../types/BuildTypes';
import type { NativeFS } from '../types/NativeFS';
import { joinPath, isAbsolutePath, normalizePath } from '../utils/path';

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
    spineModules:typeof __ES_SPINE_MODULES__!=='undefined'?__ES_SPINE_MODULES__:undefined,
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

export const WECHAT_GAMEJS_TEMPLATE = `var ESEngineModule = require('./esengine.js');
var SDK = require('./sdk.js');
globalThis.__esengine_sdk = SDK;

{{USER_CODE}}

(async function() {
    try {
        await SDK.initWeChatRuntime({
            engineFactory: ESEngineModule,
            sceneNames: {{SCENE_NAMES}},
            firstScene: {{FIRST_SCENE}},
            runtimeConfig: {{RUNTIME_CONFIG}},
            physicsConfig: {{PHYSICS_CONFIG}},
            {{SPINE_FACTORIES}}
            {{PHYSICS_FACTORY}}
        });
    } catch (err) {
        console.error('[ESEngine] Runtime init error:', err);
    }
})();
`;

export interface WeChatGameJsParams {
    userCode: string;
    firstSceneName: string;
    allSceneNames: string[];
    spineVersions: string[];
    hasPhysics: boolean;
    physicsConfig: string;
    runtimeConfig?: RuntimeBuildConfig;
}

export function prepareWeChatSections(params: WeChatGameJsParams): Record<string, string> {
    const { userCode, firstSceneName, allSceneNames, spineVersions, hasPhysics, physicsConfig, runtimeConfig } = params;

    const nonNativeVersions = spineVersions.filter(v => v !== '4.2');
    let spineFactoriesCode = '';
    if (nonNativeVersions.length > 0) {
        const entries = nonNativeVersions.map(v => {
            const tag = v.replace('.', '');
            return `"${v}": require('./spine_${tag}.js')`;
        });
        spineFactoriesCode = `spineFactories: {${entries.join(', ')}},`;
    }

    return {
        USER_CODE: userCode,
        SCENE_NAMES: JSON.stringify(allSceneNames),
        FIRST_SCENE: JSON.stringify(firstSceneName),
        RUNTIME_CONFIG: runtimeConfig ? JSON.stringify(runtimeConfig) : 'undefined',
        PHYSICS_CONFIG: physicsConfig,
        SPINE_FACTORIES: spineFactoriesCode,
        PHYSICS_FACTORY: hasPhysics ? "physicsFactory: require('./physics.js')," : '',
    };
}

export function generateWeChatGameJs(params: WeChatGameJsParams): string {
    const sections = prepareWeChatSections(params);
    return renderTemplate(WECHAT_GAMEJS_TEMPLATE, sections);
}

// =============================================================================
// Shared template rendering
// =============================================================================

export function renderTemplate(template: string, sections: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) =>
        key in sections ? sections[key] : match
    );
}

// =============================================================================
// Shared template loading (3-level fallback)
// =============================================================================

export async function loadTemplate(
    fs: NativeFS,
    projectDir: string,
    customPath: string | undefined,
    platform: BuildPlatform,
): Promise<string> {
    if (customPath) {
        const absPath = isAbsolutePath(customPath)
            ? normalizePath(customPath)
            : joinPath(projectDir, customPath);
        const content = await fs.readFile(absPath);
        if (content) return content;
    }

    const projectTemplatePath = joinPath(projectDir, TEMPLATE_REL_PATHS[platform]);
    const content = await fs.readFile(projectTemplatePath);
    if (content) return content;

    return DEFAULT_TEMPLATES[platform];
}

// =============================================================================
// Template export utilities
// =============================================================================

const TEMPLATE_REL_PATHS: Record<BuildPlatform, string> = {
    playable: '.esengine/templates/playable.html',
    wechat: '.esengine/templates/wechat-game.js',
};

const DEFAULT_TEMPLATES: Record<BuildPlatform, string> = {
    playable: PLAYABLE_HTML_TEMPLATE,
    wechat: WECHAT_GAMEJS_TEMPLATE,
};

export function getTemplateRelPath(platform: BuildPlatform): string {
    return TEMPLATE_REL_PATHS[platform];
}

export function getDefaultTemplate(platform: BuildPlatform): string {
    return DEFAULT_TEMPLATES[platform];
}

export interface PlaceholderDoc {
    key: string;
    description: string;
}

const PLAYABLE_PLACEHOLDER_DOCS: PlaceholderDoc[] = [
    { key: 'WASM_SDK', description: 'Compiled WASM engine JS module' },
    { key: 'SPINE_SCRIPT', description: 'Spine animation module <script> tags' },
    { key: 'PHYSICS_SCRIPT', description: 'Physics module <script> tag' },
    { key: 'GAME_CODE', description: 'Compiled user scripts (IIFE)' },
    { key: 'ASSETS_MAP', description: 'JS object mapping asset paths to data URIs' },
    { key: 'SCENES_DATA', description: 'Array of scene JSON objects' },
    { key: 'STARTUP_SCENE', description: 'Name of the first scene to load' },
    { key: 'PHYSICS_CONFIG', description: 'Physics configuration JSON' },
    { key: 'MANIFEST', description: 'Addressable asset manifest JSON' },
    { key: 'RUNTIME_CONFIG', description: 'RuntimeConfig property assignments' },
    { key: 'RUNTIME_APP_CONFIG', description: 'App-level config calls (maxDeltaTime, etc.)' },
    { key: 'CTA_STYLE', description: 'CSS for built-in CTA button' },
    { key: 'CTA_HTML', description: 'HTML for built-in CTA button element' },
    { key: 'CTA_SCRIPT', description: 'JS click handler for CTA button' },
    { key: 'CTA_SHOW', description: 'JS to show CTA button after init' },
];

const WECHAT_PLACEHOLDER_DOCS: PlaceholderDoc[] = [
    { key: 'USER_CODE', description: 'Compiled user scripts' },
    { key: 'SCENE_NAMES', description: 'JSON array of scene names' },
    { key: 'FIRST_SCENE', description: 'JSON string of first scene name' },
    { key: 'RUNTIME_CONFIG', description: 'Runtime config JSON object' },
    { key: 'PHYSICS_CONFIG', description: 'Physics config JSON string' },
    { key: 'SPINE_FACTORIES', description: 'Spine factory require() entries' },
    { key: 'PHYSICS_FACTORY', description: 'Physics factory require() entry' },
];

export function getTemplatePlaceholderDocs(platform: BuildPlatform): PlaceholderDoc[] {
    return platform === 'playable' ? PLAYABLE_PLACEHOLDER_DOCS : WECHAT_PLACEHOLDER_DOCS;
}
