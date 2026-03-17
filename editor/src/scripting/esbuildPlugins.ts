/**
 * @file    esbuildPlugins.ts
 * @brief   esbuild plugins for virtual file system and SDK resolution
 */

import type * as esbuild from 'esbuild-wasm';
import type { NativeFS, SdkResolveStrategy } from './types';
import { normalizePath, joinPath, getParentDir, isAbsolutePath } from '../utils/path';

// =============================================================================
// Path Utilities
// =============================================================================

function resolvePath(from: string, to: string): string {
    if (!to.startsWith('.')) {
        return to;
    }

    const fromDir = getParentDir(from);
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
// Shim Code Generation
// =============================================================================

const JS_RESERVED = new Set([
    'break', 'case', 'catch', 'continue', 'debugger', 'default', 'delete',
    'do', 'else', 'finally', 'for', 'function', 'if', 'in', 'instanceof',
    'new', 'return', 'switch', 'this', 'throw', 'try', 'typeof', 'var',
    'void', 'while', 'with', 'class', 'const', 'enum', 'export', 'extends',
    'import', 'super', 'implements', 'interface', 'let', 'package', 'private',
    'protected', 'public', 'static', 'yield',
]);

function generateShimCode(): string {
    const api = (window as any).__ESENGINE_EDITOR__ || {};
    return Object.keys(api)
        .filter(key => /^[a-zA-Z_$]/.test(key) && !JS_RESERVED.has(key))
        .map(key => `export var ${key} = window.__ESENGINE_EDITOR__["${key}"];`)
        .join('\n');
}

// =============================================================================
// Editor Shim Plugin
// =============================================================================

export function editorShimPlugin(): esbuild.Plugin {
    return {
        name: 'editor-shim',
        setup(build) {
            build.onResolve({ filter: /^@esengine\/editor$/ }, () => ({
                path: '@esengine/editor', namespace: 'editor-shim',
            }));
            build.onLoad({ filter: /.*/, namespace: 'editor-shim' }, () => ({
                contents: generateShimCode(), loader: 'js',
            }));
        },
    };
}

// =============================================================================
// ESEngine Shim Plugin
// =============================================================================

export function esengineShimPlugin(): esbuild.Plugin {
    return {
        name: 'esengine-shim',
        setup(build) {
            build.onResolve({ filter: /^esengine(\/.*)?$/ }, (args) => ({
                path: args.path, namespace: 'esengine-shim',
            }));
            build.onLoad({ filter: /.*/, namespace: 'esengine-shim' }, () => ({
                contents: generateShimCode(), loader: 'js',
            }));
        },
    };
}

// =============================================================================
// Play Mode Shim Plugin
// =============================================================================

export function playModeShimPlugin(
    modules: Map<string, Record<string, unknown>>,
): esbuild.Plugin {
    const shimCache = new Map<string, string>();
    for (const [specifier, mod] of modules) {
        const names = Object.keys(mod)
            .filter(k => /^[a-zA-Z_$]/.test(k) && !JS_RESERVED.has(k));
        const key = JSON.stringify(specifier);
        const code = [
            `const __m = window.__esengine_shim__[${key}];`,
            ...names.map(n => `export const ${n} = __m["${n}"];`),
        ].join('\n');
        shimCache.set(specifier, code);
    }

    return {
        name: 'play-mode-shim',
        setup(build) {
            build.onResolve({ filter: /^[^./]/ }, (args) => {
                if (shimCache.has(args.path)) {
                    return { path: args.path, namespace: 'play-mode-shim' };
                }
                return undefined;
            });
            build.onLoad({ filter: /.*/, namespace: 'play-mode-shim' }, (args) => {
                const code = shimCache.get(args.path);
                if (!code) {
                    return { errors: [{ text: `Shim not found: ${args.path}` }] };
                }
                return { contents: code, loader: 'js' };
            });
        },
    };
}

// =============================================================================
// SDK Resolve Plugin (unified shim / loader strategy)
// =============================================================================

export function sdkResolvePlugin(strategy: SdkResolveStrategy): esbuild.Plugin {
    if (strategy.type === 'shim') {
        return playModeShimPlugin(strategy.modules);
    }

    const { load, preferEsmEntry } = strategy;
    return {
        name: 'sdk-resolve',
        setup(build) {
            build.onResolve({ filter: /^esengine(\/wasm)?$/ }, (args) => ({
                path: args.path,
                namespace: 'esengine-sdk',
            }));

            build.onResolve({ filter: /^\./ }, (args) => {
                if (args.namespace !== 'esengine-sdk') return undefined;
                const baseDir = args.importer.includes('/')
                    ? args.importer.substring(0, args.importer.lastIndexOf('/'))
                    : '';
                const resolved = baseDir ? `${baseDir}/${args.path}` : args.path;
                const normalized = resolved
                    .replace(/^\.\//, '')
                    .replace(/\/\.\//g, '/')
                    .replace(/[^/]+\/\.\.\//g, '');
                return { path: normalized, namespace: 'esengine-sdk' };
            });

            build.onLoad({ filter: /.*/, namespace: 'esengine-sdk' }, async (args) => {
                return load(args.path);
            });

            if (preferEsmEntry !== undefined) {
                (build as any).__sdkPreferEsm = preferEsmEntry;
            }
        },
    };
}

// =============================================================================
// Virtual FS Plugin
// =============================================================================

export interface VirtualFsOptions {
    fs: NativeFS;
    projectDir: string;
    preferEsmEntry?: boolean;
}

export function virtualFsPlugin(options: VirtualFsOptions): esbuild.Plugin {
    const { fs, projectDir, preferEsmEntry = true } = options;
    const nodeModulesPath = joinPath(projectDir, 'node_modules');
    const NS = 'virtual';

    return {
        name: 'virtual-fs',
        setup(build) {
            const esmPref = (build as any).__sdkPreferEsm ?? preferEsmEntry;

            // -----------------------------------------------------------------
            // Absolute path resolution (Unix + Windows)
            // -----------------------------------------------------------------

            build.onResolve({ filter: /^\// }, (args) => {
                return { path: args.path, namespace: NS };
            });

            build.onResolve({ filter: /^[A-Za-z]:/ }, (args) => {
                return { path: normalizePath(args.path), namespace: NS };
            });

            // -----------------------------------------------------------------
            // Bare specifier (npm package) resolution
            // -----------------------------------------------------------------

            build.onResolve({ filter: /^[^./]/ }, async (args) => {
                if (/^[A-Za-z]:/.test(args.path)) return undefined;

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

                    const pkg = JSON.parse(pkgJsonContent);

                    let entryFile: string;
                    if (subpath) {
                        entryFile = subpath;
                    } else {
                        entryFile = esmPref
                            ? (pkg.module || pkg.main || 'index.js')
                            : (pkg.main || 'index.js');
                        if (pkg.exports) {
                            const root = pkg.exports['.'];
                            if (typeof root === 'string') {
                                entryFile = root;
                            } else if (root?.import && esmPref) {
                                entryFile = root.import;
                            } else if (root?.default) {
                                entryFile = root.default;
                            }
                        }
                    }

                    const entryPath = joinPath(nodeModulesPath, pkgName, entryFile);
                    return { path: entryPath, namespace: NS };
                } catch {
                    return { errors: [{ text: `Cannot resolve package: ${args.path}` }] };
                }
            });

            // -----------------------------------------------------------------
            // Relative path resolution
            // -----------------------------------------------------------------

            build.onResolve({ filter: /^\./, namespace: NS }, async (args) => {
                let resolved = resolvePath(args.importer || args.resolveDir, args.path);

                if (!resolved.match(/\.(ts|tsx|js|jsx|json|mjs|cjs)$/)) {
                    resolved = await resolveExtension(fs, resolved);
                }

                return { path: resolved, namespace: NS };
            });

            // -----------------------------------------------------------------
            // Entry point
            // -----------------------------------------------------------------

            build.onResolve({ filter: /.*/ }, (args) => {
                if (args.kind === 'entry-point') {
                    return { path: args.path, namespace: NS };
                }
                if (isAbsolutePath(args.path)) {
                    return { path: normalizePath(args.path), namespace: NS };
                }
                return undefined;
            });

            // -----------------------------------------------------------------
            // File loading
            // -----------------------------------------------------------------

            build.onLoad({ filter: /.*/, namespace: NS }, async (args) => {
                let content = await fs.readFile(args.path);
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

                if (loader === 'js') {
                    content = content.replace(/\/\/# sourceMappingURL=.*$/m, '');
                }

                return {
                    contents: content,
                    loader,
                    resolveDir: getParentDir(args.path),
                };
            });
        },
    };
}

// =============================================================================
// Extension Resolution Helper
// =============================================================================

async function resolveExtension(
    fs: { exists(path: string): Promise<boolean> },
    basePath: string,
): Promise<string> {
    const tsPath = basePath + '.ts';
    if (await fs.exists(tsPath)) return tsPath;

    const jsPath = basePath + '.js';
    if (await fs.exists(jsPath)) return jsPath;

    const indexTsPath = joinPath(basePath, 'index.ts');
    if (await fs.exists(indexTsPath)) return indexTsPath;

    const indexJsPath = joinPath(basePath, 'index.js');
    if (await fs.exists(indexJsPath)) return indexJsPath;

    return tsPath;
}

