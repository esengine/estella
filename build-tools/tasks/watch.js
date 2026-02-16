import path from 'path';
import chokidar from 'chokidar';
import config from '../build.config.js';
import * as logger from '../utils/logger.js';
import { runEht } from './eht.js';
import { buildWasm } from './wasm.js';
import { buildSdk } from './sdk.js';
import { syncToDesktop } from './sync.js';

export async function startWatch(options = {}) {
    const { target = 'web' } = options;

    logger.header('Watch Mode');
    logger.info(`Watching for changes (target: ${target})`);
    logger.info('Press Ctrl+C to stop');
    logger.divider();

    const rootDir = config.paths.root;

    let isBuilding = false;
    let pendingTypes = new Set();

    async function rebuild(type, file) {
        if (isBuilding) {
            pendingTypes.add(type);
            return;
        }

        isBuilding = true;
        const relFile = path.relative(rootDir, file);
        logger.info(`File changed: ${relFile}`);

        try {
            await executeBuild(type);
            logger.success('Rebuild complete');
        } catch (err) {
            logger.error(`Build failed: ${err.message}`);
        } finally {
            isBuilding = false;
        }

        if (pendingTypes.size > 0) {
            const types = pendingTypes;
            pendingTypes = new Set();
            await executePendingBuild(types);
        }
    }

    async function executeBuild(type) {
        if (type === 'component') {
            await runEht({ noCache: true });
            await buildWasm(target, { debug: true });
            await buildSdk();
        } else if (type === 'cpp') {
            await buildWasm(target, { debug: true });
        } else if (type === 'ts') {
            await buildSdk();
        }
        await syncToDesktop();
    }

    async function executePendingBuild(types) {
        isBuilding = true;
        logger.info(`Processing pending changes: ${[...types].join(', ')}`);

        try {
            if (types.has('component')) {
                await runEht({ noCache: true });
                await buildWasm(target, { debug: true });
                await buildSdk();
            } else {
                if (types.has('cpp')) {
                    await buildWasm(target, { debug: true });
                }
                if (types.has('ts')) {
                    await buildSdk();
                }
            }
            await syncToDesktop();
            logger.success('Rebuild complete');
        } catch (err) {
            logger.error(`Build failed: ${err.message}`);
        } finally {
            isBuilding = false;
        }

        if (pendingTypes.size > 0) {
            const nextTypes = pendingTypes;
            pendingTypes = new Set();
            await executePendingBuild(nextTypes);
        }
    }

    const componentWatcher = chokidar.watch(
        config.watch.components.map(p => path.join(rootDir, p)),
        {
            ignoreInitial: true,
            awaitWriteFinish: { stabilityThreshold: 300 },
        }
    );

    const cppWatcher = chokidar.watch(
        config.watch.cpp.map(p => path.join(rootDir, p)),
        {
            ignoreInitial: true,
            awaitWriteFinish: { stabilityThreshold: 300 },
            ignored: config.watch.components.map(p => path.join(rootDir, p)),
        }
    );

    const tsWatcher = chokidar.watch(
        config.watch.ts.map(p => path.join(rootDir, p)),
        {
            ignoreInitial: true,
            awaitWriteFinish: { stabilityThreshold: 300 },
        }
    );

    componentWatcher.on('change', (file) => rebuild('component', file));
    componentWatcher.on('add', (file) => rebuild('component', file));

    cppWatcher.on('change', (file) => {
        if (!isComponentFile(file)) {
            rebuild('cpp', file);
        }
    });

    tsWatcher.on('change', (file) => rebuild('ts', file));
    tsWatcher.on('add', (file) => rebuild('ts', file));

    process.on('SIGINT', () => {
        logger.info('Stopping watch mode...');
        componentWatcher.close();
        cppWatcher.close();
        tsWatcher.close();
        process.exit(0);
    });

    await new Promise(() => {});
}

function isComponentFile(file) {
    return file.includes('ecs/components') && file.endsWith('.hpp');
}
