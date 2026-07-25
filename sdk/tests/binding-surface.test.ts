// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    binding-surface.test.ts
 * @brief   Handshake guard for the hand-written WASM function-binding surface.
 *
 * The EHT-generated boundary (components/enums/ptr accessors/ABI hash) is
 * single-sourced and handshake-guarded, but the FUNCTION surface of the main
 * module is still maintained by hand on both sides: `emscripten::function`
 * registrations in bindings/WebSDKEntry.cpp + bindings/TilemapBindings.cpp,
 * mirrored by the `ESEngineModule` interface (wasm.ts) and `TilemapModule`
 * (tilemap/tilemapAPI.ts). Nothing cross-checked them until now: a binding
 * added on one side and forgotten on the other only fails at runtime — an
 * undefined call in whatever code path first touches it.
 *
 * This test IS the handshake: it parses the real registration sites and the
 * real TS interfaces and asserts the two surfaces match, in both directions,
 * plus the embind class surfaces (ResourceManager, EstellaContext). Same
 * pattern as cpp-contract.test.ts, extended from constants to functions.
 *
 * Side modules are hand-mirrored too and guarded the same way: physics and
 * spine export via `EMSCRIPTEN_KEEPALIVE` C functions (JS-visible as `_name`,
 * spine additionally reached through the `cw('name', ...)` cwrap table),
 * basis via the CMake `EXPORTED_FUNCTIONS` list (the link already verifies
 * that list against the C++ definitions — the unverified edge is TS↔CMake).
 *
 * Deliberately NOT asserted (possible future tightening): optionality
 * coherence — a `#ifdef`-gated C++ registration being declared required in
 * TS. All shipping variants currently compile every gated feature, and TS
 * optionality also serves older-wasm compatibility, so existence is the
 * contract we pin here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const CPP = resolve(__dirname, '../../src/esengine');
const SDK = resolve(__dirname, '../src');

const read = (abs: string): string => {
    // Fail loud (not skip) if a source moved — a silently-disabled guard is
    // worse than no guard.
    if (!existsSync(abs)) throw new Error(`binding-surface source missing: ${abs}`);
    return readFileSync(abs, 'utf8');
};

/** Strip C/C++/TS comments, preserving newlines so offsets stay line-stable. */
function stripComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/\/\/[^\n]*/g, '');
}

// =============================================================================
// C++ side: emscripten registration parsing
// =============================================================================

