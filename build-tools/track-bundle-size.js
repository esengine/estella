#!/usr/bin/env node

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import config from './build.config.js';
import * as logger from './utils/logger.js';

const BASELINES_FILE = path.join(config.paths.root, '.github', 'bundle-size-baselines.json');
const THRESHOLDS = {
    'wasm/web/esengine.wasm': 800 * 1024,
    'wasm/web/physics.wasm': 200 * 1024,
    'wasm/web/spine42.wasm': 300 * 1024,
    'wasm/web/spine38.wasm': 300 * 1024,
    'wasm/web/spine41.wasm': 300 * 1024,
    'wasm/wechat/esengine.wxgame.wasm': 4 * 1024 * 1024,
    'wasm/wechat/esengine.wxgame.js': 512 * 1024,
    'sdk/esm/esengine.js': 150 * 1024,
};

async function loadManifest() {
    const manifestPath = path.join(config.paths.output, 'manifest.json');
    if (!existsSync(manifestPath)) {
        logger.error('Manifest file not found. Run build with --manifest flag first.');
        process.exit(1);
    }

    const content = await readFile(manifestPath, 'utf-8');
    return JSON.parse(content);
}

async function loadBaselines() {
    if (!existsSync(BASELINES_FILE)) {
        return {};
    }

    const content = await readFile(BASELINES_FILE, 'utf-8');
    return JSON.parse(content);
}

async function saveBaselines(baselines) {
    await mkdir(path.dirname(BASELINES_FILE), { recursive: true });
    await writeFile(BASELINES_FILE, JSON.stringify(baselines, null, 2), 'utf-8');
}

function extractSizes(manifest) {
    const sizes = {};

    for (const target of manifest.targets) {
        for (const output of target.outputs) {
            sizes[output.path] = {
                size: output.size,
                sizeKB: output.sizeKB,
                sha256: output.sha256,
            };
        }
    }

    return sizes;
}

function compareSizes(current, baselines) {
    const results = [];
    let hasExceeded = false;

    for (const [filePath, data] of Object.entries(current)) {
        const baseline = baselines[filePath];
        const threshold = THRESHOLDS[filePath];

        const result = {
            path: filePath,
            current: data.size,
            currentKB: data.sizeKB,
            baseline: baseline?.size || null,
            baselineKB: baseline?.sizeKB || null,
            delta: baseline ? data.size - baseline.size : null,
            deltaKB: baseline ? data.sizeKB - baseline.sizeKB : null,
            deltaPercent: baseline ? ((data.size - baseline.size) / baseline.size * 100).toFixed(2) : null,
            threshold,
            thresholdKB: threshold ? Math.round(threshold / 1024) : null,
            exceeded: threshold ? data.size > threshold : false,
        };

        if (result.exceeded) {
            hasExceeded = true;
        }

        results.push(result);
    }

    return { results, hasExceeded };
}

function formatSizeChange(deltaKB) {
    if (deltaKB === null || deltaKB === 0) {
        return '';
    }
    const sign = deltaKB > 0 ? '+' : '';
    return ` (${sign}${deltaKB}KB)`;
}

function printReport(comparison, isCI = false) {
    const { results, hasExceeded } = comparison;

    logger.info('\n📦 Bundle Size Report:');

    for (const result of results) {
        const status = result.exceeded ? '❌' : '✓';
        const change = formatSizeChange(result.deltaKB);
        const percent = result.deltaPercent ? ` ${result.deltaPercent > 0 ? '+' : ''}${result.deltaPercent}%` : '';

        if (result.threshold) {
            logger.info(`  ${status} ${result.path}: ${result.currentKB}KB / ${result.thresholdKB}KB${change}${percent}`);
        } else {
            logger.info(`  ${status} ${result.path}: ${result.currentKB}KB${change}${percent}`);
        }
    }

    if (hasExceeded && isCI) {
        logger.error('\n⚠️  Bundle size thresholds exceeded!');
        return false;
    }

    logger.success('\n✓ Bundle sizes OK');
    return true;
}

function generatePRComment(comparison) {
    const { results } = comparison;

    let comment = '## 📦 Bundle Size Report\n\n';
    comment += '| File | Size | Baseline | Change | Threshold | Status |\n';
    comment += '|------|------|----------|--------|-----------|--------|\n';

    for (const result of results) {
        const size = `${result.currentKB}KB`;
        const baseline = result.baselineKB !== null ? `${result.baselineKB}KB` : 'N/A';
        const change = result.deltaKB !== null
            ? `${result.deltaKB > 0 ? '+' : ''}${result.deltaKB}KB (${result.deltaPercent}%)`
            : '-';
        const threshold = result.thresholdKB !== null ? `${result.thresholdKB}KB` : 'N/A';
        const status = result.exceeded ? '❌ Exceeded' : '✓ OK';

        comment += `| ${result.path} | ${size} | ${baseline} | ${change} | ${threshold} | ${status} |\n`;
    }

    return comment;
}

async function main() {
    const args = process.argv.slice(2);
    const mode = args[0] || 'check';

    const manifest = await loadManifest();
    const currentSizes = extractSizes(manifest);
    const baselines = await loadBaselines();

    if (mode === 'update') {
        await saveBaselines(currentSizes);
        logger.success('Bundle size baselines updated');
        return;
    }

    if (mode === 'check') {
        const comparison = compareSizes(currentSizes, baselines);
        const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
        const success = printReport(comparison, isCI);

        if (!success && isCI) {
            process.exit(1);
        }
        return;
    }

    if (mode === 'pr-comment') {
        const comparison = compareSizes(currentSizes, baselines);
        const comment = generatePRComment(comparison);
        console.log(comment);
        return;
    }

    logger.error(`Unknown mode: ${mode}. Use 'check', 'update', or 'pr-comment'.`);
    process.exit(1);
}

main().catch(err => {
    logger.error(err.message);
    process.exit(1);
});
