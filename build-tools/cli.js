#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

import { program } from 'commander';
import { rm, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import config from './build.config.js';
import * as logger from './utils/logger.js';
import { checkEnvironment } from './utils/emscripten.js';
import { runEht } from './tasks/eht.js';
import { buildWasm, buildWasmParallel, cleanWasm } from './tasks/wasm.js';
import { buildNative } from './tasks/native.js';
import { buildSdk, cleanSdk } from './tasks/sdk.js';
import { syncToDesktop } from './tasks/sync.js';
import { startWatch } from './tasks/watch.js';
import { BuildManifest } from './manifest.js';
import { handleBuildError } from './utils/errorHelp.js';
import { checkExamples } from './tasks/check-examples.js';
import { validatePrefabs } from './tasks/validate-prefabs.js';

program
    .name('esengine-build')
    .description('ESEngine build tools')
    .version('1.0.0');

program
    .command('build')
    .description('Build ESEngine')
    .option('-t, --target <target>', 'Build target (web, wechat, spine, spine38, spine41, physics, physics-wechat, spine-wechat, basis, basis-wechat, sdk, all)', 'web')
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
                ? ['web', 'wechat', 'spine', 'spine38', 'spine41', 'physics', 'physics-wechat', 'spine-wechat', 'basis', 'basis-wechat', 'videodec', 'videodec-wechat']
                : [options.target];

            if (options.clean) {
                await cleanAll();
            }

            const wasmTargets = targets.filter(t => t !== 'sdk');
            const buildSdkFlag = options.target === 'all' || options.target === 'sdk' || wasmTargets.length > 0;

            const noCache = !options.cache;

            // EHT output feeds sdk/src (component.generated.ts, wasm.generated.ts)
            // as well as the wasm bindings, so an sdk-only build needs it too —
            // otherwise the SDK bundles stale generated sources after a header edit.
            await runEht({ noCache });

            if (wasmTargets.length > 0) {
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
    .command('native')
    .description('Build the native (embedded-Dawn) host for Android or iOS arm64')
    .option('--target <target>', 'android or ios', 'android')
    .option('--dawn <dir>', 'Dawn source dir (or ESTELLA_DAWN_DIR); see native/README.md')
    .option('--dawn-build <dir>', 'Dawn arm64 build dir for this target (or ESTELLA_DAWN_BUILD)')
    .option('--quickjs <dir>', 'QuickJS-ng source dir (or ESTELLA_QUICKJS_DIR)')
    .option('--abi <abi>', 'Android ABI', 'arm64-v8a')
    .option('--platform <platform>', 'Android platform', 'android-33')
    .option('--ios-min <version>', 'iOS deployment target', '17.0')
    .option('--simulator', 'iOS: build the simulator slice (needs a simulator Dawn)', false)
    .option('--package', 'Assemble the app around --content: Android a signed APK, iOS a self-contained Xcode project', false)
    .option('--keystore <path>', 'Android --package: signing keystore (default: the debug one)')
    .option('--jdk <dir>', 'JDK home for the APK step (else JAVA_HOME, or the JDK Android Studio bundles)')
    .option('--content <dir>', 'Ship an exported project (Package Project -> Android / iOS) as the app content')
    .option('-v, --verbose', 'Verbose output', false)
    .action(async (options) => {
        logger.setVerbose(options.verbose);
        try {
            await buildNative({
                target: options.target,
                dawn: options.dawn,
                dawnBuild: options.dawnBuild,
                quickjs: options.quickjs,
                abi: options.abi,
                platform: options.platform,
                iosMin: options.iosMin,
                simulator: options.simulator,
                package: options.package,
                keystore: options.keystore,
                jdk: options.jdk,
                content: options.content,
            });
        } catch (err) {
            logger.error(err.message);
            process.exit(1);
        }
    });

program
    .command('sdk')
    .description('Build SDK only')
    .option('--no-cache', 'Disable build cache')
    .option('-v, --verbose', 'Verbose output', false)
    .action(async (options) => {
        logger.setVerbose(options.verbose);

        try {
            const noCache = !options.cache;
            // Regenerate EHT outputs in sdk/src first, or the SDK bundles stale
            // generated sources after a C++ header edit.
            await runEht({ noCache });
            await buildSdk({ noCache });
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

program
    .command('check-examples')
    .description('Type-check all example projects against current SDK types')
    .action(async () => {
        logger.header('Check Examples');
        const startTime = Date.now();
        await checkExamples(config.paths.root);
        logger.printTime(startTime);
    });

program
    .command('validate-prefabs')
    .description('Run the unified prefab validator over every shipped .esprefab')
    .action(async () => {
        logger.header('Validate Prefabs');
        const startTime = Date.now();
        await validatePrefabs(config.paths.root);
        logger.printTime(startTime);
    });

program
    .command('toolchain')
    .description('Package local emsdk + cmake into Tauri resources for bundling')
    .option('--no-strip', 'Skip stripping unnecessary files')
    .option('--no-archive', 'Skip creating tar.gz archive')
    .action(async (options) => {
        const args = [import.meta.dirname + '/toolchain/package.js'];
        if (!options.strip) args.push('--no-strip');
        if (!options.archive) args.push('--no-archive');

        const { execSync } = await import('child_process');
        execSync(`node ${args.join(' ')}`, { stdio: 'inherit', cwd: config.paths.root });
    });

program.parse();
