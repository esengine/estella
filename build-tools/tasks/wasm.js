import path from 'path';
import { mkdir, cp, rm, stat } from 'fs/promises';
import { existsSync } from 'fs';
import config from '../build.config.js';
import * as logger from '../utils/logger.js';
import { runCommand, getCpuCount } from '../utils/emscripten.js';

export async function buildWasm(target, options = {}) {
    const { debug = false, clean = false, manifest = null } = options;

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

        if (clean && existsSync(buildDir)) {
            logger.debug(`Cleaning ${buildDir}`);
            await rm(buildDir, { recursive: true, force: true });
        }

        await mkdir(buildDir, { recursive: true });

        const buildType = debug ? 'Debug' : 'Release';
        const cmakeArgs = [
            'cmake',
            ...targetConfig.cmakeFlags,
            `-DCMAKE_BUILD_TYPE=${buildType}`,
            rootDir,
        ];

        logger.debug(`CMake configure: emcmake ${cmakeArgs.join(' ')}`);
        await runCommand('emcmake', cmakeArgs, { cwd: buildDir });

        const cpuCount = getCpuCount();
        const buildArgs = ['--build', '.', '-j', String(cpuCount)];

        if (targetConfig.targets && targetConfig.targets.length > 0) {
            buildArgs.push('--target', ...targetConfig.targets);
        }

        logger.debug(`CMake build: cmake ${buildArgs.join(' ')}`);
        await runCommand('cmake', buildArgs, { cwd: buildDir });

        await optimizeWasmFiles(buildDir, targetConfig.outputs);
        await copyOutputs(buildDir, outputDir, targetConfig.outputs);

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

async function optimizeWasmFiles(buildDir, outputs) {
    const wasmFiles = Object.keys(outputs).filter(src => src.endsWith('.wasm'));
    if (wasmFiles.length === 0) return;

    for (const src of wasmFiles) {
        const wasmPath = path.join(buildDir, src);
        if (!existsSync(wasmPath)) continue;

        try {
            const before = (await stat(wasmPath)).size;
            await runCommand('wasm-opt', ['-Oz', '-o', wasmPath, wasmPath], { silent: true });
            const after = (await stat(wasmPath)).size;
            const reduction = ((1 - after / before) * 100).toFixed(1);
            logger.debug(`wasm-opt: ${src} ${(before / 1024).toFixed(0)}KB → ${(after / 1024).toFixed(0)}KB (-${reduction}%)`);
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
