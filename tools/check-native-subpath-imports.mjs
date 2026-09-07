// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-native-subpath-imports.mjs — a natively packaged game really does
 *        receive what it imports from an `esengine/*` subpath.
 *
 * The unit test beside the registry proves the namespaces hold one token each.
 * This proves the other half: that the exporter's rewrite reaches them, that the
 * host's own bundle publishes them, and that the token a packaged script ends up
 * holding is the token the runtime installs resources under.
 *
 * Each subpath is represented by an export the CORE namespace does not have, so
 * a regression that quietly re-flattens subpaths onto `globalThis.ESEngine`
 * fails here instead of on a phone. physics3d carries the identity claim, since
 * `Res` is keyed by object identity and a second copy is invisible to any check
 * that only asks whether a name is defined.
 *
 *   node tools/check-native-subpath-imports.mjs
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODULES, NATIVE_MODULE_REGISTRY, nativeSubpaths } from './nativeScriptModules.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = path.join(ROOT, '.golden', 'native-subpaths');
const SOURCE = path.join(ROOT, 'examples', 'hello-world');
const BUNDLE = path.join(ROOT, 'sdk', 'dist', 'index.native.bundled.js');

const results = [];
const check = (what, ok, detail) => {
    results.push(ok);
    console.log(`${ok ? '✓' : '✗'} ${what}${detail ? ` — ${detail}` : ''}`);
};

// One export per subpath that the core namespace does NOT carry. Picked for that
// property: a name core also exports would pass while the bug was live.
const WITNESS = {
    'esengine/physics3d': 'Physics3D',
    'esengine/physics': 'physics2dPlugin',
    'esengine/spine': 'formatSpineDiagnostics',
    'esengine/dragonbones': 'DragonBonesManager',
};

if (!existsSync(BUNDLE)) {
    console.log('check-native-subpath-imports: no sdk/dist/index.native.bundled.js — '
        + 'build the SDK first (pnpm run build:sdk). Nothing judged.');
    process.exit(2);
}

