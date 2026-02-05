import path from 'path';
import { glob } from 'fs/promises';
import config from '../build.config.js';
import * as logger from '../utils/logger.js';
import { runCommand } from '../utils/emscripten.js';
import { hashFiles, HashCache } from '../utils/hash.js';

export async function runEht(options = {}) {
    const { noCache = false } = options;

    logger.step('Running EHT code generation...');

    const rootDir = config.paths.root;
    const inputDir = path.join(rootDir, config.eht.inputDir);
    const script = path.join(rootDir, config.eht.script);

    const componentFiles = await getComponentFiles(inputDir);

    if (componentFiles.length === 0) {
        logger.warn('No component files found');
        return { skipped: true, reason: 'no-files' };
    }

    logger.debug(`Found ${componentFiles.length} component files`);

    if (!noCache) {
        const cache = new HashCache(config.paths.cache);
        await cache.load();

        const allFiles = [script, ...componentFiles];
        const currentHash = await hashFiles(allFiles);

        if (!await cache.isChanged('eht', currentHash)) {
            logger.success('EHT: No changes detected (cached)');
            return { skipped: true, reason: 'cached' };
        }

        try {
            await executeEht(rootDir, script);
            cache.set('eht', currentHash);
            await cache.save();
        } catch (err) {
            throw err;
        }
    } else {
        await executeEht(rootDir, script);
    }

    logger.success('EHT: Code generation complete');
    return { skipped: false };
}

async function getComponentFiles(inputDir) {
    const files = [];
    try {
        const { readdir, stat } = await import('fs/promises');

        async function walk(dir) {
            const entries = await readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    await walk(fullPath);
                } else if (entry.isFile() && entry.name.endsWith('.hpp')) {
                    files.push(fullPath);
                }
            }
        }

        await walk(inputDir);
    } catch {
        // Directory doesn't exist
    }
    return files;
}

async function executeEht(rootDir, script) {
    const outputDir = path.join(rootDir, config.eht.outputDir);
    const tsOutputDir = path.join(rootDir, config.eht.tsOutputDir);

    await runCommand('python3', [
        script,
        '--input', path.join(rootDir, config.eht.inputDir),
        '--output', outputDir,
        '--ts-output', tsOutputDir,
    ], {
        cwd: rootDir,
    });
}
