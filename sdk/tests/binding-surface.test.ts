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
import ts from 'typescript';
import {
    DISPOSITIONS, TEST_PROBE_BINDINGS, PROBE_GUARD, PROBE_HEADER,
    type TestProbeBinding,
} from '../../tools/bindingDispositions.mjs';

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

/**
 * Registration names inside `#ifdef <macro>` … `#endif` blocks. What keeps a
 * probe out of a release build is the guard, so a census row claiming one is
 * checked against the preprocessor rather than against its own say-so.
 */
function parseGuardedRegistrations(cppSource: string, macro: string): Set<string> {
    const src = stripComments(cppSource);
    const out = new Set<string>();
    const re = new RegExp(`#if(?:def)?\\s+${macro}\\b([\\s\\S]*?)#endif`, 'g');
    for (let m = re.exec(src); m; m = re.exec(src)) {
        for (const name of parseFunctionRegistrations(m[1])) out.add(name);
    }
    return out;
}

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
    const chain = src.slice(head, end).replace(/ES_RENDER_BIND\((\w+)\)/g, '&$1');
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
        // Not the portability fallback (`#define EMSCRIPTEN_KEEPALIVE` for a native
        // build, where the attribute has no meaning) — that is not an export, and
        // reading past it would attribute the next function in the file to it.
        const lineStart = src.lastIndexOf('\n', m.index) + 1;
        if (src.slice(lineStart, m.index).trimStart().startsWith('#define')) continue;
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

const bindingFiles = {
    wasm: 'wasm.ts',
    tiles: 'tilemap/tilemapAPI.ts',
    physics: 'physics/PhysicsModuleLoader.ts',
    spine: 'spine/SpineModuleLoader.ts',
    dragonBones: 'dragonbones/DragonBonesModuleLoader.ts',
    basis: 'asset/basisTranscoder.ts',
} as const;
const program = ts.createProgram(Object.values(bindingFiles).map(file => resolve(SDK, file)), {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, types: [],
});
const checker = program.getTypeChecker();

