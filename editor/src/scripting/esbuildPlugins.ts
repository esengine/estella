/**
 * @file    esbuildPlugins.ts
 * @brief   esbuild plugins for virtual file system and SDK shim
 */

import type * as esbuild from 'esbuild-wasm';
import type { NativeFS } from './types';

// =============================================================================
// Path Utilities
// =============================================================================

function normalizePath(path: string): string {
    return path.replace(/\\/g, '/');
}

function joinPath(...parts: string[]): string {
    return normalizePath(parts.join('/').replace(/\/+/g, '/'));
}

function dirname(path: string): string {
    const normalized = normalizePath(path);
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash > 0 ? normalized.substring(0, lastSlash) : normalized;
}

function resolvePath(from: string, to: string): string {
    if (!to.startsWith('.')) {
        return to;
    }

    const fromDir = dirname(from);
    const parts = fromDir.split('/');
    const toParts = to.split('/');

    for (const part of toParts) {
        if (part === '..') {
            parts.pop();
        } else if (part !== '.') {
            parts.push(part);
        }
    }

    return parts.join('/');
}

// =============================================================================
// Editor Shim Plugin
// =============================================================================

const EDITOR_SHIM_EXPORTS = [
    'registerPanel', 'registerMenuItem', 'registerMenu',
    'registerGizmo', 'registerStatusbarItem', 'registerPropertyEditor',
    'registerComponentSchema', 'registerBoundsProvider',
    'icons', 'showToast', 'showSuccessToast', 'showErrorToast',
    'showContextMenu', 'showConfirmDialog', 'showInputDialog',
    'getEditorInstance', 'getEditorStore',
    'Draw', 'Geometry', 'Material', 'BlendMode', 'DataType', 'ShaderSources',
    'PostProcess', 'Renderer', 'RenderStage',
    'registerDrawCallback', 'unregisterDrawCallback',
    'onDispose',
] as const;

const EDITOR_SHIM_CODE = EDITOR_SHIM_EXPORTS.map(
    name => `export const ${name} = window.__ESENGINE_EDITOR__.${name};`
).join('\n');

export function editorShimPlugin(): esbuild.Plugin {
    return {
        name: 'editor-shim',
        setup(build) {
            build.onResolve({ filter: /^@esengine\/editor$/ }, () => {
                return { path: '@esengine/editor', namespace: 'editor-shim' };
            });
            build.onLoad({ filter: /.*/, namespace: 'editor-shim' }, () => {
                return { contents: EDITOR_SHIM_CODE, loader: 'js' };
            });
        },
    };
}

// =============================================================================
// Virtual FS Plugin
// =============================================================================

export interface VirtualFsPluginOptions {
    fs: NativeFS;
    projectDir: string;
}

export function virtualFsPlugin(options: VirtualFsPluginOptions): esbuild.Plugin {
    const { fs, projectDir } = options;
    const nodeModulesPath = joinPath(projectDir, 'node_modules');
    const NS = 'virtual';

    return {
        name: 'virtual-fs',
        setup(build) {
            // Absolute paths must be resolved before npm packages filter matches them
            build.onResolve({ filter: /^\// }, (args) => {
                return { path: args.path, namespace: NS };
            });

            build.onResolve({ filter: /^[A-Za-z]:/ }, (args) => {
                return { path: normalizePath(args.path), namespace: NS };
            });

            build.onResolve({ filter: /^[^./]/ }, async (args) => {
                if (/^[A-Za-z]:/.test(args.path)) return undefined;

                // Handle esengine SDK from editor
                if (args.path === 'esengine') {
                    return { path: joinPath(projectDir, '.esengine/sdk/index.js'), namespace: NS };
                }
                if (args.path === 'esengine/wasm') {
                    return { path: joinPath(projectDir, '.esengine/sdk/wasm.js'), namespace: NS };
                }

                const pkgName = args.path.startsWith('@')
                    ? args.path.split('/').slice(0, 2).join('/')
                    : args.path.split('/')[0];

                const subpath = args.path.startsWith('@')
                    ? args.path.split('/').slice(2).join('/')
                    : args.path.split('/').slice(1).join('/');

                const pkgJsonPath = joinPath(nodeModulesPath, pkgName, 'package.json');

                try {
                    const pkgJsonContent = await fs.readFile(pkgJsonPath);
                    if (!pkgJsonContent) {
                        return { errors: [{ text: `Package not found: ${pkgName}. Please install it with npm.` }] };
                    }

                    const pkgJson = JSON.parse(pkgJsonContent);
                    const entryFile = subpath || pkgJson.module || pkgJson.main || 'index.js';
                    const entryPath = joinPath(nodeModulesPath, pkgName, entryFile);
                    return { path: entryPath, namespace: NS };
                } catch {
                    return { errors: [{ text: `Cannot resolve package: ${args.path}` }] };
                }
            });

            build.onResolve({ filter: /^\./, namespace: NS }, async (args) => {
                let resolved = resolvePath(args.importer || args.resolveDir, args.path);

                if (!resolved.match(/\.(ts|tsx|js|jsx|json|mjs|cjs)$/)) {
                    const tsPath = resolved + '.ts';
                    if (await fs.exists(tsPath)) {
                        resolved = tsPath;
                    } else {
                        const jsPath = resolved + '.js';
                        if (await fs.exists(jsPath)) {
                            resolved = jsPath;
                        } else {
                            const indexTsPath = joinPath(resolved, 'index.ts');
                            if (await fs.exists(indexTsPath)) {
                                resolved = indexTsPath;
                            } else {
                                resolved = resolved + '.ts';
                            }
                        }
                    }
                }

                return { path: resolved, namespace: NS };
            });

            build.onLoad({ filter: /.*/, namespace: NS }, async (args) => {
                const content = await fs.readFile(args.path);
                if (content === null) {
                    return { errors: [{ text: `File not found: ${args.path}` }] };
                }

                let loader: esbuild.Loader = 'js';
                if (args.path.endsWith('.ts') || args.path.endsWith('.tsx')) {
                    loader = 'ts';
                } else if (args.path.endsWith('.json')) {
                    loader = 'json';
                } else if (args.path.endsWith('.jsx')) {
                    loader = 'jsx';
                } else if (args.path.endsWith('.css')) {
                    loader = 'css';
                }

                return {
                    contents: content,
                    loader,
                    resolveDir: dirname(args.path),
                };
            });
        },
    };
}
