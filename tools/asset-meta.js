#!/usr/bin/env node
/**
 * @file    asset-meta.js
 * @brief   Generate .meta sidecar files for assets (UUID v4 + importer defaults).
 *
 * Each asset file (texture, audio, prefab, scene, etc.) gets a JSON sidecar
 * `<file>.meta` with a stable UUID and type-appropriate importer defaults.
 * Already-present .meta files are never overwritten — the UUID is the stable
 * identity for scene/prefab references and must survive across runs.
 *
 * Usage:
 *   node tools/asset-meta.js <dir>...           # generate missing metas
 *   node tools/asset-meta.js <dir> --dry-run    # preview only
 *   node tools/asset-meta.js <dir> --check      # exit 1 if any missing (CI)
 *   node tools/asset-meta.js <dir> --verbose
 *
 * Exit codes:
 *   0  — success; all assets have meta (or --dry-run preview)
 *   1  — --check mode: one or more assets missing .meta
 *   2  — usage / IO error
 */

import { readdir, stat, readFile, writeFile, access } from 'node:fs/promises';
import { join, extname, basename, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

const META_VERSION = '2.0';

// Directories to skip when scanning.
const SKIP_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', 'out',
    '.cache', '.turbo', '.vscode', '__pycache__',
]);

// Files to skip (besides *.meta itself).
const SKIP_FILES = new Set([
    '.DS_Store', 'Thumbs.db', 'desktop.ini',
    '.gitkeep', '.gitignore', '.gitattributes',
]);

// Extension → asset type mapping.
// Extensions are matched case-insensitively; dot included.
const EXT_TO_TYPE = Object.freeze({
    // Textures
    '.png': 'texture',
    '.jpg': 'texture',
    '.jpeg': 'texture',
    '.webp': 'texture',
    '.bmp': 'texture',
    // Audio
    '.wav': 'audio',
    '.mp3': 'audio',
    '.ogg': 'audio',
    '.aac': 'audio',
    '.flac': 'audio',
    '.m4a': 'audio',
    '.webm': 'audio',
    // Engine data
    '.esprefab': 'prefab',
    '.esscene': 'scene',
    '.esshader': 'shader',
    '.esmaterial': 'material',
    '.esmat': 'material',
    '.estl': 'timeline',
    '.esanim': 'animation',
    '.esanimclip': 'animation',
    // Fonts
    '.fnt': 'bitmapFont',
    '.bmfont': 'bitmapFont',
    '.ttf': 'font',
    '.otf': 'font',
    '.woff': 'font',
    '.woff2': 'font',
    // Tilemap
    '.tmx': 'tilemap',
    '.tmj': 'tilemap',
    // Spine (skel / atlas — .png pair handled by the texture entry)
    '.skel': 'spine',
    '.atlas': 'spine',
});

/**
 * Default `importer` settings per type. Shapes match the examples/ meta
 * files that existed before this tool landed; new types err on the side
 * of an empty object so future importer fields can be added additively.
 */
function getImporterDefaults(type) {
    switch (type) {
        case 'texture':
            return {
                maxSize: 2048,
                filterMode: 'linear',
                wrapMode: 'repeat',
                premultiplyAlpha: false,
                sliceBorder: { left: 0, right: 0, top: 0, bottom: 0 },
            };
        case 'prefab':
        case 'scene':
            return { autoMigrate: true };
        case 'spine':
            return { defaultSkin: 'default', premultiplyAlpha: false, scale: 1 };
        case 'audio':
        case 'shader':
        case 'material':
        case 'timeline':
        case 'animation':
        case 'bitmapFont':
        case 'font':
        case 'tilemap':
            return {};
        default:
            return {};
    }
}

/** Returns the asset type for a path, or null if the extension is unknown. */
function getAssetType(filePath) {
    const ext = extname(filePath).toLowerCase();
    return EXT_TO_TYPE[ext] ?? null;
}

/** Builds the meta object (JSON-shape) for a given type. */
function buildMeta(type) {
    return {
        uuid: randomUUID(),
        version: META_VERSION,
        type,
        importer: getImporterDefaults(type),
    };
}

function formatMeta(meta) {
    return JSON.stringify(meta, null, 2) + '\n';
}

async function exists(path) {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

async function* walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
            yield* walk(full);
        } else if (entry.isFile()) {
            if (SKIP_FILES.has(entry.name) || entry.name.startsWith('.')) continue;
            if (entry.name.endsWith('.meta')) continue;
            yield full;
        }
    }
}

