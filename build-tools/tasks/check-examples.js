/**
 * @file    check-examples.js
 * @brief   Type-check all example projects against current SDK/editor types
 */

import { existsSync, readdirSync, statSync, mkdirSync, symlinkSync, rmSync, lstatSync, unlinkSync } from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import * as logger from '../utils/logger.js';

const EXAMPLES_DIR = 'examples';

function discoverExamples(rootDir) {
    const examplesPath = path.join(rootDir, EXAMPLES_DIR);
    if (!existsSync(examplesPath)) return [];

    return readdirSync(examplesPath)
        .filter(entry => {
            const fullPath = path.join(examplesPath, entry);
            return statSync(fullPath).isDirectory() &&
                existsSync(path.join(fullPath, 'tsconfig.json')) &&
                existsSync(path.join(fullPath, 'src'));
        })
        .map(name => ({ name, dir: path.join(rootDir, EXAMPLES_DIR, name) }));
}

function setupTypeLinks(exampleDir, rootDir) {
    const sdkDist = path.join(rootDir, 'sdk', 'dist');
    const editorDist = path.join(rootDir, 'editor', 'dist');

    if (!existsSync(sdkDist)) {
        throw new Error(`SDK dist not found at ${sdkDist}. Run "pnpm --filter ./sdk build" first.`);
    }

    const esengineDir = path.join(exampleDir, '.esengine');
    const sdkLink = path.join(esengineDir, 'sdk');
    const editorLink = path.join(esengineDir, 'editor');

    mkdirSync(esengineDir, { recursive: true });

    if (!existsSync(sdkLink)) {
        symlinkSync(sdkDist, sdkLink, 'dir');
    }

    if (!existsSync(editorLink) && existsSync(editorDist)) {
        symlinkSync(editorDist, editorLink, 'dir');
    }
}

function isSymlinkOrExists(p) {
    try { lstatSync(p); return true; } catch { return false; }
}

function cleanTypeLinks(exampleDir) {
    const sdkLink = path.join(exampleDir, '.esengine', 'sdk');
    const editorLink = path.join(exampleDir, '.esengine', 'editor');

    try { if (isSymlinkOrExists(sdkLink)) unlinkSync(sdkLink); } catch {}
    try { if (isSymlinkOrExists(editorLink)) unlinkSync(editorLink); } catch {}
}

export async function checkExamples(rootDir) {
    logger.step('Type-checking example projects...');

    const examples = discoverExamples(rootDir);
    if (examples.length === 0) {
        logger.warn('No example projects found');
        return { passed: 0, failed: 0, errors: [] };
    }

    const sdkDist = path.join(rootDir, 'sdk', 'dist');
    if (!existsSync(sdkDist)) {
        logger.error('SDK dist not found. Build SDK first: pnpm --filter ./sdk build');
        process.exit(1);
    }

    const tscCandidates = [
        path.join(rootDir, 'node_modules', 'typescript', 'bin', 'tsc'),
        path.join(rootDir, 'sdk', 'node_modules', 'typescript', 'bin', 'tsc'),
        path.join(rootDir, 'editor', 'node_modules', 'typescript', 'bin', 'tsc'),
    ];
    const tscBin = tscCandidates.find(p => existsSync(p));
    if (!tscBin) {
        logger.error('TypeScript not found. Run "pnpm install" first.');
        process.exit(1);
    }

    const results = { passed: 0, failed: 0, errors: [] };

    for (const example of examples) {
        try {
            setupTypeLinks(example.dir, rootDir);
            execSync(`node ${tscBin} --noEmit`, {
                cwd: example.dir,
                stdio: 'pipe',
                timeout: 30000,
            });
            logger.success(example.name);
            results.passed++;
        } catch (err) {
            const stderr = err.stdout?.toString() || err.stderr?.toString() || err.message;
            logger.error(`${example.name}`);
            const lines = stderr.split('\n').filter(l => l.includes('error TS'));
            for (const line of lines.slice(0, 10)) {
                logger.error(`  ${line.trim()}`);
            }
            if (lines.length > 10) {
                logger.error(`  ... and ${lines.length - 10} more errors`);
            }
            results.failed++;
            results.errors.push({ name: example.name, errors: lines });
        } finally {
            cleanTypeLinks(example.dir);
        }
    }

    logger.step(`Results: ${results.passed} passed, ${results.failed} failed out of ${examples.length} examples`);

    if (results.failed > 0) {
        process.exitCode = 1;
    }

    return results;
}