/** All `emscripten::function("name", ...)` registration names in a file. */
function parseFunctionRegistrations(cppSource: string): Set<string> {
    const out = new Set<string>();
    const re = /emscripten::function\(\s*"(\w+)"/g;
    const src = stripComments(cppSource);
    for (let m = re.exec(src); m; m = re.exec(src)) out.add(m[1]);
    return out;
}

/**
 * Method registrations of one `emscripten::class_<T>("Name")` chain: every
 * `.function("name", &target)` between the class_ head and the chain's
 * terminating `;` (the chain itself contains no semicolons), mapped to the
 * target's last identifier.
 */
function parseClassRegistration(cppSource: string, className: string): Map<string, string> {
    const src = stripComments(cppSource);
    const head = src.indexOf(`("${className}")`);
    if (head < 0) throw new Error(`embind class_ registration '${className}' not found`);
    const end = src.indexOf(';', head);
    const chain = src.slice(head, end);
    const out = new Map<string, string>();
    const re = /\.function\(\s*"(\w+)"\s*,\s*[^&]*&([\w:]+)/g;
    for (let m = re.exec(chain); m; m = re.exec(chain)) {
        const parts = m[2].split('::');
        out.set(m[1], parts[parts.length - 1]);
    }
    return out;
}

/**
 * All `EMSCRIPTEN_KEEPALIVE` C exports in a file: the identifier right before
 * the parameter list that follows each annotation, with parameter count.
 */
function parseKeepaliveSigs(cppSource: string): Map<string, number> {
    const src = stripComments(cppSource);
    const out = new Map<string, number>();
    const re = /EMSCRIPTEN_KEEPALIVE\b/g;
    for (let m = re.exec(src); m; m = re.exec(src)) {
        const paren = src.indexOf('(', m.index);
        if (paren < 0) continue;
        const tokens = src.slice(m.index + m[0].length, paren).match(/\w+/g);
        if (!tokens?.length) throw new Error(`EMSCRIPTEN_KEEPALIVE with no function name at offset ${m.index}`);
        out.set(tokens[tokens.length - 1], countParams(src, paren));
    }
    return out;
}

function parseKeepaliveExports(cppSource: string): Set<string> {
    return new Set(parseKeepaliveSigs(cppSource).keys());
}

/** Count the top-level parameters of a parenthesized list starting at `open`. */
function countParams(src: string, open: number): number {
    let depth = 0;
    let commas = 0;
    let sawToken = false;
    for (let i = open; i < src.length; i++) {
        const ch = src[i];
        if (ch === '(' || ch === '{' || ch === '[') depth++;
        else if (ch === ')' || ch === '}' || ch === ']') {
            depth--;
            if (depth === 0) return sawToken ? commas + 1 : 0;
        } else if (ch === ',' && depth === 1) commas++;
        else if (depth === 1 && /\S/.test(ch)) sawToken = true;
    }
    throw new Error(`unbalanced parameter list at offset ${open}`);
}

/**
 * Every plausible arity of `symbol` in the pooled C++ sources: each
 * `symbol(...)` occurrence (declaration, definition, or call — argument
 * counts equal parameter counts, these bindings have no default arguments)
 * contributes its top-level comma count.
 */
function cppArities(pooled: string, symbol: string): Set<number> {
    const out = new Set<number>();
    const re = new RegExp(`\\b${symbol}\\s*\\(`, 'g');
    for (let m = re.exec(pooled); m; m = re.exec(pooled)) {
        out.add(countParams(pooled, m.index + m[0].length - 1));
    }
    return out;
}

interface Registration {
    name: string;
    /** last identifier of the bound `&esengine::...` target; null for lambdas */
    symbol: string | null;
    /** lambda registrations carry their arity directly */
    lambdaArity: number | null;
}

/** `emscripten::function("name", &esengine::sym | +[](...){...})` entries. */
function parseRegistrationTargets(cppSource: string): Registration[] {
    const src = stripComments(cppSource);
    const out: Registration[] = [];
    const re = /emscripten::function\(\s*"(\w+)"\s*,\s*(&[\w:]+|\+?\[\]\s*\()/g;
    for (let m = re.exec(src); m; m = re.exec(src)) {
        if (m[2].startsWith('&')) {
            const parts = m[2].slice(1).split('::');
            out.push({ name: m[1], symbol: parts[parts.length - 1], lambdaArity: null });
        } else {
            out.push({ name: m[1], symbol: null, lambdaArity: countParams(src, m.index + m[0].length - 1) });
        }
    }
    return out;
}

/**
 * The `-sEXPORTED_FUNCTIONS=['_a','_b',...]` list of the link target whose
 * line contains `marker` (how modules without KEEPALIVE annotations export).
 */
function parseExportedFunctions(cmakeSource: string, marker: string): Set<string> {
    const line = cmakeSource.split('\n').find((l) => l.includes('EXPORTED_FUNCTIONS') && l.includes(marker));
    if (!line) throw new Error(`no EXPORTED_FUNCTIONS line containing '${marker}' in cmake source`);
    const out = new Set<string>();
    const re = /'(\w+)'/g;
    for (let m = re.exec(line); m; m = re.exec(line)) out.add(m[1]);
    return out;
}

// =============================================================================
// TS side: interface member parsing
// =============================================================================

/**
 * Call-signature members (`name(...)` / `name?(...)`) declared at the top
 * level of `interface <name> { ... }`, with their parameter counts. Property
 * members (`HEAPU8: ...`, `Registry: new () => ...`) and members of nested
 * object types (`GL: {...}`, inline return-type literals) are excluded: a
 * member must sit at brace depth 0 of the body and start after `;`/`{`/`}`.
 */
function parseInterfaceMethodSigs(tsSource: string, interfaceName: string): Map<string, number> {
    const src = stripComments(tsSource);
    const head = new RegExp(`interface\\s+${interfaceName}\\s*\\{`).exec(src);
    if (!head) throw new Error(`TS interface '${interfaceName}' not found`);
    const start = head.index + head[0].length;
    let depth = 1;
    let end = -1;
    for (let i = start; i < src.length; i++) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}' && --depth === 0) { end = i; break; }
    }
    if (end < 0) throw new Error(`TS interface '${interfaceName}': unterminated body`);
    const body = src.slice(start, end);
    const out = new Map<string, number>();
    const memberRe = /(\w+)\s*\??\(/g;
    for (let m = memberRe.exec(body); m; m = memberRe.exec(body)) {
        let braces = 0;
        for (let i = 0; i < m.index; i++) {
            if (body[i] === '{') braces++;
            else if (body[i] === '}') braces--;
        }
        if (braces !== 0) continue;
        let j = m.index - 1;
        while (j >= 0 && /\s/.test(body[j])) j--;
        if (j >= 0 && !';{}'.includes(body[j])) continue;
        out.set(m[1], countParams(body, m.index + m[0].length - 1));
    }
    return out;
}

function parseInterfaceMethods(tsSource: string, interfaceName: string): Set<string> {
    return new Set(parseInterfaceMethodSigs(tsSource, interfaceName).keys());
}

/**
 * `cw('name', ret, [argTypes])` / `cwrap(...)` call-site literals in a TS
 * file, mapped to their argTypes count (the arity the wrapper calls with).
 */
function parseCwrapSigs(tsSource: string): Map<string, number> {
    const src = stripComments(tsSource);
    const out = new Map<string, number>();
    const re = /\bcw(?:rap)?\(\s*['"](\w+)['"]\s*,\s*(?:null|'[^']*'|"[^"]*")\s*,\s*\[([^\]]*)\]/g;
    for (let m = re.exec(src); m; m = re.exec(src)) {
        out.set(m[1], m[2].trim() ? m[2].split(',').length : 0);
    }
    return out;
}

function parseCwrapNames(tsSource: string): Set<string> {
    return new Set(parseCwrapSigs(tsSource).keys());
}

const sorted = (s: Iterable<string>): string[] => [...s].sort();
const missingFrom = (names: Iterable<string>, universe: Set<string>): string[] =>
    sorted([...names].filter((n) => !universe.has(n)));

// =============================================================================
// The two surfaces
// =============================================================================

// Hand-written registration sites (the mirrors under guard) + the generated
// ones (their TS twins are generated too, but their names must count when
// checking that a TS declaration is not a phantom).
const webSdkEntry = read(resolve(CPP, 'bindings/WebSDKEntry.cpp'));
const tilemapBindings = read(resolve(CPP, 'bindings/TilemapBindings.cpp'));
const generatedCpp = [
    read(resolve(CPP, 'bindings/WebBindings.generated.cpp')),
    read(resolve(CPP, 'bindings/EditorAPI.generated.cpp')),
];

const handRegistered = new Set([
    ...parseFunctionRegistrations(webSdkEntry),
    ...parseFunctionRegistrations(tilemapBindings),
]);
const allRegistered = new Set([
    ...handRegistered,
    ...generatedCpp.flatMap((src) => [...parseFunctionRegistrations(src)]),
]);

const wasmTs = read(resolve(SDK, 'wasm.ts'));
const tilemapApiTs = read(resolve(SDK, 'tilemap/tilemapAPI.ts'));

const moduleDeclared = parseInterfaceMethods(wasmTs, 'ESEngineModule');
const tilemapDeclared = parseInterfaceMethods(tilemapApiTs, 'TilemapModule');
const allDeclared = new Set([...moduleDeclared, ...tilemapDeclared]);

// Emscripten-runtime exports declared for ergonomics; not embind registrations.
const RUNTIME_EXPORTS = new Set(['_malloc', '_free']);

describe('WASM binding surface: module functions (hand-written mirror handshake)', () => {
    it('every TS-declared ESEngineModule function is a real registration (no phantom decls)', () => {
        const phantom = missingFrom(
            [...moduleDeclared].filter((n) => !RUNTIME_EXPORTS.has(n)),
            allRegistered,
        );
        expect(phantom, `declared in wasm.ts but registered nowhere in bindings/*.cpp: ${phantom.join(', ')}`)
            .toEqual([]);
    });

    it('every TS-declared TilemapModule function is a real registration (no phantom decls)', () => {
        const phantom = missingFrom(
            [...tilemapDeclared].filter((n) => !RUNTIME_EXPORTS.has(n)),
            allRegistered,
        );
        expect(phantom, `declared in tilemapAPI.ts but registered nowhere in bindings/*.cpp: ${phantom.join(', ')}`)
            .toEqual([]);
    });

    it('every hand-registered binding is declared in the TS surface (no unmirrored bindings)', () => {
        const unmirrored = missingFrom(handRegistered, allDeclared);
        expect(unmirrored, `registered in WebSDKEntry/TilemapBindings but declared in no TS interface: ${unmirrored.join(', ')}`)
            .toEqual([]);
    });
});

// =============================================================================
// Side modules (C exports)
// =============================================================================

// Emscripten runtime members declared on the side-module interfaces.
const SIDE_RUNTIME = new Set(['_malloc', '_free', 'cwrap', 'UTF8ToString', 'stringToNewUTF8']);

function expectMirrored(label: string, tsDeclared: Set<string>, cppExports: Set<string>): void {
    const exported = new Set([...cppExports].map((n) => `_${n}`));
    const declared = new Set([...tsDeclared].filter((n) => !SIDE_RUNTIME.has(n)));
    const phantom = missingFrom(declared, exported);
    const unmirrored = missingFrom(exported, declared);
    expect(phantom, `${label}: declared in TS but exported nowhere: ${phantom.join(', ')}`).toEqual([]);
    expect(unmirrored, `${label}: exported but not reachable from TS: ${unmirrored.join(', ')}`).toEqual([]);
}

describe('WASM binding surface: side modules (C exports)', () => {
    // The four TUs the SDK's own interface mirrors. PhysicsReadback.cpp is
    // deliberately absent: its `*Bytes` helpers exist so a NATIVE wrapper can copy
    // exactly what a getter published, and no SDK caller ever names them.
    const PHYSICS_TUS = ['PhysicsModuleEntry.cpp', 'PhysicsShapes.cpp',
                         'PhysicsJoints.cpp', 'PhysicsQueries.cpp'];

    it('PhysicsWasmModule mirrors the physics module exports exactly', () => {
        const cpp = new Set(
            PHYSICS_TUS.flatMap((f) => [...parseKeepaliveExports(read(resolve(CPP, 'bindings', f)))]),
        );
        const ts = parseInterfaceMethods(read(resolve(SDK, 'physics/PhysicsModuleLoader.ts')), 'PhysicsWasmModule');
        expectMirrored('physics', ts, cpp);
    });

    // The native half of the same surface. A device reaches physics through QuickJS
    // wrappers EHT generates from PhysicsBindings.hpp, so a declaration missing there
    // is an entry point the device silently does not answer — and one that exists
    // there but nowhere else is a wrapper that will not link.
    it('PhysicsBindings.hpp declares exactly what the module exports', () => {
        const header = stripComments(read(resolve(CPP, 'bindings/PhysicsBindings.hpp')));
        const declared = new Set([...header.matchAll(/\b(physics_\w+)\s*\(/g)].map((m) => m[1]!));
        const exported = new Set([...PHYSICS_TUS, 'PhysicsReadback.cpp']
            .flatMap((f) => [...parseKeepaliveExports(read(resolve(CPP, 'bindings', f)))]));
        const undeclared = [...exported].filter((n) => !declared.has(n)).sort();
        const phantom = [...declared].filter((n) => !exported.has(n)).sort();
        expect(undeclared, `exported but not declared in PhysicsBindings.hpp (no native wrapper): ${undeclared.join(', ')}`)
            .toEqual([]);
        expect(phantom, `declared in PhysicsBindings.hpp but defined nowhere: ${phantom.join(', ')}`)
            .toEqual([]);
    });

    it('SpineWasmModule + its cwrap table mirror the spine module exports exactly', () => {
        const cpp = parseKeepaliveExports(read(resolve(CPP, 'bindings/SpineModuleEntry.cpp')));
        const loaderTs = read(resolve(SDK, 'spine/SpineModuleLoader.ts'));
        const declared = new Set([
            ...parseInterfaceMethods(loaderTs, 'SpineWasmModule'),
            ...[...parseCwrapNames(loaderTs)].map((n) => `_${n}`),
        ]);
        expectMirrored('spine', declared, cpp);
    });

    it('BasisWasmModule mirrors the basis EXPORTED_FUNCTIONS list exactly', () => {
        const cmake = read(resolve(CPP, '../../cmake/Emscripten.cmake'));
        const exported = parseExportedFunctions(cmake, 'es_basis');
        exported.delete('_malloc');
        exported.delete('_free');
        const ts = new Set(
            [...parseInterfaceMethods(read(resolve(SDK, 'asset/basisTranscoder.ts')), 'BasisWasmModule')]
                .filter((n) => !SIDE_RUNTIME.has(n)),
        );
        const phantom = missingFrom(ts, exported);
        const unmirrored = missingFrom(exported, ts);
        expect(phantom, `basis: declared in TS but not in EXPORTED_FUNCTIONS: ${phantom.join(', ')}`).toEqual([]);
        expect(unmirrored, `basis: exported but not declared in TS: ${unmirrored.join(', ')}`).toEqual([]);
    });
});

describe('WASM binding surface: embind class methods', () => {
    it('CppResourceManager mirrors class_<ResourceManager> exactly', () => {
        const cpp = parseClassRegistration(webSdkEntry, 'ResourceManager');
        const ts = parseInterfaceMethods(wasmTs, 'CppResourceManager');
        // Native (embedded-Dawn) byte-upload methods: no wasm heap to marshal into,
        // so they take the RGBA bytes directly and have NO embind counterpart on the
        // web ResourceManager. Optional + native-only by construction — exempt from
        // the web mirror the way embind's implicit `delete` is below.
        ts.delete('createTextureFromBytes');
        ts.delete('updateTextureSubregionFromBytes');
        ts.delete('createTextureFromKTX2');   // KTX2 transcode lives in the native host, not embind
        expect(sorted(ts)).toEqual(sorted(cpp.keys()));
    });

    it('CppEngineContext mirrors class_<EstellaContext> exactly (embind-implicit delete aside)', () => {
        const cpp = parseClassRegistration(webSdkEntry, 'EstellaContext');
        const ts = parseInterfaceMethods(wasmTs, 'CppEngineContext');
        ts.delete('delete'); // added by embind on every class instance, never registered
        expect(sorted(ts)).toEqual(sorted(cpp.keys()));
    });
});

// =============================================================================
// Signature arity handshake
// =============================================================================
// Existence drift is pinned above; this pins the parameter COUNT of every
// mirrored function. TS types are erased at runtime, so an arity-drifted
// declaration compiles every SDK call site happily and only explodes when the
// path is exercised — this catches it at test time instead. Types stay
// hand-written (the TS mirror is deliberately richer than what generation
// from C++ could produce); embind/cwrap check value kinds at call time.

const pooledModuleCpp = [
    'bindings/WebSDKEntry.cpp',
    'bindings/TilemapBindings.cpp',
    'bindings/RendererBindings.hpp',
    'bindings/RendererBindings.cpp',
    'bindings/UIBindings.hpp',
    'bindings/UIBindings.cpp',
    'bindings/ResourceManagerBindings.hpp',
    'bindings/ResourceManagerBindings.cpp',
    'bindings/GeometryBindings.hpp',
    'bindings/GeometryBindings.cpp',
    'bindings/ImmediateDrawBindings.hpp',
    'bindings/ImmediateDrawBindings.cpp',
    'bindings/PostProcessBindings.hpp',
    'bindings/PostProcessBindings.cpp',
    'bindings/TilemapBindings.hpp',
    'bindings/AnimationBindings.hpp',
    'bindings/AnimationBindings.cpp',
].map((f) => stripComments(read(resolve(CPP, f)))).join('\n');

function expectArities(label: string, tsSigs: Map<string, number>, cppSigs: Map<string, number>): void {
    const problems: string[] = [];
    for (const [name, tsArity] of tsSigs) {
        if (SIDE_RUNTIME.has(name)) continue;
        const cppArity = cppSigs.get(name.replace(/^_/, ''));
        if (cppArity == null) continue; // existence guard covers missing exports
        if (cppArity !== tsArity) problems.push(`${name}: TS declares ${tsArity} params, C++ has ${cppArity}`);
    }
    expect(problems, `${label}:\n${problems.join('\n')}`).toEqual([]);
}

describe('WASM binding surface: signature arity handshake', () => {
    it('parser self-check: known signatures parse to their real arities', () => {
        // Guards the guard: if a parser regresses into returning empty/zero
        // sets, every comparison above it would pass vacuously.
        expect(parseInterfaceMethodSigs(wasmTs, 'ESEngineModule').get('draw_line')).toBe(9);
        expect(parseInterfaceMethodSigs(wasmTs, 'ESEngineModule').get('renderer_end')).toBe(0);
        expect(cppArities(pooledModuleCpp, 'draw_line')).toContain(9);
        expect(parseKeepaliveSigs(read(resolve(CPP, 'bindings/PhysicsModuleEntry.cpp'))).get('physics_step')).toBe(1);
        expect(parseCwrapSigs(read(resolve(SDK, 'spine/SpineModuleLoader.ts'))).get('spine_setSkin')).toBe(2);
    });

    it('every hand-registered module function has a matching TS parameter count', () => {
        const regs = [
            ...parseRegistrationTargets(webSdkEntry),
            ...parseRegistrationTargets(tilemapBindings),
        ];
        const declarations = [
            ['wasm.ts', parseInterfaceMethodSigs(wasmTs, 'ESEngineModule')],
            ['tilemapAPI.ts', parseInterfaceMethodSigs(tilemapApiTs, 'TilemapModule')],
        ] as const;
        const problems: string[] = [];
        for (const reg of regs) {
            const candidates = reg.lambdaArity != null
                ? new Set([reg.lambdaArity])
                : cppArities(pooledModuleCpp, reg.symbol!);
            if (candidates.size === 0) {
                problems.push(`${reg.name}: no C++ prototype found for '${reg.symbol}' — extend the source pool`);
                continue;
            }
            for (const [file, sigs] of declarations) {
                const tsArity = sigs.get(reg.name);
                if (tsArity == null) continue; // existence guard covers
                if (!candidates.has(tsArity)) {
                    problems.push(`${reg.name} (${file}): TS declares ${tsArity} params, C++ has ${sorted(
                        [...candidates].map(String),
                    ).join('/')}`);
                }
            }
        }
        expect(problems, problems.join('\n')).toEqual([]);
    });

    it('CppResourceManager parameter counts match (embind drops the instance param)', () => {
        const chain = parseClassRegistration(webSdkEntry, 'ResourceManager');
        const ts = parseInterfaceMethodSigs(wasmTs, 'CppResourceManager');
        const problems: string[] = [];
        for (const [name, sym] of chain) {
            const tsArity = ts.get(name);
            if (tsArity == null) continue;
            const candidates = cppArities(pooledModuleCpp, sym);
            if (candidates.size === 0) {
                problems.push(`${name}: no C++ prototype found for '${sym}'`);
            } else if (![...candidates].some((c) => c - 1 === tsArity)) {
                problems.push(`${name}: TS declares ${tsArity} params, C++ has ${sorted(
                    [...candidates].map((c) => String(c - 1)),
                ).join('/')} after the instance param`);
            }
        }
        expect(problems, problems.join('\n')).toEqual([]);
    });

    it('physics: parameter counts match', () => {
        const cpp = new Map(
            ['PhysicsModuleEntry.cpp', 'PhysicsShapes.cpp', 'PhysicsJoints.cpp', 'PhysicsQueries.cpp']
                .flatMap((f) => [...parseKeepaliveSigs(read(resolve(CPP, 'bindings', f)))]),
        );
        const ts = parseInterfaceMethodSigs(read(resolve(SDK, 'physics/PhysicsModuleLoader.ts')), 'PhysicsWasmModule');
        expectArities('physics', ts, cpp);
    });

    it('spine: raw members and the cwrap table both match', () => {
        const loaderTs = read(resolve(SDK, 'spine/SpineModuleLoader.ts'));
        const cpp = parseKeepaliveSigs(read(resolve(CPP, 'bindings/SpineModuleEntry.cpp')));
        expectArities('spine raw members', parseInterfaceMethodSigs(loaderTs, 'SpineWasmModule'), cpp);
        expectArities('spine cwrap table', parseCwrapSigs(loaderTs), cpp);
    });

    it('basis: parameter counts match', () => {
        const src = stripComments(read(resolve(CPP, 'bindings/BasisModuleEntry.cpp')));
        const ts = parseInterfaceMethodSigs(read(resolve(SDK, 'asset/basisTranscoder.ts')), 'BasisWasmModule');
        const problems: string[] = [];
        for (const [name, tsArity] of ts) {
            if (SIDE_RUNTIME.has(name)) continue;
            const candidates = cppArities(src, name.replace(/^_/, ''));
            if (candidates.size === 0) problems.push(`${name}: no C++ definition found`);
            else if (!candidates.has(tsArity)) {
                problems.push(`${name}: TS declares ${tsArity} params, C++ has ${sorted([...candidates].map(String)).join('/')}`);
            }
        }
        expect(problems, problems.join('\n')).toEqual([]);
    });
});