/**
 * Scan `dir` recursively and generate .meta files for any asset that
 * doesn't already have one. Returns a summary.
 *
 * Options:
 *   dryRun  — don't write files
 *   check   — collect missing but also don't write (for CI)
 *   verbose — log every skip and every create
 *   onCreate(absPath, meta) — optional callback per created meta
 */
export async function generateMetaForDir(dir, options = {}) {
    const { dryRun = false, check = false, verbose = false, onCreate } = options;
    const root = resolve(dir);

    try {
        const s = await stat(root);
        if (!s.isDirectory()) {
            throw new Error(`Not a directory: ${root}`);
        }
    } catch (err) {
        throw new Error(`Cannot read directory "${root}": ${err.message}`);
    }

    const created = [];
    const alreadyPresent = [];
    const skipped = [];

    for await (const filePath of walk(root)) {
        const type = getAssetType(filePath);
        if (type === null) {
            if (verbose) skipped.push({ path: filePath, reason: 'unknown extension' });
            continue;
        }

        const metaPath = filePath + '.meta';
        if (await exists(metaPath)) {
            alreadyPresent.push({ path: filePath, metaPath });
            continue;
        }

        const meta = buildMeta(type);
        created.push({ path: filePath, metaPath, meta });

        if (!dryRun && !check) {
            await writeFile(metaPath, formatMeta(meta), 'utf8');
            if (onCreate) await onCreate(metaPath, meta);
        }
    }

    return { root, created, alreadyPresent, skipped };
}

function printSummary(results, { verbose, dryRun, check }) {
    let totalCreated = 0;
    let totalPresent = 0;
    let totalSkipped = 0;

    for (const r of results) {
        const rel = (p) => relative(process.cwd(), p) || '.';
        totalCreated += r.created.length;
        totalPresent += r.alreadyPresent.length;
        totalSkipped += r.skipped.length;

        if (verbose) {
            for (const s of r.skipped) {
                console.log(`  skip:    ${rel(s.path)}  (${s.reason})`);
            }
            for (const p of r.alreadyPresent) {
                console.log(`  exists:  ${rel(p.metaPath)}`);
            }
        }

        for (const c of r.created) {
            const prefix = dryRun || check ? '  would:  ' : '  wrote:  ';
            console.log(`${prefix}${rel(c.metaPath)}  (type: ${c.meta.type}, uuid: ${c.meta.uuid})`);
        }
    }

    const verb = dryRun ? 'would create' : check ? 'missing' : 'created';
    console.log(
        `\n${verb}: ${totalCreated}` +
        `  |  already present: ${totalPresent}` +
        (verbose ? `  |  skipped (unknown ext): ${totalSkipped}` : ''),
    );
}

async function main() {
    const { values, positionals } = parseArgs({
        options: {
            'dry-run': { type: 'boolean', default: false },
            'check':   { type: 'boolean', default: false },
            'verbose': { type: 'boolean', short: 'v', default: false },
            'help':    { type: 'boolean', short: 'h', default: false },
        },
        allowPositionals: true,
    });

    if (values.help || positionals.length === 0) {
        console.log(`Usage: node tools/asset-meta.js <dir>... [options]

Options:
  --dry-run      Show what would be created, write nothing
  --check        Exit 1 if any asset is missing .meta (CI mode)
  -v, --verbose  Log every asset considered
  -h, --help     Show this help`);
        process.exit(values.help ? 0 : 2);
    }

    const results = [];
    for (const dir of positionals) {
        try {
            results.push(await generateMetaForDir(dir, {
                dryRun: values['dry-run'],
                check: values.check,
                verbose: values.verbose,
            }));
        } catch (err) {
            console.error(`error: ${err.message}`);
            process.exit(2);
        }
    }

    printSummary(results, {
        verbose: values.verbose,
        dryRun: values['dry-run'],
        check: values.check,
    });

    if (values.check) {
        const anyMissing = results.some(r => r.created.length > 0);
        process.exit(anyMissing ? 1 : 0);
    }
}

// Run as CLI when invoked directly; skip when imported as a module.
const isMain = import.meta.url === `file://${process.argv[1]}`
    || import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
    main().catch(err => {
        console.error(err);
        process.exit(2);
    });
}

// Exports for reuse (e.g., migration script).
export { EXT_TO_TYPE, META_VERSION, getAssetType, getImporterDefaults, buildMeta };
