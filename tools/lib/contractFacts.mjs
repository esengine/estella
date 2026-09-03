// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  contractFacts.mjs — the runtime contract facts, declared.
 *
 * A fact is something the engine and something else must agree about or one of
 * them reads the wrong bytes. This file says, for each: who AUTHORS it, what is
 * PROJECTED from it, what independently VERIFIES it, and whether a digest
 * covers it. `contract-inventory.mjs` holds every claim here against the tree.
 *
 * The three roles are kept apart on purpose. An authority owns the fact; a
 * projection derives it into another representation; a verification decides
 * INDEPENDENTLY whether the two agree. Folding verification into the authority
 * graph is how a green build stops meaning anything — a schema asking a
 * generator whether it generated the schema. So a verification may never name a
 * file that is also a projection of the same fact, and the checker refuses one.
 *
 * `probe` is what makes this different from a list somebody remembers: the fact
 * has to still be findable where the entry says it is, or the entry is a
 * finding rather than documentation.
 *
 * An author's `kind` is `semantic` (owns what the fact IS — more than one is
 * drift waiting) or `implementation` (a second realisation of a fact specified
 * elsewhere). Two implementations plus a differential is STRONGER than
 * generating one from the other: same-source generation proves both inherited
 * one implementation, an independent pair proves both satisfy the contract.
 *
 * `owed` states a gap in prose so it reads as work; `owedUntil: 'digest'` says
 * MACHINE-READABLY what would close it, so the gate reports the debt as paid
 * rather than leaving a sentence that has stopped being true.
 *
 * A verification's `how` is `compiler` (the build fails), `handshake` (the two
 * sides compare at run time and refuse), `test` (a suite parses the other side
 * and asserts), or `independent-source` (a list written from the spec, not
 * derived from the thing it checks — never collapse one of those into an
 * authority).
 */

