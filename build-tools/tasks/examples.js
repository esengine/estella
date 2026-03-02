/**
 * @file    examples.js
 * @brief   Pack example projects into zip files for editor
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, copyFileSync } from 'fs';
import path from 'path';
import { deflateRawSync } from 'zlib';
import * as logger from '../utils/logger.js';

const EXAMPLES_DIR = 'examples';
const OUTPUT_DIR = 'desktop/public/examples';
const THUMBNAILS_DIR = 'thumbnails';
const THUMBNAIL_FILENAME = 'thumbnail.png';

function discoverExamples(rootDir) {
    const examplesPath = path.join(rootDir, EXAMPLES_DIR);
    if (!existsSync(examplesPath)) return [];

    return readdirSync(examplesPath)
        .filter(entry => {
            const fullPath = path.join(examplesPath, entry);
            return statSync(fullPath).isDirectory() &&
                existsSync(path.join(fullPath, 'project.esproject'));
        })
        .map(name => ({ name, dir: path.join(EXAMPLES_DIR, name) }));
}

const EXCLUDE_PATTERNS = [
    '.DS_Store',
    'node_modules',
    'dist',
    '.esengine/cache',
    'tools',
    '__pycache__',
];

function shouldExclude(relativePath) {
    for (const pattern of EXCLUDE_PATTERNS) {
        if (relativePath === pattern || relativePath.startsWith(pattern + '/') ||
            relativePath.includes('/' + pattern + '/') || relativePath.endsWith('/' + pattern)) {
            return true;
        }
    }
    return false;
}

function collectFiles(dir, baseDir) {
    const results = [];
    for (const entry of readdirSync(dir)) {
        const fullPath = path.join(dir, entry);
        const relativePath = path.relative(baseDir, fullPath).split(path.sep).join('/');
        if (shouldExclude(relativePath)) continue;
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
            results.push(...collectFiles(fullPath, baseDir));
        } else {
            results.push({ fullPath, relativePath });
        }
    }
    return results;
}

function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        crc ^= buf[i];
        for (let j = 0; j < 8; j++) {
            crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function createZip(srcDir, outputPath) {
    const files = collectFiles(srcDir, srcDir);
    const localParts = [];
    const centralEntries = [];
    let offset = 0;

    for (const file of files) {
        const content = readFileSync(file.fullPath);
        const compressed = deflateRawSync(content);
        const nameBytes = Buffer.from(file.relativePath, 'utf8');
        const crc = crc32(content);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0, 6);
        local.writeUInt16LE(8, 8);
        local.writeUInt16LE(0, 10);
        local.writeUInt16LE(0, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(content.length, 22);
        local.writeUInt16LE(nameBytes.length, 26);
        local.writeUInt16LE(0, 28);

        localParts.push(local, nameBytes, compressed);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0, 8);
        central.writeUInt16LE(8, 10);
        central.writeUInt16LE(0, 12);
        central.writeUInt16LE(0, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(compressed.length, 20);
        central.writeUInt32LE(content.length, 24);
        central.writeUInt16LE(nameBytes.length, 28);
        central.writeUInt32LE(offset, 42);

        centralEntries.push(central, nameBytes);
        offset += 30 + nameBytes.length + compressed.length;
    }

    const centralDirOffset = offset;
    let centralDirSize = 0;
    for (const buf of centralEntries) centralDirSize += buf.length;

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(centralDirSize, 12);
    eocd.writeUInt32LE(centralDirOffset, 16);

    writeFileSync(outputPath, Buffer.concat([...localParts, ...centralEntries, eocd]));
}

export async function zipExamples(rootDir) {
    logger.step('Packing example projects...');

    const examples = discoverExamples(rootDir);
    if (examples.length === 0) {
        logger.warn('No example projects found');
        return;
    }

    const outDir = path.join(rootDir, OUTPUT_DIR);
    if (!existsSync(outDir)) {
        mkdirSync(outDir, { recursive: true });
    }

    const thumbDir = path.join(outDir, THUMBNAILS_DIR);
    if (!existsSync(thumbDir)) {
        mkdirSync(thumbDir, { recursive: true });
    }

    for (const example of examples) {
        const srcDir = path.join(rootDir, example.dir);
        const zipPath = path.join(outDir, `${example.name}.zip`);

        try {
            createZip(srcDir, zipPath);
            logger.success(`${example.name}.zip`);
        } catch (err) {
            logger.error(`Failed to zip ${example.name}: ${err.message}`);
        }

        const thumbSrc = path.join(srcDir, THUMBNAIL_FILENAME);
        if (existsSync(thumbSrc)) {
            const thumbDest = path.join(thumbDir, `${example.name}.png`);
            copyFileSync(thumbSrc, thumbDest);
            logger.success(`${example.name} thumbnail`);
        }
    }
}
