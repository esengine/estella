import path from 'path';
import { mkdir, cp, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import config from '../build.config.js';
import * as logger from '../utils/logger.js';
import { runCommand } from '../utils/emscripten.js';

export async function buildSdk(options = {}) {
    const { manifest = null } = options;

    if (manifest) {
        manifest.startTarget('sdk');
    }

    try {
        logger.step('Building SDK...');

        const sdkDir = config.paths.sdk;
        const outputDir = path.join(config.paths.output, 'sdk');

        await mkdir(outputDir, { recursive: true });

        await runCommand('npm', ['run', 'build'], { cwd: sdkDir });

        await copyDistOutputs(sdkDir, outputDir);

        logger.success('SDK: Build complete');

        const result = {
            outputDir,
            outputs: [
                'esm/esengine.js',
                'esm/esengine.d.ts',
                'esm/wasm.js',
                'esm/wasm.d.ts',
                'esm/spine/index.js',
                'esm/spine/index.d.ts',
                'esm/physics/index.js',
                'esm/physics/index.d.ts',
                'cjs/esengine.wechat.js',
                'cjs/index.wechat.js',
            ],
        };

        if (manifest) {
            await manifest.endTarget('sdk', result);
        }

        return result;
    } catch (error) {
        if (manifest) {
            manifest.markTargetFailed('sdk', error);
        }
        throw error;
    }
}

async function copyDistOutputs(sdkDir, outputDir) {
    const distDir = path.join(sdkDir, 'dist');

    if (!existsSync(distDir)) {
        logger.warn('SDK dist directory not found');
        return;
    }

    const esmDir = path.join(outputDir, 'esm');
    const cjsDir = path.join(outputDir, 'cjs');

    await mkdir(esmDir, { recursive: true });
    await mkdir(cjsDir, { recursive: true });

    const spineDir = path.join(esmDir, 'spine');
    const physicsDir = path.join(esmDir, 'physics');
    await mkdir(spineDir, { recursive: true });
    await mkdir(physicsDir, { recursive: true });

    const files = [
        { src: 'index.js', dest: path.join(esmDir, 'esengine.js') },
        { src: 'index.d.ts', dest: path.join(esmDir, 'esengine.d.ts') },
        { src: 'wasm.js', dest: path.join(esmDir, 'wasm.js') },
        { src: 'wasm.d.ts', dest: path.join(esmDir, 'wasm.d.ts') },
        { src: 'spine/index.js', dest: path.join(spineDir, 'index.js') },
        { src: 'spine/index.d.ts', dest: path.join(spineDir, 'index.d.ts') },
        { src: 'physics/index.js', dest: path.join(physicsDir, 'index.js') },
        { src: 'physics/index.d.ts', dest: path.join(physicsDir, 'index.d.ts') },
        { src: 'index.wechat.js', dest: path.join(cjsDir, 'index.wechat.js') },
        { src: 'index.wechat.cjs.js', dest: path.join(cjsDir, 'esengine.wechat.js') },
    ];

    for (const { src, dest } of files) {
        const srcPath = path.join(distDir, src);
        if (existsSync(srcPath)) {
            await cp(srcPath, dest);
            logger.debug(`Copied ${src}`);
        }
    }
}

export async function buildSdkDirect(format = 'all') {
    logger.step(`Building SDK (${format})...`);

    const sdkDir = config.paths.sdk;
    const outputDir = path.join(config.paths.output, 'sdk');

    await mkdir(outputDir, { recursive: true });

    const args = ['rollup', '-c'];
    if (format !== 'all') {
        args.push('--environment', `FORMAT:${format}`);
    }

    await runCommand('npx', args, { cwd: sdkDir });

    await copyDistOutputs(sdkDir, outputDir);

    logger.success(`SDK (${format}): Build complete`);
}

export async function cleanSdk() {
    const sdkDistDir = path.join(config.paths.sdk, 'dist');
    const outputSdkDir = path.join(config.paths.output, 'sdk');

    const { rm } = await import('fs/promises');

    if (existsSync(sdkDistDir)) {
        await rm(sdkDistDir, { recursive: true, force: true });
        logger.debug('Removed sdk/dist');
    }

    if (existsSync(outputSdkDir)) {
        await rm(outputSdkDir, { recursive: true, force: true });
        logger.debug('Removed build/sdk');
    }
}