export const FACTS = [
    {
        id: 'componentShapes',
        what: 'Every field of every engine component, and the offset its C++ struct puts it at.',
        surface: 'runtime-wasm-abi',
        authors: [
            { path: 'src/esengine/ecs/components', dir: true, probe: /ES_COMPONENT/, kind: 'semantic' },
        ],
        projections: [
            'sdk/src/wasm/ptrLayouts.generated.ts',
            'sdk/src/wasm/wasm.generated.ts',
            'sdk/src/ecs/component.generated.ts',
            'sdk/src/ecs/bridge/ptrAccessors.generated.ts',
            'sdk/src/ecs/bridge/nativeEngineApi.generated.ts',
            'sdk/esengine.d.ts',
            'src/esengine/bindings/WebBindings.generated.cpp',
            'src/esengine/bindings/EditorAPI.generated.cpp',
            'src/esengine/aot/AotComponents.generated.hpp',
            'src/esengine/aot/AotComponents.generated.cpp',
            'docs/astro/src/data/components.generated.json',
        ],
        verification: [
            { path: 'sdk/src/ecs/bridge/BuiltinBridge.ts', how: 'handshake', probe: /ABI_LAYOUT_HASH/ },
            { path: 'tools/check-native-components.mjs', how: 'test', probe: /PTR_ACCESSORS/ },
            { path: 'tools/check-component-fields.mjs', how: 'test', probe: /a declared field has a reader/ },
        ],
        digest: { name: 'eht-abi-layout-hash', path: 'sdk/src/ecs/component.generated.ts', probe: /ABI_LAYOUT_HASH/ },
    },
    {
        id: 'abiStructs',
        what: 'The word width of every struct a compiled system is handed by address.',
        surface: 'runtime-aot-abi',
        authors: [
            { path: 'sdk/src/ecs/aot/abiDigest.ts', probe: /export const SYSCTX_WORDS/, kind: 'semantic' },
        ],
        projections: [
            'src/esengine/aot/estella_abi.h',
            'src/esengine/aot/EngineDigest.generated.h',
        ],
        verification: [
            { path: 'compiler/tests/abi-structs.test.ts', how: 'test', probe: /refuses a field appended/ },
        ],
        digest: { name: 'engine-abi', path: 'sdk/src/ecs/aot/abiDigest.ts', probe: /sysctx=/ },
    },
    {
        id: 'commandRecords',
        what: 'What a compiled system may ask the host to do, as a kind number in a four-word record.',
        surface: 'runtime-aot-abi',
        authors: [
            { path: 'sdk/src/ecs/aot/abiDigest.ts', probe: /export const CMD_DESPAWN/, kind: 'semantic' },
        ],
        projections: ['src/esengine/aot/estella_abi.h'],
        verification: [
            { path: 'compiler/tests/abi-structs.test.ts', how: 'test', probe: /es_check_cmd/ },
        ],
        digest: { name: 'engine-abi', path: 'sdk/src/ecs/aot/abiDigest.ts', probe: /cmdkinds=/ },
    },
    {
        id: 'resourceShapes',
        what: 'The built-in resources a compiled system can read: their members, and which method reads which bit set.',
        surface: 'runtime-aot-abi',
        authors: [
            { path: 'sdk/src/ecs/resourceShapes.ts', probe: /export const RESOURCE_SHAPES/, kind: 'semantic' },
        ],
        projections: [],
        verification: [
            { path: 'sdk/tests/resource-shape.test.ts', how: 'test', probe: /engineAbiParts/ },
        ],
        digest: { name: 'engine-abi', path: 'sdk/src/ecs/aot/abiDigest.ts', probe: /RESOURCE_NAMES/ },
    },
    {
        id: 'aotFixtureModule',
        what: 'One compiled system, checked in so the C++ harness builds without running the compiler.',
        surface: 'internal',
        authors: [
            { path: 'compiler/src/codegen.ts', probe: /export function emitC/, kind: 'semantic' },
        ],
        projections: [
            'tests/aot/generated/estella_offsets.h',
            'tests/aot/generated/move_system.c',
            'tests/aot/generated/move_system_decl.c',
            'tests/aot/generated/move_system_hash.h',
        ],
        verification: [
            { path: 'compiler/tests/generated.test.ts', how: 'test', probe: /ESTELLA_AOT_WRITE/ },
        ],
        digest: { name: 'engine-abi', path: 'tests/aot/generated/move_system_hash.h', probe: /ES_EXPECTED_CONTRACT_HASH/ },
    },
    {
        id: 'entityRepresentation',
        what: 'How an entity handle packs an index and a generation into one u32.',
        surface: 'runtime-wasm-abi',
        authors: [
            { path: 'src/esengine/core/Types.hpp', probe: /using Layout = PackedId</, kind: 'semantic' },
        ],
        projections: ['sdk/src/wasm/entityLayout.generated.ts'],
        verification: [
            // A SECOND reader of the same header: its own regex against EHT's
            // parser. Not the projection checking itself — two code paths.
            { path: 'sdk/tests/cpp-contract.test.ts', how: 'test', probe: /packed Entity bit split/ },
        ],
        digest: { name: 'eht-abi-layout-hash', path: 'tools/eht/abi.py', probe: /ENTITY index=/ },
    },
    {
        id: 'mathPolicy',
        what: 'The numeric subset a compiled system may use, specified to the bit because ECMAScript does not specify trigonometry.',
        surface: 'runtime-aot-abi',
        // Two implementations of the ALGORITHM over one author for the fifteen
        // constants, which the C half is written from: retyping a coefficient
        // is a copy that drifts, not a second implementation of anything.
        authors: [
            { path: 'sdk/src/math/exact.ts', probe: /function kernelSin/, kind: 'implementation' },
            { path: 'compiler/src/codegen.ts', probe: /es_kernel_sin/, kind: 'implementation' },
        ],
        projections: ['src/esengine/aot/estella_abi.h'],
        verification: [
            { path: 'compiler/tests/exact-trig.test.ts', how: 'test', probe: /bit for bit/i },
            // The half that needs no compiler: every constant the C half emits
            // is the author's, in the author's order.
            { path: 'compiler/tests/exact-trig.test.ts', how: 'test', probe: /authored order/ },
            // A differential that did not run is not a verification: the suite
            // proves the machine can compile, or the run declares it cannot.
            { path: 'compiler/tests/globalSetup.ts', how: 'test', probe: /proveHostCC\(/ },
        ],
        digest: { name: 'engine-abi', path: 'sdk/src/ecs/aot/abiDigest.ts', probe: /trig=/ },
    },
    {
        id: 'tweenWireEnums',
        what: 'The tween easing/state/loop/target enums, which cross the boundary as bare numbers.',
        surface: 'runtime-wasm-abi',
        authors: [
            { path: 'src/esengine/animation/TweenData.hpp', probe: /ES_ENUM\(stability=/, kind: 'semantic' },
        ],
        projections: ['sdk/src/wasm/wasm.generated.ts'],
        verification: [
            { path: 'sdk/tests/cpp-contract.test.ts', how: 'test', probe: /animation tween enums/ },
            { path: 'tools/check-enum-twins.mjs', how: 'test', probe: /owes a pin/ },
        ],
        digest: { name: 'eht-abi-layout-hash', path: 'tools/eht/abi.py', probe: /ENUM \{enum\.name\}/ },
    },
    {
        id: 'particleColorLut',
        what: 'How many entries the particle colour lookup table has, which is its stride on both sides.',
        surface: 'runtime-wasm-abi',
        authors: [
            { path: 'src/esengine/particle/ParticleSystem.hpp', probe: /ES_CONST\(ts=GRADIENT_LUT_SIZE\)/, kind: 'semantic' },
        ],
        projections: ['sdk/src/wasm/constants.generated.ts'],
        verification: [
            { path: 'sdk/tests/cpp-contract.test.ts', how: 'test', probe: /particle color LUT/ },
        ],
        digest: { name: 'eht-abi-layout-hash', path: 'tools/eht/constants.py', probe: /CONST / },
    },
    {
        id: 'tilemapCellEncoding',
        what: 'Which bits of a tile word are the id and which are the three flip flags.',
        surface: 'project-asset-format',
        authors: [
            { path: 'src/esengine/tilemap/TilemapSystem.hpp', probe: /ES_CONST\(hex\)/, kind: 'semantic' },
        ],
        projections: ['sdk/src/wasm/constants.generated.ts'],
        verification: [
            { path: 'sdk/tests/cpp-contract.test.ts', how: 'test', probe: /tilemap cell encoding/ },
        ],
        digest: { name: 'eht-abi-layout-hash', path: 'tools/eht/constants.py', probe: /CONST /},
    },
    {
        id: 'tilemapBlobFormat',
        what: 'The saved form of a painted map, and the cell encoding it says it was painted under.',
        surface: 'project-asset-format',
        // A saved map outlives both halves the ABI hash pairs, so it carries the
        // encoding it was painted under and a reader whose own differs refuses
        // it. The frozen `V1_*` values are what the older magic MEANT.
        authors: [
            { path: 'src/esengine/tilemap/ChunkBlob.hpp', probe: /BLOB_MAGIC_V2/, kind: 'semantic' },
        ],
        projections: ['sdk/src/wasm/constants.generated.ts'],
        verification: [
            { path: 'tests/tilemap/test_tilemap.cpp', how: 'test', probe: /tilemap_blob_header/ },
            { path: 'sdk/tests/chunk-blob.test.ts', how: 'test', probe: /refuses a map painted/ },
        ],
        digest: { name: 'eht-abi-layout-hash', path: 'tools/eht/constants.py', probe: /CONST /},
    },
    {
        id: 'uiBaseLayer',
        what: 'The layer number UI elements draw from, which orders them against the world.',
        surface: 'runtime-wasm-abi',
        authors: [
            { path: 'src/esengine/renderer/plugins/UIElementPlugin.hpp', probe: /Layer/i, kind: 'semantic' },
        ],
        projections: [],
        verification: [
            { path: 'sdk/tests/cpp-contract.test.ts', how: 'test', probe: /UI base layer/ },
        ],
        digest: null,
    },
    {
        id: 'shaderSources',
        what: 'The engine shaders, and the WGSL twin each one needs to reach the second backend.',
        surface: 'internal',
        authors: [
            { path: 'src/esengine/data/shaders', dir: true, probe: /#pragma shader/, kind: 'semantic' },
        ],
        projections: ['src/esengine/renderer/rhi/ShaderEmbeds.generated.hpp'],
        verification: [
            { path: 'tools/check-wgsl-twin.mjs', how: 'test', probe: /fragment stage/ },
            { path: 'tools/check-shader-blocks.mjs', how: 'test', probe: /shader/i },
        ],
        digest: null,
    },
    {
        id: 'apiTiers',
        what: 'The stability tier every exported SDK symbol carries, and what that tier promises.',
        surface: 'sdk-api',
        authors: [
            { path: 'sdk/src', dir: true, probe: /@public/, kind: 'semantic' },
        ],
        projections: ['docs/astro/src/data/apiStability.generated.json'],
        verification: [
            { path: 'tools/api-surface.mjs', how: 'test', probe: /check-baseline/ },
            { path: 'tools/check-freeze-bar.mjs', how: 'test', probe: /public/i },
        ],
        digest: null,
    },
    {
        id: 'uiWidgetPrefabs',
        what: 'The built-in UI widgets, as prefab data the SDK ships rather than reads from disk.',
        surface: 'sdk-api',
        authors: [
            { path: 'sdk/src/ui/widgets/prefabs', dir: true, probe: /"version"/, kind: 'semantic' },
        ],
        projections: ['sdk/src/ui/widgets/prefabs/generated.ts'],
        verification: [
            { path: 'sdk/tests/ui-widget-prefabs.gen.test.ts', how: 'test', probe: /prefab/i },
        ],
        digest: null,
    },
];

/**
 * Generated artifacts that are NOT a projection of a contract fact, and why.
 * Being generated is not the same as being derived from a contract: a measured
 * baseline records what a machine did, and pinning it to an authority would
 * claim a fact the number does not carry.
 */
export const NOT_CONTRACT = {
    'sdk/etc/perf.snapshot.json':
        'a measured baseline, not a derivation — accepted with `perf-guard --update`.',
};
