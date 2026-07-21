// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    validate-prefabs.js
 * @brief   Run the SDK's unified prefab validator over every shipped .esprefab
 *
 * Loads each prefab (migrating legacy v1 → current format first), resolves
 * nested/variant refs across the repo by uuid, and runs `validatePrefab`. Any
 * ERROR fails CI; warnings (stale overrides, dangling refs) are printed only.
 * The validator itself lives in the SDK so editor / runtime / cook / CI all
 * share ONE implementation.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import * as logger from '../utils/logger.js';

// Every directory tree that ships .esprefab assets to users.
const PREFAB_ROOTS = ['examples', 'sdk/src/ui/widgets/prefabs', 'desktop/templates'];
const SKIP_DIRS = new Set(['node_modules', '.esengine', 'dist', '.git']);

function walkPrefabs(dir, out) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        let st;
        try { st = statSync(full); } catch { continue; }
        if (st.isDirectory()) {
            if (SKIP_DIRS.has(entry)) continue;
            walkPrefabs(full, out);
        } else if (entry.endsWith('.esprefab')) {
            out.push(full);
        }
    }
}

export async function validatePrefabs(rootDir) {
    logger.step('Validating prefab assets...');

    const sdkNode = path.join(rootDir, 'sdk', 'dist', 'index.node.js');
    if (!existsSync(sdkNode)) {
        logger.error('SDK dist not found. Build SDK first: pnpm --filter ./sdk build');
        process.exit(1);
    }
    const { validatePrefab, migratePrefabData } = await import(pathToFileURL(sdkNode).href);

    const files = [];
    for (const rel of PREFAB_ROOTS) walkPrefabs(path.join(rootDir, rel), files);
    if (files.length === 0) {
        logger.warn('No .esprefab files found');
        return { files: 0, errors: 0, warnings: 0 };
    }

    // Parse + migrate every prefab up-front, and index by asset uuid (from the
    // sibling .meta) so nested/variant `@uuid:` refs resolve for the loader.
    const parsed = new Map(); // absolute file → migrated PrefabData
    const byUuid = new Map(); // asset uuid → migrated PrefabData
    let errors = 0;
    for (const file of files) {
        try {
            const data = migratePrefabData(JSON.parse(readFileSync(file, 'utf8'))).data;
            parsed.set(file, data);
            const metaPath = `${file}.meta`;
            if (existsSync(metaPath)) {
                const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
                if (meta.uuid) byUuid.set(meta.uuid, data);
            }
        } catch (err) {
            logger.error(`  ${path.relative(rootDir, file)} [parse] ${err.message}`);
            errors++;
        }
    }

    const resolveRef = (ref, fromFile) => {
        if (typeof ref !== 'string') return null;
        if (ref.startsWith('@uuid:')) return byUuid.get(ref.slice('@uuid:'.length)) ?? null;
        const abs = path.isAbsolute(ref) ? ref : path.join(path.dirname(fromFile), ref);
        return parsed.get(abs) ?? null;
    };

    let warnings = 0;
    for (const file of files) {
        const data = parsed.get(file);
        if (!data) continue; // already counted as a parse error
        const rel = path.relative(rootDir, file);
        const diags = validatePrefab(data, { loadPrefab: (ref) => resolveRef(ref, file) });
        if (diags.length === 0) {
            logger.success(rel);
            continue;
        }
        for (const d of diags) {
            const at = d.entityId ? ` @${d.entityId}${d.field ? `.${d.field}` : ''}` : '';
            const line = `  ${rel} [${d.code}]${at} ${d.message}`;
            if (d.severity === 'error') { logger.error(line); errors++; }
            else { logger.warn(line); warnings++; }
        }
    }

    logger.step(`Prefab validation: ${files.length} files, ${errors} error(s), ${warnings} warning(s)`);
    if (errors > 0) process.exitCode = 1;
    return { files: files.length, errors, warnings };
}