rmSync(WORK, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
mkdirSync(WORK, { recursive: true });

/** A copy of the fixture with an extra module the entry imports for effect. */
function project(name, source) {
    const dir = path.join(WORK, name);
    cpSync(SOURCE, dir, { recursive: true });
    rmSync(path.join(dir, '.esengine'), { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    const probe = path.join(dir, 'src', 'subpathProbe.ts');
    writeFileSync(probe, source);
    const main = path.join(dir, 'src', 'main.ts');
    writeFileSync(main, `import './subpathProbe';\n${readFileSync(main, 'utf8')}`);
    return dir;
}

function exportNative(dir, name) {
    const out = path.join(WORK, `${name}-out`);
    const r = spawnSync(process.execPath, [
        path.join(ROOT, 'pipeline', 'bin', 'estella.mjs'), 'export', dir,
        '--platform', 'desktop', '--out', out,
    ], { encoding: 'utf8', cwd: ROOT });
    return { status: r.status, out, text: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// 1. Every subpath a project may import packages, and reaches the registry.
{
    const subs = nativeSubpaths();
    const imports = subs.map((s, i) => `import { ${WITNESS[s]} as w${i} } from '${s}';`).join('\n');
    // The witnesses are USED: esbuild elides an import whose binding is not, and
    // an elided import proves nothing about how it would have resolved.
    const uses = subs.map((_, i) => `w${i}`).join(', ');
    const dir = project('all-subpaths', `${imports}\nexport const seen = [${uses}].map((w) => typeof w);\n`);
    const { status, out, text } = exportNative(dir, 'all-subpaths');
    check('a game importing every subpath packages', status === 0,
          status === 0 ? `${subs.length} subpath(s)` : text.trim().split('\n').slice(-3).join(' | '));

    if (status === 0) {
        const js = readFileSync(path.join(out, 'scripts.js'), 'utf8');
        const missed = subs.filter((s) => !js.includes(`${NATIVE_MODULE_REGISTRY}[${JSON.stringify(s)}]`));
        check('each one resolves to the native module registry', missed.length === 0,
              missed.length ? `still on the core global: ${missed.join(', ')}` : NATIVE_MODULE_REGISTRY);
        check('none of them was flattened onto the core global',
              !/module\.exports = globalThis\.ESEngine;[\s\S]{0,200}esengine\/(physics|spine|dragonbones)/.test(js),
              'the bare specifier is the only core-global binding');
    }
}

// 2. The host's own bundle publishes what those scripts will ask for, and the
//    token is the one the runtime installs under — not a same-named twin.
{
    const harness = path.join(WORK, 'harness.mjs');
    writeFileSync(harness, `
import { readFileSync } from 'node:fs';
const src = readFileSync(${JSON.stringify(BUNDLE)}, 'utf8');
(0, eval)(src);
const reg = globalThis[${JSON.stringify(NATIVE_MODULE_REGISTRY)}];
const out = {};
for (const [spec, name] of Object.entries(${JSON.stringify(WITNESS)})) {
    out[spec] = reg?.[spec]?.[name] !== undefined;
}
const p3 = reg?.['esengine/physics3d']?.Physics3D;
const { App } = globalThis.ESEngine;
const app = new App();
app.insertResource(p3, null);
out.identity = app.hasResource(p3) === true;
out.rivalRejected = app.hasResource(globalThis.ESEngine.defineResource(null, 'Physics3D')) === false;
console.log(JSON.stringify(out));
`);
    const r = spawnSync(process.execPath, [harness], { encoding: 'utf8', cwd: ROOT });
    let seen = null;
    try { seen = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch { /* reported below */ }

    if (!seen) {
        check('the host bundle publishes the registry', false,
              (r.stderr || r.stdout || 'no output').trim().split('\n').slice(-2).join(' | '));
    } else {
        for (const [spec, name] of Object.entries(WITNESS)) {
            check(`${spec} hands a game its own ${name}`, seen[spec] === true,
                  seen[spec] ? 'present' : 'undefined — the core namespace does not carry it');
        }
        check('a resource installed by the runtime answers to the imported token',
              seen.identity === true, 'Res(Physics3D) resolves');
        check('a same-named token from a second bundle does NOT',
              seen.rivalRejected === true, 'identity, not the name, is the key');
    }
}

// 3. A specifier the SDK does not publish fails while it is being packaged.
{
    const dir = project('unknown-subpath',
        "import { nothing } from 'esengine/not-a-module';\nexport const seen = typeof nothing;\n");
    const { status, text } = exportNative(dir, 'unknown-subpath');
    check('an unknown esengine/* subpath fails the export', status !== 0,
          status !== 0 ? 'refused while packaging' : 'it PACKAGED — the failure would land on a device');
    if (status !== 0) {
        check('and the refusal says which specifier and why',
              text.includes('not a module the SDK publishes'), 'named in the error');
    }
}

// 4. And an entry that is real but forbidden says so in its own words.
{
    const forbidden = Object.entries(MODULES)
        .find(([, m]) => m.disposition === 'forbidden-native-script')?.[0];
    const dir = project('forbidden-subpath',
        `import { anything } from '${forbidden}';\nexport const seen = typeof anything;\n`);
    const { status, text } = exportNative(dir, 'forbidden-subpath');
    check(`${forbidden} is refused to a game script`, status !== 0,
          status !== 0 ? 'refused while packaging' : 'it PACKAGED');
    if (status !== 0) {
        check('with the reason the table records',
              text.includes('cannot be imported by a game script'), 'the why reaches the person');
    }
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0
    ? `check-native-subpath-imports: ${results.length} claim(s) — a packaged game gets the module it named`
    : `check-native-subpath-imports: ${failed} of ${results.length} claim(s) failed`);
process.exit(failed === 0 ? 0 : 1);