/** Follow inherited and mapped members. A bound registry can prepend a fixed-length rest tuple. */
function methodSignatures(file: keyof typeof bindingFiles, name: string): Map<string, number> {
    const source = program.getSourceFile(resolve(SDK, bindingFiles[file]));
    const declaration = source?.statements.find(node =>
        (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name.text === name);
    if (!declaration) throw new Error(`TS binding type '${name}' missing from ${bindingFiles[file]}`);

    const methods = new Map<string, number>();
    for (const member of checker.getTypeAtLocation(declaration).getProperties()) {
        const type = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(member, declaration));
        const signature = type.getCallSignatures()[0];
        if (!signature) continue;
        let arity = 0;
        for (const parameter of signature.getParameters()) {
            const node = parameter.valueDeclaration;
            const paramType = checker.getTypeOfSymbolAtLocation(parameter, declaration);
            arity += node && ts.isParameter(node) && node.dotDotDotToken && checker.isTupleType(paramType)
                ? checker.getTypeArguments(paramType as ts.TypeReference).length : 1;
        }
        methods.set(member.name, arity);
    }
    return methods;
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

const moduleSigs = methodSignatures('wasm', 'ESEngineModule');
const tilemapSigs = methodSignatures('tiles', 'TilemapModule');
const moduleDeclared = new Set(moduleSigs.keys());
const tilemapDeclared = new Set(tilemapSigs.keys());
const allDeclared = new Set([...moduleDeclared, ...tilemapDeclared]);

// Emscripten-runtime exports declared for ergonomics; not embind registrations.
const RUNTIME_EXPORTS = new Set(['_malloc', '_free']);

/** The census: which registrations are deliberately not production. */
const probeDeclared = new Set<string>(TEST_PROBE_BINDINGS.map((b: TestProbeBinding) => b.id));
const probeGuarded = parseGuardedRegistrations(webSdkEntry, PROBE_GUARD);

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
        // Minus the ones a census declares are not production. `production` is the
        // default, so an unlisted binding is still held to the strict rule.
        const production = [...handRegistered].filter((n) => !probeDeclared.has(n));
        const unmirrored = missingFrom(production, allDeclared);
        expect(unmirrored, `registered in WebSDKEntry/TilemapBindings but declared in no TS interface`
            + ` (and not declared a test-probe in tools/bindingDispositions.mjs): ${unmirrored.join(', ')}`)
            .toEqual([]);
    });

    it('a test-probe binding stays OUT of the production TS surface', () => {
        const leaked = [...probeDeclared].filter((n) => allDeclared.has(n));
        expect(leaked, `declared test-probe in tools/bindingDispositions.mjs but present in the`
            + ` shipping TS surface, which is a release ABI: ${leaked.join(', ')}`)
            .toEqual([]);
    });

    it('a test-probe binding is registered behind the probe guard', () => {
        const unguarded = [...probeDeclared].filter((n) => !probeGuarded.has(n));
        expect(unguarded, `declared test-probe but registered outside #ifdef ${PROBE_GUARD},`
            + ` so a release build would export it: ${unguarded.join(', ')}`)
            .toEqual([]);
    });

    it('a test-probe binding is declared in the probe-only header', () => {
        const probeHeader = read(resolve(CPP, PROBE_HEADER));
        const misplaced = [...probeDeclared].filter((n) => !new RegExp(`\\b${n}\\s*\\(`).test(probeHeader));
        expect(misplaced, `declared test-probe but not declared in ${PROBE_HEADER} — the header`
            + ` tool reads the shipping ones and does not read #ifdef: ${misplaced.join(', ')}`)
            .toEqual([]);
    });

    it('every declared test-probe still exists (no stale disposition)', () => {
        const gone = [...probeDeclared].filter((n) => !handRegistered.has(n));
        expect(gone, `declared test-probe in tools/bindingDispositions.mjs but registered nowhere;`
            + ` a disposition outliving its binding reads as an answered question: ${gone.join(', ')}`)
            .toEqual([]);
    });

    it('every disposition class the census uses is one this contract defines', () => {
        const classes = Object.keys(DISPOSITIONS);
        expect(classes, 'the census must define production and test-probe')
            .toEqual(expect.arrayContaining(['production', 'test-probe']));
        const unexplained = TEST_PROBE_BINDINGS.filter((b: TestProbeBinding) => !b.why);
        expect(unexplained.map((b: TestProbeBinding) => b.id), 'a test-probe row owes a `why`')
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
            PHYSICS_TUS.flatMap((f) => [...parseKeepaliveExports(read(resolve(CPP, 'bindings/modules/physics', f)))]),
        );
        const ts = new Set(methodSignatures('physics', 'PhysicsWasmModule').keys());
        expectMirrored('physics', ts, cpp);
    });

    // The native half of the same surface. A device reaches physics through QuickJS
    // wrappers EHT generates from PhysicsBindings.hpp, so a declaration missing there
    // is an entry point the device silently does not answer — and one that exists
    // there but nowhere else is a wrapper that will not link.
    it('PhysicsBindings.hpp declares exactly what the module exports', () => {
        const header = stripComments(read(resolve(CPP, 'bindings/modules/physics/PhysicsBindings.hpp')));
        const declared = new Set([...header.matchAll(/\b(physics_\w+)\s*\(/g)].map((m) => m[1]!));
        const exported = new Set([...PHYSICS_TUS, 'PhysicsReadback.cpp']
            .flatMap((f) => [...parseKeepaliveExports(read(resolve(CPP, 'bindings/modules/physics', f)))]));
        const undeclared = [...exported].filter((n) => !declared.has(n)).sort();
        const phantom = [...declared].filter((n) => !exported.has(n)).sort();
        expect(undeclared, `exported but not declared in PhysicsBindings.hpp (no native wrapper): ${undeclared.join(', ')}`)
            .toEqual([]);
        expect(phantom, `declared in PhysicsBindings.hpp but defined nowhere: ${phantom.join(', ')}`)
            .toEqual([]);
    });

    // The device build reads this list to generate its QuickJS wrappers, and it is
    // the only consumer — so a header that moves takes ~17 minutes of Dawn build to
    // report itself, at release time, on the one workflow that compiles for a phone.
    // v0.36.0's release failed exactly here, four headers behind a reorganisation.
    it('every binding header the native build lists is where it says it is', async () => {
        const { NATIVE_BINDING_HEADERS } = await import('../../build-tools/tasks/native.js');
        const missing = (NATIVE_BINDING_HEADERS as string[])
            .filter((h) => !existsSync(resolve(CPP, 'bindings', h)));
        expect(missing, `listed in build-tools/tasks/native.js but absent: ${missing.join(', ')}`)
            .toEqual([]);
    });

    // Exported for the NATIVE side only, so no SDK caller names them: which spine
    // runtime a host linked (the web names the artifact instead — spine38 / 41 / 42)
    // and how much the event buffer published, which a native wrapper needs to copy
    // the readback into the caller's heap. See SpineBindings.hpp.
    const SPINE_NATIVE_ONLY = new Set(['spine_runtimeVersion', 'spine_eventBufferBytes']);

    it('SpineWasmModule + its cwrap table mirror the spine module exports exactly', () => {
        const cpp = new Set(
            [...parseKeepaliveExports(read(resolve(CPP, 'bindings/modules/spine/SpineModuleEntry.cpp')))]
                .filter((n) => !SPINE_NATIVE_ONLY.has(n)),
        );
        const loaderTs = read(resolve(SDK, 'spine/SpineModuleLoader.ts'));
        const declared = new Set([
            ...methodSignatures('spine', 'SpineWasmModule').keys(),
            ...[...parseCwrapNames(loaderTs)].map((n) => `_${n}`),
        ]);
        expectMirrored('spine', declared, cpp);
    });

    // The native half, as for physics: a device reaches spine through wrappers EHT
    // generates from SpineBindings.hpp, so a declaration missing there is an entry
    // point the device does not answer, and one with no definition is a wrapper that
    // will not link.
    it('SpineBindings.hpp declares exactly what the module exports', () => {
        const header = stripComments(read(resolve(CPP, 'bindings/modules/spine/SpineBindings.hpp')));
        const declared = new Set([...header.matchAll(/\b(spine_\w+)\s*\(/g)].map((m) => m[1]!));
        const exported = new Set(
            [...parseKeepaliveExports(read(resolve(CPP, 'bindings/modules/spine/SpineModuleEntry.cpp')))]
                .filter((n) => n.startsWith('spine_')),
        );
        const undeclared = [...exported].filter((n) => !declared.has(n)).sort();
        const phantom = [...declared].filter((n) => !exported.has(n)).sort();
        expect(undeclared, `exported but not declared in SpineBindings.hpp: ${undeclared.join(', ')}`)
            .toEqual([]);
        expect(phantom, `declared in SpineBindings.hpp but defined nowhere: ${phantom.join(', ')}`)
            .toEqual([]);
    });

    // Read off the WRAPPED interface rather than the cwrap call sites, because this
    // loader binds through `w('loadSkeleton', …)` and lets the helper add the `db_`
    // — there is no `cwrap('db_loadSkeleton')` literal to find. The interface is a
    // faithful stand-in for the table: tsc rejects a member with no `w(…)` behind it
    // and a `w(…)` with no member, so the two cannot drift.
    it('DragonBonesWrappedAPI mirrors the module exports exactly', () => {
        const cpp = parseKeepaliveExports(read(resolve(CPP, 'bindings/modules/dragonbones/DragonBonesModuleEntry.cpp')));
        const declared = new Set(
            [...methodSignatures('dragonBones', 'DragonBonesWrappedAPI').keys()].map((n) => `_db_${n}`),
        );
        expectMirrored('dragonbones', declared, cpp);
    });

    // The native half, as for physics and spine. This one has already been the bug
    // it guards: the module was linked into the Android host and unreachable from
    // it, because the ABI lived only in the .cpp and the generator had nothing to
    // read. A declaration missing here is an entry point a device does not answer.
    it('DragonBonesBindings.hpp declares exactly what the module exports', () => {
        const header = stripComments(read(resolve(CPP, 'bindings/modules/dragonbones/DragonBonesBindings.hpp')));
        const declared = new Set([...header.matchAll(/\b(db_\w+)\s*\(/g)].map((m) => m[1]!));
        const exported = new Set(
            [...parseKeepaliveExports(read(resolve(CPP, 'bindings/modules/dragonbones/DragonBonesModuleEntry.cpp')))]
                .filter((n) => n.startsWith('db_')),
        );
        const undeclared = [...exported].filter((n) => !declared.has(n)).sort();
        const phantom = [...declared].filter((n) => !exported.has(n)).sort();
        expect(undeclared, `exported but not declared in DragonBonesBindings.hpp: ${undeclared.join(', ')}`)
            .toEqual([]);
        expect(phantom, `declared in DragonBonesBindings.hpp but defined nowhere: ${phantom.join(', ')}`)
            .toEqual([]);
    });

    it('BasisWasmModule mirrors the basis EXPORTED_FUNCTIONS list exactly', () => {
        const cmake = read(resolve(CPP, '../../cmake/Emscripten.cmake'));
        const exported = parseExportedFunctions(cmake, 'es_basis');
        exported.delete('_malloc');
        exported.delete('_free');
        const ts = new Set(
            [...methodSignatures('basis', 'BasisWasmModule').keys()]
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
        const ts = new Set(methodSignatures('wasm', 'CppResourceManager').keys());
        // Native (embedded-Dawn) byte-upload methods: no wasm heap to marshal into,
        // so they take the RGBA bytes directly and have NO embind counterpart on the
        // web ResourceManager. Optional + native-only by construction — exempt from
        // the web mirror the way embind's implicit `delete` is below.
        ts.delete('createTextureFromBytes');
        ts.delete('createTextureArrayFromBytes');
        ts.delete('updateTextureSubregionFromBytes');
        ts.delete('createTextureFromKTX2');   // KTX2 transcode lives in the native host, not embind
        expect(sorted(ts)).toEqual(sorted(cpp.keys()));
    });

    it('CppEngineContext mirrors class_<EstellaContext> exactly (embind-implicit delete aside)', () => {
        const cpp = parseClassRegistration(webSdkEntry, 'EstellaContext');
        const ts = new Set(methodSignatures('wasm', 'CppEngineContext').keys());
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
    'bindings/MaterialBindings.hpp',
    'bindings/MaterialBindings.cpp',
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
        expect(moduleSigs.get('draw_line')).toBe(9);
        expect(moduleSigs.get('renderer_end')).toBe(0);
        expect(moduleSigs.get('tilemap_setTileInWorld')).toBe(5);
        expect(tilemapSigs.get('tilemap_setTile')).toBe(4);
        expect(cppArities(pooledModuleCpp, 'draw_line')).toContain(9);
        expect(parseKeepaliveSigs(read(resolve(CPP, 'bindings/modules/physics/PhysicsModuleEntry.cpp'))).get('physics_step')).toBe(1);
        expect(parseCwrapSigs(read(resolve(SDK, 'spine/SpineModuleLoader.ts'))).get('spine_setSkin')).toBe(2);
    });

    it('every hand-registered module function has a matching TS parameter count', () => {
        const regs = [
            ...parseRegistrationTargets(webSdkEntry),
            ...parseRegistrationTargets(tilemapBindings),
        ];
        const declarations = [
            ['wasm.ts', moduleSigs],
            ['tilemapAPI.ts', tilemapSigs],
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

    it('matches every registered tilemap operation to its C++ prototype, including the registry parameter', () => {
        const header = stripComments(read(resolve(CPP, 'bindings/TilemapBindings.hpp')));
        for (const name of handRegistered) {
            if (!name.startsWith('tilemap_')) continue;
            expect(cppArities(header, name), name).toEqual(new Set([moduleSigs.get(name)]));
        }
    });

    it('CppResourceManager parameter counts match (embind drops the instance param)', () => {
        const chain = parseClassRegistration(webSdkEntry, 'ResourceManager');
        const ts = methodSignatures('wasm', 'CppResourceManager');
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
                .flatMap((f) => [...parseKeepaliveSigs(read(resolve(CPP, 'bindings/modules/physics', f)))]),
        );
        const ts = methodSignatures('physics', 'PhysicsWasmModule');
        expectArities('physics', ts, cpp);
    });

    it('spine: raw members and the cwrap table both match', () => {
        const loaderTs = read(resolve(SDK, 'spine/SpineModuleLoader.ts'));
        const cpp = parseKeepaliveSigs(read(resolve(CPP, 'bindings/modules/spine/SpineModuleEntry.cpp')));
        expectArities('spine raw members', methodSignatures('spine', 'SpineWasmModule'), cpp);
        expectArities('spine cwrap table', parseCwrapSigs(loaderTs), cpp);
    });

    it('basis: parameter counts match', () => {
        const src = stripComments(read(resolve(CPP, 'bindings/modules/basis/BasisModuleEntry.cpp')));
        const ts = methodSignatures('basis', 'BasisWasmModule');
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
