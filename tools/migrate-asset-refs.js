#!/usr/bin/env node
/**
 * @file    migrate-asset-refs.js
 * @brief   Rewrite scene/prefab asset references to canonical UUID refs.
 *
 * Scans the given directory for `*.esscene` and `*.esprefab` files and
 * walks every string value inside the JSON. Two replacement rules:
 *
 *   1. The string exactly matches a known asset path (from scanning
 *      `.meta` sidecars) → replace with `"@uuid:<uuid>"`.
 *   2. The string is a bare v4 UUID (left over from pre-Phase 1 tooling)
 *      → replace with `"@uuid:<uuid>"` (canonical form).
 *
 * Anything else is untouched. Whole-string match only (no substring
 * replacement), so fields that happen to contain a path-like substring
 * are safe.
 *
 * The tool is idempotent: run it twice, second run rewrites nothing.
 *
 * Usage:
 *   node tools/migrate-asset-refs.js <dir>...            # rewrite in place
 *   node tools/migrate-asset-refs.js <dir> --dry-run     # preview only
 *   node tools/migrate-asset-refs.js <dir> --verbose
 *
 * Exit codes:
 *   0  — success (or dry-run)
 *   2  — usage / IO error
 */

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, extname, resolve, relative } from 'node:path';
import { parseArgs } from 'node:util';

import { buildManifest } from './asset-meta.js';

const TARGET_EXT = new Set(['.esscene', '.esprefab']);
const SKIP_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', 'out',
    '.cache', '.turbo', '.vscode', '__pycache__',
]);

const UUID_V4_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_REF_PREFIX = '@uuid:';

async function* walkScenes(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            yield* walkScenes(full);
        } else if (entry.isFile() && TARGET_EXT.has(extname(entry.name).toLowerCase())) {
            yield full;
        }
    }
}

/**
 * Walk a JSON value and collect every (oldValue → newValue) string
 * replacement the replacer suggests. Doesn't mutate `value` — caller
 * applies the replacements at the source-text level so original
 * JSON formatting (single-line objects, custom indentation, etc.) is
 * preserved instead of churned through JSON.stringify.
 */
function collectReplacements(value, replacer, out) {
    if (Array.isArray(value)) {
        for (const v of value) {
            if (typeof v === 'string') {
                const r = replacer(v);
                if (r !== null && r !== v) out.set(v, r);
            } else if (v && typeof v === 'object') {
                collectReplacements(v, replacer, out);
            }
        }
    } else if (value && typeof value === 'object') {
        for (const v of Object.values(value)) {
            if (typeof v === 'string') {
                const r = replacer(v);
                if (r !== null && r !== v) out.set(v, r);
            } else if (v && typeof v === 'object') {
                collectReplacements(v, replacer, out);
            }
        }
    }
}

/**
 * Escape a string literal for use inside a JavaScript RegExp.
 */
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Apply a (oldValue → newValue) replacement map to the source text.
 * Each oldValue is matched as a *quoted JSON string* — i.e. `"oldValue"`
 * — so we never touch keys, comments, or substrings of other values.
 * Returns `{ text, count }`.
 */
function applyReplacements(raw, replacements) {
    let text = raw;
    let count = 0;
    for (const [oldVal, newVal] of replacements) {
        // Match the JSON string literal "oldVal" exactly (allowing no
        // inner escapes, since the values we migrate are plain paths or
        // UUIDs with no backslashes / quotes).
        const pattern = new RegExp(`"${escapeRegExp(oldVal)}"`, 'g');
        const next = text.replace(pattern, () => {
            count++;
            return `"${newVal}"`;
        });
        text = next;
    }
    return { text, count };
}

/**
 * Build the replacer closure: path strings → canonical UUID ref; bare
 * UUIDs → canonical UUID ref; everything else → null (no change).
 */
function makeReplacer(pathToUuid) {
    return (value) => {
        // Already canonical; leave it alone.
        if (value.startsWith(UUID_REF_PREFIX)) return null;

        // Path match (highest confidence — exact match against a known asset).
        const uuid = pathToUuid.get(value);
        if (uuid) return UUID_REF_PREFIX + uuid.toLowerCase();

        // Bare UUID (legacy). Normalize to canonical form.
        if (UUID_V4_REGEX.test(value)) {
            return UUID_REF_PREFIX + value.toLowerCase();
        }

        return null;
    };
}

