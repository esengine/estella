#!/usr/bin/env node
/**
 * @file    copy-esbuild-wasm.js
 * @brief   Copy esbuild.wasm to public directory
 */

import { copyFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '../..');

const sourcePatterns = [
    resolve(projectRoot, 'node_modules/.pnpm/esbuild-wasm@0.27.2/node_modules/esbuild-wasm/esbuild.wasm'),
    resolve(projectRoot, 'node_modules/.pnpm/esbuild-wasm@0.27.3/node_modules/esbuild-wasm/esbuild.wasm'),
    resolve(projectRoot, 'node_modules/esbuild-wasm/esbuild.wasm'),
];

const dest = resolve(__dirname, '../public/esbuild.wasm');

let copied = false;
for (const source of sourcePatterns) {
    if (existsSync(source)) {
        try {
            copyFileSync(source, dest);
            console.log(`[copy-esbuild-wasm] Copied ${source} -> ${dest}`);
            copied = true;
            break;
        } catch (err) {
            console.warn(`[copy-esbuild-wasm] Failed to copy from ${source}:`, err.message);
        }
    }
}

if (!copied) {
    console.warn('[copy-esbuild-wasm] WARNING: Could not find esbuild.wasm in node_modules');
    console.warn('[copy-esbuild-wasm] Tried:', sourcePatterns);
}
