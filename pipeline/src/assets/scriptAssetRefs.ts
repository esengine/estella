// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    scriptAssetRefs.ts
 * @brief   The assets a project's scripts name, so a package carries them.
 *
 * Reachability starts at the scenes, and a scene cannot reference what only code
 * names: `assets.loadTexture('assets/ui/coin.png')`, an `insert(Sprite, { texture: … })`
 * at run time. Culled, such an asset works in the editor, which serves the whole
 * project, and 404s only on a device. The scripts are read here for the string
 * literals they hold, the way a bundler finds a static `import()`:
 *
 *  - a literal that IS a shippable asset's path (or an `@uuid:` ref) ships it;
 *  - a template literal with a static head ending in `/`
 *    (`` `assets/sfx/${name}.wav` ``) ships the folder it names, the way a
 *    bundler's context module does — and says so, since a folder is a guess at
 *    which of its files the code will ask for.
 *
 * Text, not a parse: a path in a comment ships too, which costs a file; a path
 * the scan missed costs a broken build. Anything else — a path assembled from
 * pieces, a name from data — still needs `alwaysInclude` in asset-groups.json.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const SCRIPT_EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/i;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build']);
/** Quoted strings and template heads; deliberately loose (see the file comment). */
const LITERAL = /'([^'\\\n]{3,})'|"([^"\\\n]{3,})"|`([^`\\$]*)(\$\{)?/g;
const UUID_REF = /^@uuid:([0-9a-f-]{36})$/i;

export interface ScriptAssetRefs {
    /** Whole literals, normalised as project-relative paths. */
    readonly literals: ReadonlySet<string>;
    /** Static heads of template literals that stop at a folder (`assets/sfx/`). */
    readonly folders: ReadonlySet<string>;
}

const normalise = (s: string): string => s.trim().replace(/\\/g, '/').replace(/^\.?\//, '');

/** Every script under @p dirs (project-relative), read for the literals it holds. */
export async function scanScriptAssetRefs(root: string, dirs: readonly string[]): Promise<ScriptAssetRefs> {
    const literals = new Set<string>();
    const folders = new Set<string>();
    const walk = async (abs: string): Promise<void> => {
        let entries;
        try { entries = await readdir(abs, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
            const child = path.join(abs, e.name);
            if (e.isDirectory()) { await walk(child); continue; }
            if (!SCRIPT_EXT.test(e.name) || e.name.endsWith('.d.ts')) continue;
            const text = await readFile(child, 'utf8').catch(() => '');
            for (const m of text.matchAll(LITERAL)) {
                const whole = m[1] ?? m[2];
                if (whole !== undefined) { literals.add(normalise(whole)); continue; }
                const head = m[3] ?? '';
                if (m[4] === undefined) literals.add(normalise(head));
                else if (head.endsWith('/') && head.length > 1) folders.add(normalise(head));
            }
        }
    };
    for (const dir of dirs) await walk(path.join(root, dir));
    return { literals, folders };
}

/** Why one asset ships because of the scripts: the literal that named it. */
export interface ScriptMatch {
    uuid: string;
    /** The literal (a path, a ref, or a folder head ending in `/`). */
    via: string;
}

/** The shippable assets @p refs name, each once, with what named it. */
export function matchScriptAssetRefs(
    refs: ScriptAssetRefs,
    shippable: ReadonlyArray<{ uuid: string; path: string }>,
): ScriptMatch[] {
    const out = new Map<string, ScriptMatch>();
    const byUuid = new Map(shippable.map((e) => [e.uuid.toLowerCase(), e]));
    for (const lit of refs.literals) {
        const ref = UUID_REF.exec(lit);
        const hit = ref ? byUuid.get(ref[1].toLowerCase()) : undefined;
        if (hit) out.set(hit.uuid, { uuid: hit.uuid, via: lit });
    }
    for (const e of shippable) {
        if (out.has(e.uuid)) continue;
        const p = normalise(e.path);
        if (refs.literals.has(p)) { out.set(e.uuid, { uuid: e.uuid, via: p }); continue; }
        for (const folder of refs.folders) {
            if (p.startsWith(folder)) { out.set(e.uuid, { uuid: e.uuid, via: folder }); break; }
        }
    }
    return [...out.values()];
}
