// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  sdkProgram.mjs — the SDK's typed public entries, and a program over them.
 *
 * Two gates ask the same question of the same files: api-surface reports what the
 * surface IS, check-freeze-bar asks whether a symbol has earned @public. Both need
 * the entry list and a checker pinned the same way, and a second copy of either is
 * a second answer waiting to disagree.
 */
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SDK = join(ROOT, 'sdk');
export const ETC = join(SDK, 'etc');

export const ts = createRequire(join(SDK, '/'))('typescript');

/** The node a doc comment attaches to — for `export const x`, the statement. */
function docAnchor(decl) {
    let node = decl;
    if (ts.isVariableDeclaration(node) && node.parent?.parent) node = node.parent.parent;
    return node;
}

/**
 * The `/** *\/` blocks immediately above a declaration, as raw text. Read from
 * source rather than the AST's JSDoc accessors so it answers the same way for a
 * hand-written source file and a bundler's re-printed declaration.
 */
export function leadingDoc(decl) {
    const node = docAnchor(decl);
    const text = node.getSourceFile().getFullText();
    const out = [];
    for (const range of ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []) {
        const comment = text.slice(range.pos, range.end);
        if (comment.startsWith('/**')) out.push(comment);
    }
    return out.join('\n');
}

/** Lines of a doc block that are neither delimiters nor tags. */
export function docProseLines(doc) {
    return doc.split('\n')
        .map((l) => l.replace(/^\s*\/?\*+\/?/, '').replace(/\*\/\s*$/, '').trim())
        .filter((l) => l && !l.startsWith('@'));
}

/** Typed public entries (mirrors package.json "exports" + rollup dtsBuilds). */
export const ENTRIES = {
    'index': 'src/index.ts',
    'index.node': 'src/index.node.ts',
    'index.native': 'src/index.native.ts',
    'physics': 'src/physics/index.ts',
    'spine': 'src/spine/index.ts',
    'dragonbones': 'src/dragonbones/index.ts',
    'wasm': 'src/wasm.ts',
    'wechat': 'src/index.wechat.ts',
    'minigame': 'src/index.minigame.ts',
};

/**
 * A program over `entryPaths`. `strictLibCheck` is for callers reading built
 * declarations: skipLibCheck would skip every file they came to check.
 */
export function createSdkProgram(entryPaths = ENTRIES, { strictLibCheck = false } = {}) {
    const configFile = ts.readConfigFile(join(SDK, 'tsconfig.json'), ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, SDK);
    const rootNames = Object.values(entryPaths).map((p) => join(SDK, p));
    const absent = rootNames.filter((p) => !existsSync(p));
    if (absent.length) {
        console.error('sdkProgram: the SDK is not built — run `pnpm --filter ./sdk build` first.');
        for (const p of absent) console.error(`  missing ${p.replace(SDK + '/', '')}`);
        process.exit(2);
    }
    // rootDir is src and a caller may root under dist; nothing is emitted here.
    const options = {
        ...parsed.options,
        noEmit: true,
        rootDir: undefined,
        ...(strictLibCheck ? { skipLibCheck: false } : {}),
    };
    // typeToString relativizes import("...") paths against the host cwd — pin it
    // so a report is byte-identical no matter where the tool is invoked from.
    const host = ts.createCompilerHost(options);
    host.getCurrentDirectory = () => SDK;
    const program = ts.createProgram({ rootNames, options, host });
    return { program, checker: program.getTypeChecker(), options };
}
