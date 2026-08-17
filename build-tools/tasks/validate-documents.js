// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    validate-documents.js
 * @brief   Run the SDK's document validators over every shipped scene and prefab
 *
 * Loads each document (migrating to the current format first), resolves a
 * prefab's nested/variant refs across the repo by uuid, and validates. Any ERROR
 * fails CI; warnings (stale overrides, dangling refs) are printed only. The
 * validators live in the SDK so editor / runtime / cook / CI all share ONE
 * implementation, and both document kinds are judged by the same checks.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import * as logger from '../utils/logger.js';

// Every directory tree that ships authored documents to users.
const DOCUMENT_ROOTS = ['examples', 'sdk/src/ui/widgets/prefabs', 'desktop/templates'];
const SKIP_DIRS = new Set(['node_modules', '.esengine', 'dist', '.git']);
const EXTENSIONS = ['.esprefab', '.esscene'];

function walkDocuments(dir, out) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        let st;
        try { st = statSync(full); } catch { continue; }
        if (st.isDirectory()) {
            if (SKIP_DIRS.has(entry) || entry.startsWith('dist-')) continue;
            walkDocuments(full, out);
        } else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) {
            out.push(full);
        }
    }
}

/** One finding, in the shape the report prints. */
const line = (rel, d) => {
    const at = d.entityId !== undefined ? ` @${d.entityId}${d.field ? `.${d.field}` : ''}` : '';
    return `  ${rel} [${d.code}]${at} ${d.message}`;
};

export async function validateDocuments(rootDir) {
    logger.step('Validating scenes and prefabs...');

    const sdkNode = path.join(rootDir, 'sdk', 'dist', 'index.node.js');
    if (!existsSync(sdkNode)) {
        logger.error('SDK dist not found. Build SDK first: pnpm --filter ./sdk build');
        process.exit(1);
    }
    const {
        validatePrefab, migratePrefabData, PREFAB_FORMAT_VERSION,
        validateScene, migrateSceneData, SCENE_FORMAT_VERSION,
    } = await import(pathToFileURL(sdkNode).href);

    const files = [];
    for (const rel of DOCUMENT_ROOTS) walkDocuments(path.join(rootDir, rel), files);
    if (files.length === 0) {
        logger.warn('No documents found');
        return { files: 0, errors: 0, warnings: 0 };
    }

    // Parse + migrate everything up-front, and index prefabs by asset uuid (from
    // the sibling .meta) so nested/variant `@uuid:` refs resolve for the loader.
    const parsed = new Map(); // absolute file → migrated document
    const rawVersions = new Map(); // absolute file → raw (pre-migration) version
    const byUuid = new Map(); // asset uuid → migrated PrefabData
    let errors = 0;
    for (const file of files) {
        const rel = path.relative(rootDir, file);
        const isPrefab = file.endsWith('.esprefab');
        try {
            const raw = JSON.parse(readFileSync(file, 'utf8'));
            rawVersions.set(file, raw && raw.version != null ? String(raw.version) : '(none)');
            const data = isPrefab ? migratePrefabData(raw).data : migrateSceneData(raw).data;
            parsed.set(file, data);
            if (!isPrefab) continue;
            const metaPath = `${file}.meta`;
            if (existsSync(metaPath)) {
                const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
                if (meta.uuid) byUuid.set(meta.uuid, data);
            }
        } catch (err) {
            logger.error(`  ${rel} [parse] ${err.message}`);
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
        const isPrefab = file.endsWith('.esprefab');

        // Repo assets must already be current format — a legacy file loads via
        // auto-migration for USERS, but our own examples/templates/widgets model
        // best practice. Re-save them to fix.
        const fileErrors = [];
        const fileWarnings = [];
        const rawVersion = rawVersions.get(file);
        const wantVersion = isPrefab ? PREFAB_FORMAT_VERSION : String(SCENE_FORMAT_VERSION);
        if (rawVersion !== wantVersion) {
            fileErrors.push(`  ${rel} [outdated-format] version "${rawVersion}" is not the current "${wantVersion}" — re-save it`);
        }
        const diags = isPrefab
            ? validatePrefab(data, { loadPrefab: (ref) => resolveRef(ref, file) })
            : validateScene(data);
        for (const d of diags) {
            (d.severity === 'error' ? fileErrors : fileWarnings).push(line(rel, d));
        }

        if (fileErrors.length === 0 && fileWarnings.length === 0) {
            logger.success(rel);
            continue;
        }
        for (const l of fileErrors) logger.error(l);
        for (const l of fileWarnings) logger.warn(l);
        errors += fileErrors.length;
        warnings += fileWarnings.length;
    }

    logger.step(`Document validation: ${files.length} files, ${errors} error(s), ${warnings} warning(s)`);
    if (errors > 0) process.exitCode = 1;
    return { files: files.length, errors, warnings };
}
