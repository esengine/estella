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
var __STARTUP_SCENE__={{SCENE_DATA}};
(function(){
  var c=document.getElementById('canvas');
  function resize(){
    var dpr=window.devicePixelRatio||1;
    c.width=window.innerWidth*dpr;
    c.height=window.innerHeight*dpr;
  }
  window.addEventListener('resize',resize);
  resize();

  ESEngineModule({
    canvas:c,
    print:function(t){console.log(t)},
    printErr:function(t){console.error(t)}
  }).then(function(Module){
    var es=window.esengine;
    if(!es||!es.createWebApp){
      console.error('esengine not found');
      return;
    }
    var app=es.createWebApp(Module);
    var assetServer=new es.AssetServer(Module);
    es.loadSceneWithAssets(app.world,__STARTUP_SCENE__,{assetServer:assetServer}).then(function(){
      app.run();
    });
  }).catch(function(e){
    if(e!=='unwind'&&(!e.message||!e.message.includes('unwind'))){
      console.error('Failed:',e);
    }
  });
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
        this.fs_ = (window as any).__esengine_fs ?? null;
        this.projectDir_ = getProjectDir(context.projectPath);
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

        console.log('[PlayableBuilder] Starting build...');

        try {
            // 1. Load SDK
            const wasmSdk = await this.loadSdk();
            if (!wasmSdk) {
                return {
                    success: false,
                    error: "SDK not found. Please run 'scripts/build-web-single.bat' first.",
                };
            }
            console.log(`[PlayableBuilder] SDK loaded: ${wasmSdk.length} bytes`);

            // 2. Compile user scripts
            const gameCode = await this.compileUserScripts();
            console.log(`[PlayableBuilder] Scripts compiled: ${gameCode.length} bytes`);

            // 3. Read startup scene
            const scenePath = this.resolveScenePath(startupScene);
            const sceneContent = await this.fs_.readFile(scenePath);
            if (!sceneContent) {
                return { success: false, error: `Startup scene not found: ${scenePath}` };
            }
            console.log(`[PlayableBuilder] Scene loaded: ${scenePath}`);

            // 4. Collect and inline assets
            const assets = await this.collectAssets();
            console.log(`[PlayableBuilder] Collected ${assets.size} assets`);

            const gameCodeWithAssets = this.inlineAssets(gameCode, assets);
            const sceneDataWithAssets = this.inlineAssets(sceneContent, assets);

            // 5. Assemble HTML
            const html = this.assembleHTML(wasmSdk, gameCodeWithAssets, sceneDataWithAssets);
            console.log(`[PlayableBuilder] HTML assembled: ${html.length} bytes`);

            // 6. Write output
            const outputPath = this.resolveOutputPath(settings.outputPath);
            const outputDir = getDir(outputPath);

            await this.fs_.createDirectory(outputDir);
            const success = await this.fs_.writeFile(outputPath, html);

            if (success) {
                console.log(`[PlayableBuilder] Build successful: ${outputPath}`);
                return { success: true, outputPath };
            } else {
                return { success: false, error: 'Failed to write output file' };
            }
        } catch (err) {
            console.error('[PlayableBuilder] Build error:', err);
            return { success: false, error: String(err) };
        }
    }

    // =========================================================================
    // Private Methods
    // =========================================================================

    private async loadSdk(): Promise<string | null> {
        try {
            const response = await fetch('/esengine.single.js');
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
        const scriptsPath = joinPath(this.projectDir_, 'assets/scripts');

        if (!await this.fs_!.exists(scriptsPath)) {
            return this.createMinimalGameCode();
        }

        const entries = await this.fs_!.listDirectoryDetailed(scriptsPath);
        const scripts = entries
            .filter(e => !e.isDirectory && e.name.endsWith('.ts'))
            .map(e => joinPath(scriptsPath, e.name));

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
        const defines: Record<string, string> = {};
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
                                resolvedPath = joinPath(projectDir, 'node_modules', args.path, 'index.js');
                            }
                        } else {
                            resolvedPath = joinPath(projectDir, 'node_modules', args.path);
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
        const texturesPath = joinPath(this.projectDir_, 'assets/textures');

        if (await this.fs_!.exists(texturesPath)) {
            await this.collectAssetsRecursive(texturesPath, '', assets);
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

    private inlineAssets(code: string, assets: Map<string, string>): string {
        let result = code;

        for (const [relativePath, dataUrl] of assets) {
            const pathVariants = [
                `assets/textures/${relativePath}`,
                `assets/${relativePath}`,
                relativePath,
            ];

            for (const pathVariant of pathVariants) {
                result = result.split(`'${pathVariant}'`).join(`'${dataUrl}'`);
                result = result.split(`"${pathVariant}"`).join(`"${dataUrl}"`);
            }
        }

        return result;
    }

    private assembleHTML(wasmSdk: string, gameCode: string, sceneData: string): string {
        return HTML_TEMPLATE
            .replace('{{WASM_SDK}}', wasmSdk)
            .replace('{{GAME_CODE}}', gameCode)
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
}
