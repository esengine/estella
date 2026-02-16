import path from 'path';
import { mkdir, cp, rm, stat } from 'fs/promises';
import { existsSync } from 'fs';
import config from '../build.config.js';
import * as logger from '../utils/logger.js';
import { runCommand, getCpuCount } from '../utils/emscripten.js';
import { hashFiles, hashDirectory, HashCache } from '../utils/hash.js';

async function computeWasmHash(target, targetConfig, debug) {
    const rootDir = config.paths.root;
    const srcDir = path.join(rootDir, 'src/esengine');
    const cmakeLists = path.join(rootDir, 'CMakeLists.txt');

    const sourceHash = await hashDirectory(srcDir, /\.(hpp|cpp|h)$/);

    const buildType = debug ? 'Debug' : 'Release';
    const flagsKey = [...targetConfig.cmakeFlags, `CMAKE_BUILD_TYPE=${buildType}`].join('|');

    const configHash = await hashFiles([cmakeLists]);

    const { createHash } = await import('crypto');
    return createHash('md5')
        .update(sourceHash)
        .update(configHash)
        .update(flagsKey)
        .digest('hex');
}

export async function buildWasm(target, options = {}) {
    const { debug = false, clean = false, manifest = null, noCache = false } = options;

    const targetConfig = config.wasm[target];
    if (!targetConfig) {
        throw new Error(`Unknown target: ${target}. Available: ${Object.keys(config.wasm).join(', ')}`);
    }

    if (manifest) {
        manifest.startTarget(`wasm:${target}`);
    }

    try {
        logger.step(`Building WASM for ${target}...`);

        const rootDir = config.paths.root;
        const buildDir = path.join(rootDir, targetConfig.buildDir);
        const outputDir = config.paths.output;

        if (!noCache && !clean) {
            const cache = new HashCache(config.paths.cache);
            await cache.load();

            const currentHash = await computeWasmHash(target, targetConfig, debug);
            const cacheKey = `wasm:${target}`;

            if (!await cache.isChanged(cacheKey, currentHash)) {
                logger.success(`WASM ${target}: No changes detected (cached)`);
                const result = {
                    target,
                    buildDir,
                    outputDir,
                    outputs: Object.values(targetConfig.outputs),
                    skipped: true,
                };
                if (manifest) {
                    await manifest.endTarget(`wasm:${target}`, result);
                }
                return result;
            }

            await executeWasmBuild(target, targetConfig, { debug, clean, buildDir, rootDir, outputDir });

            cache.set(cacheKey, currentHash);
            await cache.save();
        } else {
            await executeWasmBuild(target, targetConfig, { debug, clean, buildDir, rootDir, outputDir });
        }

        logger.success(`WASM ${target}: Build complete`);

        const result = {
            target,
            buildDir,
            outputDir,
            outputs: Object.values(targetConfig.outputs),
        };

        if (manifest) {
            await manifest.endTarget(`wasm:${target}`, result);
        }

        return result;
    } catch (error) {
        if (manifest) {
            manifest.markTargetFailed(`wasm:${target}`, error);
        }
        throw error;
    }
}

async function executeWasmBuild(target, targetConfig, { debug, clean, buildDir, rootDir, outputDir }) {
    if (clean && existsSync(buildDir)) {
        logger.debug(`Cleaning ${buildDir}`);
        await rm(buildDir, { recursive: true, force: true });
    }

    await mkdir(buildDir, { recursive: true });

    const buildType = debug ? 'Debug' : 'Release';
    const optConfig = config.optimization[target];
    const cmakeArgs = [
        'cmake',
        ...targetConfig.cmakeFlags,
        `-DCMAKE_BUILD_TYPE=${buildType}`,
    ];

    if (!debug && optConfig?.cmakeOpt) {
        cmakeArgs.push(`-DCMAKE_C_FLAGS=${optConfig.cmakeOpt}`);
        cmakeArgs.push(`-DCMAKE_CXX_FLAGS=${optConfig.cmakeOpt}`);
        cmakeArgs.push('-DCMAKE_INTERPROCEDURAL_OPTIMIZATION=ON');
    }

    cmakeArgs.push(rootDir);

    logger.debug(`CMake configure: emcmake ${cmakeArgs.join(' ')}`);
    await runCommand('emcmake', cmakeArgs, { cwd: buildDir });

    const cpuCount = getCpuCount();
    const buildArgs = ['--build', '.', '-j', String(cpuCount)];

    if (targetConfig.targets && targetConfig.targets.length > 0) {
        buildArgs.push('--target', ...targetConfig.targets);
    }

    logger.debug(`CMake build: cmake ${buildArgs.join(' ')}`);
    await runCommand('cmake', buildArgs, { cwd: buildDir });

    const wasmOptLevel = config.optimization[target]?.wasmOpt || '-O2';
    await optimizeWasmFiles(buildDir, targetConfig.outputs, wasmOptLevel);
    await copyOutputs(buildDir, outputDir, targetConfig.outputs);
}

