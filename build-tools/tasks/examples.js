/**
 * @file    examples.js
 * @brief   Pack example projects into zip files for editor
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import * as logger from '../utils/logger.js';

const EXAMPLES = [
    { name: 'space-shooter', dir: 'examples/space-shooter' },
];

const OUTPUT_DIR = 'desktop/public/examples';

export async function zipExamples(rootDir) {
    logger.step('Packing example projects...');

    const outDir = path.join(rootDir, OUTPUT_DIR);
    if (!existsSync(outDir)) {
        mkdirSync(outDir, { recursive: true });
    }

    for (const example of EXAMPLES) {
        const srcDir = path.join(rootDir, example.dir);
        const zipPath = path.join(outDir, `${example.name}.zip`);

        if (!existsSync(srcDir)) {
            logger.warn(`Example not found: ${srcDir}`);
            continue;
        }

        const excludes = [
            '-x', '*.DS_Store',
            '-x', '*node_modules/*',
            '-x', '*dist/*',
            '-x', '*.esengine/cache/*',
            '-x', '*tools/*',
            '-x', '*__pycache__/*',
        ];

        try {
            execSync(
                `cd "${srcDir}" && zip -r "${path.resolve(zipPath)}" . ${excludes.join(' ')}`,
                { stdio: 'pipe' }
            );
            logger.success(`${example.name}.zip`);
        } catch (err) {
            logger.error(`Failed to zip ${example.name}: ${err.message}`);
        }
    }
}
