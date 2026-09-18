#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    check-gl-boundary.mjs
 * @brief   Who may touch a GPU object directly, on both sides of the wasm boundary.
 *
 * @details C++: raw `glXxx(...)` calls only in renderer/rhi/GLDevice.cpp; everything
 *          else reaches the GPU through GfxDevice. SDK: a GL texture object is
 *          created, registered and looked up only in the upload bridge
 *          (asset/glTextureUpload.ts) — a module that kept its own would write into
 *          the object the device replaced at the last loss, which is how a video and
 *          a leaderboard came back blank. Writing into the texture the bridge bound
 *          is every caller's business and is not matched here.
 *
 * Run: node tools/check-gl-boundary.mjs   (exit 1 on violation)
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src/esengine';

// The one file allowed to call gl* — the concrete GfxDevice backend.
const ALLOWED = new Set([
    'src/esengine/renderer/rhi/GLDevice.cpp',
]);

// A moved or renamed exemption means the guard is describing a tree that no
// longer exists — say so instead of reporting the backend as its own violation.
for (const allowed of ALLOWED) {
    if (!existsSync(allowed)) {
        console.error(`GL boundary guard is stale: exempt file ${allowed} does not exist.`);
        process.exit(1);
    }
}

// A gl call: `gl` + uppercase letter + identifier + `(`. Does not match `glm::`
// (lowercase m) or `GL_CONSTANT` macros.
const GL_CALL = /\bgl[A-Z]\w*\s*\(/;
const SOURCE_EXT = /\.(cpp|cc|cxx|hpp|hxx|h)$/;

function walk(dir, out = [], ext = SOURCE_EXT) {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) walk(p, out, ext);
        else if (ext.test(entry)) out.push(p);
    }
    return out;
}

const violations = [];
for (const file of walk(ROOT)) {
    const rel = file.replace(/\\/g, '/');
    if (ALLOWED.has(rel)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
        if (GL_CALL.test(line)) {
            violations.push(`  ${rel}:${i + 1}: ${line.trim()}`);
        }
    });
}

if (violations.length > 0) {
    console.error('GL boundary violation — raw gl* calls must live only in GLDevice.cpp:\n');
    console.error(violations.join('\n'));
    console.error(`\n${violations.length} violation(s). Route GPU work through GfxDevice / StateTracker.`);
    process.exit(1);
}

// --- SDK side: who may own a GL texture object -------------------------------

const SDK_ROOT = 'sdk/src';
const BRIDGE = 'sdk/src/asset/glTextureUpload.ts';
// The type surface declares these entry points; declaring is not calling.
const SDK_EXEMPT = new Set([BRIDGE, 'sdk/src/wasm.ts']);
const SDK_RULES = [
    [/\.createTexture\s*\(\s*\)/, 'creates a GL texture (the device owns them: handOverNewTexture)'],
    [/\.bindTexture\s*\(/, 'binds a texture itself (writeDeviceTexture binds the one the device has)'],
    [/\bGL\.textures\b|\.getNewId\s*\(/, "reaches into emscripten's texture pool"],
    [/\.registerExternalTextureS?i?z?e?d?\s*\(/, 'hands a native id to the device outside the bridge'],
];
const SDK_EXT = /\.ts$/;

if (!existsSync(BRIDGE)) {
    console.error(`GL boundary guard is stale: the upload bridge ${BRIDGE} does not exist.`);
    process.exit(1);
}

const sdkViolations = [];
for (const file of walk(SDK_ROOT, [], SDK_EXT)) {
    const rel = file.replace(/\\/g, '/');
    if (SDK_EXEMPT.has(rel) || rel.endsWith('.generated.ts')) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
        for (const [pattern, why] of SDK_RULES) {
            if (pattern.test(line)) sdkViolations.push(`  ${rel}:${i + 1}: ${why}\n      ${line.trim()}`);
        }
    });
}

if (sdkViolations.length > 0) {
    console.error(`GL texture boundary violation — only ${BRIDGE} owns GL texture objects:\n`);
    console.error(sdkViolations.join('\n'));
    console.error(`\n${sdkViolations.length} violation(s). Take a handle from handOverNewTexture and`
        + ' write through writeDeviceTexture, so a device loss cannot leave you uploading into a dead object.');
    process.exit(1);
}

console.log('GL boundary OK: no gl* calls outside GLDevice.cpp, and GL textures only in the upload bridge.');
