#!/usr/bin/env node

import { program } from 'commander';
import { rm, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import config from './build.config.js';
import * as logger from './utils/logger.js';
import { checkEnvironment } from './utils/emscripten.js';
import { runEht } from './tasks/eht.js';
import { buildWasm, buildWasmParallel, cleanWasm } from './tasks/wasm.js';
import { buildSdk, cleanSdk } from './tasks/sdk.js';
import { syncToDesktop } from './tasks/sync.js';
import { startWatch } from './tasks/watch.js';
import { BuildManifest } from './manifest.js';
import { handleBuildError } from './utils/errorHelp.js';

program
    .name('esengine-build')
    .description('ESEngine build tools')
    .version('1.0.0');

program
    .command('build')
    .description('Build ESEngine')
    .option('-t, --target <target>', 'Build target (web, wechat, playable, spine, spine38, physics, web-main, wechat-main, physics-side, sdk, all)', 'web')
    .option('-d, --debug', 'Debug build', false)
    .option('-r, --release', 'Release build (default)', true)
    .option('-c, --clean', 'Clean before build', false)
    .option('--no-cache', 'Disable EHT cache')
    .option('-v, --verbose', 'Verbose output', false)
    .option('--no-sync', 'Skip syncing to desktop/public')
    .option('--manifest', 'Generate build manifest with timing and sizes', false)
    .option('--continue-on-error', 'Continue building other targets if one fails (for CI)', false)
    .action(async (options) => {
        logger.setVerbose(options.verbose);
        const startTime = Date.now();

        const manifest = options.manifest ? new BuildManifest() : null;

        try {
            logger.header('ESEngine Build');

            if (!await checkEnvironment()) {
                process.exit(1);
            }

            const isDebug = options.debug && !options.release;
            const targets = options.target === 'all'
                ? ['web', 'wechat', 'playable', 'spine', 'spine38', 'spine41', 'physics']
                : [options.target];

            if (options.clean) {
                await cleanAll();
            }

            const wasmTargets = targets.filter(t => t !== 'sdk');
            const buildSdkFlag = options.target === 'all' || options.target === 'sdk' || wasmTargets.length > 0;

            const noCache = !options.cache;

            if (wasmTargets.length > 0) {
                await runEht({ noCache });
                await buildWasmParallel(wasmTargets, {
                    debug: isDebug,
                    clean: options.clean,
                    manifest,
                    continueOnError: options.continueOnError,
                    noCache,
                });
            }

            if (buildSdkFlag) {
                await buildSdk({ manifest, noCache });
            }

            if (options.sync) {
                await syncToDesktop();
            }

            if (manifest) {
                manifest.printSummary();
                const manifestPath = path.join(config.paths.output, 'manifest.json');
                await manifest.save(manifestPath);
            }

            logger.printTime(startTime);
        } catch (err) {
            handleBuildError(err, { verbose: options.verbose });
        }
    });

program
    .command('watch')
    .description('Watch mode for development')
    .option('-t, --target <target>', 'Build target for WASM', 'web')
    .option('-v, --verbose', 'Verbose output', false)
    .action(async (options) => {
        logger.setVerbose(options.verbose);

        try {
            if (!await checkEnvironment()) {
                process.exit(1);
            }

            await startWatch({ target: options.target });
        } catch (err) {
            handleBuildError(err, { verbose: options.verbose });
        }
    });

program
    .command('clean')
    .description('Clean build outputs')
    .option('-a, --all', 'Clean all build directories', false)
    .option('-t, --target <target>', 'Clean specific target')
    .option('-v, --verbose', 'Verbose output', false)
    .action(async (options) => {
        logger.setVerbose(options.verbose);

        try {
            logger.header('Clean');

            if (options.all || !options.target) {
                await cleanAll();
            } else {
                await cleanWasm(options.target);
            }

            logger.success('Clean complete');
        } catch (err) {
            handleBuildError(err, { verbose: options.verbose });
        }
    });

program
    .command('eht')
    .description('Run EHT code generation only')
    .option('--no-cache', 'Disable cache')
    .option('-v, --verbose', 'Verbose output', false)
    .action(async (options) => {
        logger.setVerbose(options.verbose);

        try {
            await runEht({ noCache: !options.cache });
        } catch (err) {
            handleBuildError(err, { verbose: options.verbose });
        }
    });

program
    .command('sdk')
    .description('Build SDK only')
    .option('-v, --verbose', 'Verbose output', false)
    .action(async (options) => {
        logger.setVerbose(options.verbose);

        try {
            await buildSdk();
            await syncToDesktop({ wasm: false, sdk: true });
        } catch (err) {
            handleBuildError(err, { verbose: options.verbose });
        }
    });

program
    .command('sync')
    .description('Sync build outputs to desktop/public')
    .option('-v, --verbose', 'Verbose output', false)
    .action(async (options) => {
        logger.setVerbose(options.verbose);

        try {
            await syncToDesktop();
        } catch (err) {
            handleBuildError(err, { verbose: options.verbose });
        }
    });

async function cleanAll() {
    logger.step('Cleaning all build outputs...');

    const outputDir = config.paths.output;
    if (existsSync(outputDir)) {
        await rm(outputDir, { recursive: true, force: true });
        logger.debug('Removed build/');
    }

    await cleanWasm();
    await cleanSdk();
}

program.parse();
