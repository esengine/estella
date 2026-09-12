// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import path from 'path';
import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import config from '../build.config.js';
import * as logger from '../utils/logger.js';

function toCppIdentifier(filename) {
    return filename
        .replace('.esshader', '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '_');
}

/**
 * A whole-line comment carries nothing a player's GPU can use, and a third of the
 * engine's shader source is comment — bytes that ride the binary into every game.
 * Emptied, not removed: diagnostics are remapped to `.esshader` line numbers, so
 * dropping a line would move every error message after it.
 */
function stripComments(source) {
    return source.split('\n').map((line) => (line.trimStart().startsWith('//') ? '' : line)).join('\n');
}

export async function generateShaderEmbeds() {
    const rootDir = config.paths.root;
    const shadersDir = path.join(rootDir, 'src/esengine/data/shaders');
    const outputPath = path.join(rootDir, 'src/esengine/renderer/rhi/ShaderEmbeds.generated.hpp');

    if (!existsSync(shadersDir)) {
        logger.warn('Shader directory not found, skipping embed generation');
        return;
    }

    const files = (await readdir(shadersDir)).filter(f => f.endsWith('.esshader')).sort();
    if (files.length === 0) {
        logger.warn('No .esshader files found');
        return;
    }

    const lines = [
        '#pragma once',
        '',
        'namespace esengine::ShaderEmbeds {',
        '',
    ];

    for (const file of files) {
        const content = await readFile(path.join(shadersDir, file), 'utf-8');
        const id = toCppIdentifier(file);
        lines.push(`inline constexpr const char* ${id} = R"esshader(${stripComments(content)})esshader";`);
        lines.push('');
    }

    lines.push('}  // namespace esengine::ShaderEmbeds');
    lines.push('');

    const output = lines.join('\n');

    if (existsSync(outputPath)) {
        const existing = await readFile(outputPath, 'utf-8');
        if (existing === output) {
            logger.debug('Shader embeds up to date');
            return;
        }
    }

    await writeFile(outputPath, output, 'utf-8');
    logger.step('Generated shader embeds');
}