async function migrateFile(filePath, replacer, { dryRun, verbose }) {
    const raw = await readFile(filePath, 'utf8');
    let doc;
    try {
        doc = JSON.parse(raw);
    } catch (err) {
        return { filePath, skipped: true, reason: `malformed JSON: ${err.message}` };
    }

    const replacements = new Map();
    collectReplacements(doc, replacer, replacements);

    if (replacements.size === 0) {
        if (verbose) {
            console.log(`  unchanged: ${relative(process.cwd(), filePath)}`);
        }
        return { filePath, replaced: 0, wrote: false };
    }

    const { text, count } = applyReplacements(raw, replacements);

    if (!dryRun) {
        await writeFile(filePath, text, 'utf8');
    }

    const tag = dryRun ? 'would rewrite' : 'rewrote';
    console.log(`  ${tag}: ${relative(process.cwd(), filePath)}  (${count} ref${count === 1 ? '' : 's'})`);

    return { filePath, replaced: count, wrote: !dryRun };
}

async function main() {
    const { values, positionals } = parseArgs({
        options: {
            'dry-run':  { type: 'boolean', default: false },
            'verbose':  { type: 'boolean', short: 'v', default: false },
            'help':     { type: 'boolean', short: 'h', default: false },
        },
        allowPositionals: true,
    });

    if (values.help || positionals.length === 0) {
        console.log(`Usage: node tools/migrate-asset-refs.js <dir>... [options]

Options:
  --dry-run      Show what would change, write nothing
  -v, --verbose  Log every scene/prefab considered, even if unchanged
  -h, --help     Show this help`);
        process.exit(values.help ? 0 : 2);
    }

    // Build pathToUuid by scanning every .meta under the given dirs.
    // The manifest paths are relative to each scanned dir — we keep
    // per-dir scopes so a path in one project doesn't accidentally
    // resolve against a uuid in another.
    console.log('scanning .meta files...');
    const perDirMaps = [];
    for (const dir of positionals) {
        try {
            const s = await stat(resolve(dir));
            if (!s.isDirectory()) {
                console.error(`error: not a directory: ${dir}`);
                process.exit(2);
            }
        } catch (err) {
            console.error(`error: ${err.message}`);
            process.exit(2);
        }

        const { manifest, warnings } = await buildManifest(dir, { manifestBase: dir });
        const pathToUuid = new Map();
        for (const entry of manifest.entries) {
            pathToUuid.set(entry.path, entry.uuid);
        }
        if (warnings.length > 0) {
            console.warn(`  ${warnings.length} .meta warning(s) in ${dir}`);
            if (values.verbose) {
                for (const w of warnings) console.warn(`    ${w.metaPath} — ${w.reason}`);
            }
        }
        perDirMaps.push({ dir: resolve(dir), pathToUuid });
        console.log(`  ${dir}: ${pathToUuid.size} asset(s) indexed`);
    }

    // Walk each dir for scene/prefab files, rewrite with that dir's map.
    console.log('\nmigrating scene/prefab refs...');
    let totalFiles = 0;
    let totalReplacements = 0;
    let filesChanged = 0;

    for (const { dir, pathToUuid } of perDirMaps) {
        const replacer = makeReplacer(pathToUuid);
        for await (const filePath of walkScenes(dir)) {
            totalFiles++;
            const result = await migrateFile(filePath, replacer, {
                dryRun: values['dry-run'],
                verbose: values.verbose,
            });
            if (result.skipped) {
                console.warn(`  skipped: ${relative(process.cwd(), result.filePath)} — ${result.reason}`);
                continue;
            }
            totalReplacements += result.replaced;
            if (result.replaced > 0) filesChanged++;
        }
    }

    const verb = values['dry-run'] ? 'would rewrite' : 'rewrote';
    console.log(
        `\n${verb}: ${filesChanged} file(s)` +
        `  |  total refs: ${totalReplacements}` +
        `  |  considered: ${totalFiles}`,
    );
}

const isMain = import.meta.url === `file://${process.argv[1]}`
    || import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
    main().catch(err => {
        console.error(err);
        process.exit(2);
    });
}

export { collectReplacements, applyReplacements, makeReplacer };
