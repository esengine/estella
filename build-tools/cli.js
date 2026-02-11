#!/usr/bin/env node

import { program } from 'commander';
import { rm, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import config from './build.config.js';
import * as logger from './utils/logger.js';
import { checkEnvironment } from './utils/emscripten.js';
import { runEht } from './tasks/eht.js';
import { buildWasm, cleanWasm } from './tasks/wasm.js';
import { buildSdk, cleanSdk } from './tasks/sdk.js';
import { syncToDesktop } from './tasks/sync.js';
import { startWatch } from './tasks/watch.js';

program
    .name('esengine-build')
    .description('ESEngine build tools')
    .version('1.0.0');

program
    .command('build')
    .description('Build ESEngine')
    .option('-t, --target <target>', 'Build target (web, wechat, playable, spine, spine38, physics, sdk, all)', 'web')
    .option('-d, --debug', 'Debug build', false)
    .option('-r, --release', 'Release build (default)', true)
    .option('-c, --clean', 'Clean before build', false)
    .option('--no-cache', 'Disable EHT cache')
    .option('-v, --verbose', 'Verbose output', false)
    .option('--no-sync', 'Skip syncing to desktop/public')
    .action(async (options) => {
        logger.setVerbose(options.verbose);
        const startTime = Date.now();

        try {
            logger.header('ESEngine Build');

            if (!await checkEnvironment()) {
                process.exit(1);
            }

            const isDebug = options.debug && !options.release;
            const targets = options.target === 'all'
                ? ['web', 'wechat', 'playable', 'spine', 'spine38', 'physics']
                : [options.target];

            if (options.clean) {
                await cleanAll();
            }

            const wasmTargets = targets.filter(t => t !== 'sdk');
            const buildSdkFlag = options.target === 'all' || options.target === 'sdk' || wasmTargets.length > 0;

            if (wasmTargets.length > 0) {
                await runEht({ noCache: !options.cache });

                for (const target of wasmTargets) {
                    await buildWasm(target, { debug: isDebug, clean: options.clean });
                }
            }

            if (buildSdkFlag) {
                await buildSdk();
            }

            if (options.sync) {
                await syncToDesktop();
            }

            logger.printTime(startTime);
        } catch (err) {
            logger.error(err.message);
            if (options.verbose) {
                console.error(err);
            }
            process.exit(1);
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
            logger.error(err.message);
            process.exit(1);
        }
    });

program
    .command('clean')
    .description('Clean build outputs')
    .option('-a, --all', 'Clean all build directories', false)
    .option('-t, --target <target>', 'Clean specific target')
    .action(async (options) => {
        try {
            logger.header('Clean');

            if (options.all || !options.target) {
                await cleanAll();
            } else {
                await cleanWasm(options.target);
            }

            logger.success('Clean complete');
        } catch (err) {
            logger.error(err.message);
            process.exit(1);
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
            logger.error(err.message);
            process.exit(1);
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
            logger.error(err.message);
            process.exit(1);
        }
    });

program
    .command('sync')
    .description('Sync build outputs to desktop/public')
    .action(async () => {
        try {
            await syncToDesktop();
        } catch (err) {
            logger.error(err.message);
            process.exit(1);
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
