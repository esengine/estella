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
 * Method names of one `emscripten::class_<T>("Name")` registration chain:
 * every `.function("name", ...)` between the class_ head and the chain's
 * terminating `;` (the chain itself contains no semicolons).
 */
function parseClassRegistration(cppSource: string, className: string): Set<string> {
    const src = stripComments(cppSource);
    const head = src.indexOf(`("${className}")`);
    if (head < 0) throw new Error(`embind class_ registration '${className}' not found`);
    const end = src.indexOf(';', head);
    const chain = src.slice(head, end);
    const out = new Set<string>();
    const re = /\.function\(\s*"(\w+)"/g;
    for (let m = re.exec(chain); m; m = re.exec(chain)) out.add(m[1]);
    return out;
}

/**
 * All `EMSCRIPTEN_KEEPALIVE` C-export names in a file: the identifier right
 * before the parameter list that follows each annotation.
 */
function parseKeepaliveExports(cppSource: string): Set<string> {
    const src = stripComments(cppSource);
    const out = new Set<string>();
    const re = /EMSCRIPTEN_KEEPALIVE\b/g;
    for (let m = re.exec(src); m; m = re.exec(src)) {
        const paren = src.indexOf('(', m.index);
        if (paren < 0) continue;
        const tokens = src.slice(m.index + m[0].length, paren).match(/\w+/g);
        if (!tokens?.length) throw new Error(`EMSCRIPTEN_KEEPALIVE with no function name at offset ${m.index}`);
        out.add(tokens[tokens.length - 1]);
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
 * Call-signature member names (`name(...)` / `name?(...)`) declared at the top
 * level of `interface <name> { ... }`. Property members (`HEAPU8: ...`,
 * `Registry: new () => ...`) and members of nested object types (`GL: {...}`,
 * inline return-type literals) are excluded by tracking brace depth.
 */
function parseInterfaceMethods(tsSource: string, interfaceName: string): Set<string> {
    const src = stripComments(tsSource);
    const head = new RegExp(`interface\\s+${interfaceName}\\s*\\{`).exec(src);
    if (!head) throw new Error(`TS interface '${interfaceName}' not found`);
    const out = new Set<string>();
    let depth = 1;
    const body = src.slice(head.index + head[0].length);
    for (const line of body.split('\n')) {
        if (depth === 1) {
            const m = /^\s*(\w+)\s*\??\(/.exec(line);
            if (m) out.add(m[1]);
        }
        for (const ch of line) {
            if (ch === '{') depth++;
            else if (ch === '}' && --depth === 0) return out;
        }
    }
    throw new Error(`TS interface '${interfaceName}': unterminated body`);
}

/** `cw('name', ...)` / `cwrap('name', ...)` call-site literals in a TS file. */
function parseCwrapNames(tsSource: string): Set<string> {
    const src = stripComments(tsSource);
    const out = new Set<string>();
    const re = /\bcw(?:rap)?\(\s*['"](\w+)['"]/g;
    for (let m = re.exec(src); m; m = re.exec(src)) out.add(m[1]);
    return out;
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
    it('PhysicsWasmModule mirrors the physics module exports exactly', () => {
        const cpp = new Set(
            ['PhysicsModuleEntry.cpp', 'PhysicsShapes.cpp', 'PhysicsJoints.cpp', 'PhysicsQueries.cpp']
                .flatMap((f) => [...parseKeepaliveExports(read(resolve(CPP, 'bindings', f)))]),
        );
        const ts = parseInterfaceMethods(read(resolve(SDK, 'physics/PhysicsModuleLoader.ts')), 'PhysicsWasmModule');
        expectMirrored('physics', ts, cpp);
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
        expect(sorted(ts)).toEqual(sorted(cpp));
    });

    it('CppEngineContext mirrors class_<EstellaContext> exactly (embind-implicit delete aside)', () => {
        const cpp = parseClassRegistration(webSdkEntry, 'EstellaContext');
        const ts = parseInterfaceMethods(wasmTs, 'CppEngineContext');
        ts.delete('delete'); // added by embind on every class instance, never registered
        expect(sorted(ts)).toEqual(sorted(cpp));
    });
});
