// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import path from 'path';
import { glob } from 'fs/promises';
import config from '../build.config.js';
import * as logger from '../utils/logger.js';
import { runCommand, resolvePython } from '../utils/emscripten.js';
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

    // The generated output is a function of BOTH the C++ component headers AND the
    // generator sources — so a change to either must bust the cache. Hashing only the
    // headers silently skipped regeneration after a generator edit (you had to pass
    // --no-cache by hand).
    const generatorFiles = await getPythonFiles(path.join(path.dirname(script), 'eht'));

    if (!noCache) {
        const cache = new HashCache(config.paths.cache);
        await cache.load();

        const allFiles = [script, ...generatorFiles, ...componentFiles];
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

// The EHT generator package (tools/eht/**/*.py) — a second input to the generated
// output, so its sources join the cache hash. __pycache__ is skipped (derived).
async function getPythonFiles(dir) {
    const files = [];
    try {
        const { readdir } = await import('fs/promises');

        async function walk(d) {
            const entries = await readdir(d, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name === '__pycache__') continue;
                const fullPath = path.join(d, entry.name);
                if (entry.isDirectory()) {
                    await walk(fullPath);
                } else if (entry.isFile() && entry.name.endsWith('.py')) {
                    files.push(fullPath);
                }
            }
        }

        await walk(dir);
    } catch {
        // Directory doesn't exist
    }
    return files;
}

async function executeEht(rootDir, script) {
    const outputDir = path.join(rootDir, config.eht.outputDir);
    const tsOutputDir = path.join(rootDir, config.eht.tsOutputDir);

    const python = await resolvePython() ?? 'python3';
    await runCommand(python, [
        script,
        '--input', path.join(rootDir, config.eht.inputDir),
        '--output', outputDir,
        '--ts-output', tsOutputDir,
    ], {
        cwd: rootDir,
    });
}