async function optimizeWasmFiles(buildDir, outputs, optLevel = '-O2') {
    const wasmFiles = Object.keys(outputs).filter(src => src.endsWith('.wasm'));
    if (wasmFiles.length === 0) return;

    for (const src of wasmFiles) {
        const wasmPath = path.join(buildDir, src);
        if (!existsSync(wasmPath)) continue;

        try {
            const before = (await stat(wasmPath)).size;
            await runCommand('wasm-opt', [optLevel, '-o', wasmPath, wasmPath], { silent: true });
            const after = (await stat(wasmPath)).size;
            const reduction = ((1 - after / before) * 100).toFixed(1);
            logger.debug(`wasm-opt ${optLevel}: ${src} ${(before / 1024).toFixed(0)}KB → ${(after / 1024).toFixed(0)}KB (-${reduction}%)`);
        } catch {
            logger.warn('wasm-opt not found or failed, skipping WASM optimization');
            return;
        }
    }
}

async function copyOutputs(buildDir, outputDir, outputs) {
    for (const [src, dest] of Object.entries(outputs)) {
        const srcPath = path.join(buildDir, src);
        const destPath = path.join(outputDir, dest);

        if (!existsSync(srcPath)) {
            logger.warn(`Output file not found: ${srcPath}`);
            continue;
        }

        await mkdir(path.dirname(destPath), { recursive: true });
        await cp(srcPath, destPath);
        logger.debug(`Copied ${src} → ${dest}`);
    }
}

export async function buildWasmParallel(targets, options = {}) {
    const { manifest = null, continueOnError = false } = options;

    const groups = new Map();
    for (const target of targets) {
        const targetConfig = config.wasm[target];
        if (!targetConfig) {
            throw new Error(`Unknown target: ${target}. Available: ${Object.keys(config.wasm).join(', ')}`);
        }
        const dir = targetConfig.buildDir;
        if (!groups.has(dir)) {
            groups.set(dir, []);
        }
        groups.get(dir).push(target);
    }

    const groupPromises = [];
    for (const groupTargets of groups.values()) {
        groupPromises.push((async () => {
            const results = [];
            for (const target of groupTargets) {
                try {
                    const result = await buildWasm(target, { ...options, manifest });
                    results.push({ target, status: 'success', result });
                } catch (error) {
                    results.push({ target, status: 'failed', error });
                    logger.error(`Build failed for ${target}: ${error.message}`);
                }
            }
            return results;
        })());
    }

    const allResults = await Promise.allSettled(groupPromises);

    const failures = [];
    const successes = [];

    for (const groupResult of allResults) {
        if (groupResult.status === 'fulfilled') {
            for (const targetResult of groupResult.value) {
                if (targetResult.status === 'success') {
                    successes.push(targetResult.target);
                } else {
                    failures.push({
                        target: targetResult.target,
                        error: targetResult.error,
                    });
                }
            }
        } else {
            logger.error(`Group build failed: ${groupResult.reason.message}`);
            failures.push({
                target: 'unknown',
                error: groupResult.reason,
            });
        }
    }

    if (successes.length > 0) {
        logger.success(`Successfully built: ${successes.join(', ')}`);
    }

    if (failures.length > 0) {
        logger.error(`\nBuild failures (${failures.length}):`);
        for (const failure of failures) {
            logger.error(`  - ${failure.target}: ${failure.error.message}`);
        }

        if (!continueOnError) {
            throw new Error(`${failures.length} target(s) failed to build`);
        } else {
            logger.warn(`\n⚠️  ${failures.length} target(s) failed, continuing due to --continue-on-error`);
        }
    }
}

export async function buildAllWasm(options = {}) {
    await buildWasmParallel(Object.keys(config.wasm), options);
}

export async function cleanWasm(target = null) {
    const rootDir = config.paths.root;

    if (target) {
        const targetConfig = config.wasm[target];
        if (!targetConfig) {
            throw new Error(`Unknown target: ${target}`);
        }
        const buildDir = path.join(rootDir, targetConfig.buildDir);
        if (existsSync(buildDir)) {
            await rm(buildDir, { recursive: true, force: true });
            logger.debug(`Removed ${buildDir}`);
        }
    } else {
        for (const t of Object.keys(config.wasm)) {
            await cleanWasm(t);
        }
    }
}
