// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  aotDuties.mjs — what a road owes around one compiled call, declared.
 *
 * A twin replaces a closure, so everything the closure would have done to the
 * world has to be done by the road that took it. There are two roads and they
 * do not overlap in code at all — one packs rows into the engine's own memory,
 * the other tells a host in another process where they are — so a duty present
 * on one and absent on the other is not something a reader notices.
 *
 * Three were absent, and each was found by hand, months apart:
 *   - events, which faulted;
 *   - commands, where a despawn reached the C++ Registry and never the World,
 *     so the entity stayed in every query and its children kept rendering;
 *   - the CALL COUNTER, which `App.compiledSystems` publishes to answer "did a
 *     twin ever actually run" — and which the loading road never incremented,
 *     so the instrument for spotting a silent fallback read 0 on the road whose
 *     fallback is by design.
 *
 * So the roads are clocked rather than read. Every effectful call each one makes
 * is named here, as a duty both perform or as one a CAPABILITY keeps off the
 * road that cannot (`sdk/src/ecs/aot/executorCapabilities.ts`). There is no
 * third answer: a duty a road neither performs nor refuses systems for is the
 * shape all three bugs had.
 */

/**
 * `web` and `native` list the calls that PERFORM the duty on that road, or null
 * where the road does not perform it — and then `excusedBy` names the capability
 * that keeps such a system off it, which the checker holds against the model.
 */
export const DUTIES = [
    {
        id: 'row-addresses',
        what: 'the rows a query walks are reachable by the call',
        // Different owners, same duty: the wasm module shares the engine's
        // memory so this side writes the table, and a loading host packs its own
        // and is told where the script pools are.
        web: ['runtime.addresses.componentNamed', 'runtime.ctx.build'],
        native: ['world.scriptSpanOf', 'bindings.scriptRows'],
        differential: [
            { path: 'sdk/tests/aot-conformance.test.ts', probe: /twins\.trace\[f\]/ },
            { path: 'tools/verify-native-conformance.mjs', probe: /disagrees at frame/ },
        ],
    },
    {
        id: 'layout-vouched',
        what: 'an address is reused only while something says the rows have not moved',
        web: ['world.layoutEpoch'],
        native: ['world.layoutEpoch', 'world.scriptLayoutEpoch'],
        // The fixture seeds a world and never moves a row in it, so the cached
        // table is never invalidated on any road. Nothing holds the REUSE.
        owed: 'a differential whose world gains and loses rows mid-run',
    },
    {
        id: 'resource-in',
        what: 'a declared resource is at an address for exactly this call',
        web: ['runtime.addresses.resourceAt'],
        native: ['resources.addressOf', 'resources.bytesOf', 'bindings.resource'],
        // Jointly with the rows: `Res(Time)` is what moves them, so a resource
        // at the wrong address is a row that disagrees on frame 0.
        differential: [{ path: 'sdk/tests/aot-conformance.test.ts', probe: /twins\.trace\[f\]/ }],
    },
    {
        id: 'resource-write-back',
        what: 'a ResMut the call wrote lands in the world, not only in the mirror',
        web: ['runtime.addresses.resourceWriteBack'],
        native: ['resources.writeBack'],
        differential: [
            { path: 'sdk/tests/aot-conformance.test.ts', probe: /twins\.resource\[f\]/ },
            { path: 'tools/verify-native-conformance.mjs', probe: /about the resource/ },
        ],
    },
    {
        id: 'call',
        what: 'the compiled function runs',
        web: ['twin.call'],
        native: ['bindings.run'],
        differential: [{ path: 'sdk/tests/aot-conformance.test.ts', probe: /twins\.trace\[f\]/ }],
    },
    {
        id: 'call-counted',
        what: 'App.compiledSystems can tell a module that loaded from one that ran',
        web: ['runtime.systems.noteCall'],
        native: ['systems.noteCall'],
        differential: [
            { path: 'sdk/tests/aot-conformance.test.ts', probe: /twins\.calls/ },
            { path: 'tools/verify-native-conformance.mjs', probe: /were dispatched to/ },
        ],
    },
    {
        id: 'changed-ticks',
        what: 'the Changed ticks the compiled code could not leave',
        web: ['world.isChangeTracked', 'world.markChanged', 'world.queryEntities'],
        native: ['world.isChangeTracked', 'world.markChanged', 'world.queryEntities'],
        differential: [
            { path: 'sdk/tests/aot-conformance.test.ts', probe: /twins\.ticks\[f\]/ },
            { path: 'tools/verify-native-conformance.mjs', probe: /changed row\(s\) at frame/ },
        ],
    },
    {
        id: 'event-payloads-in',
        what: "this frame's payloads reach a reader as rows",
        web: ['runtime.addresses.payloadRows'],
        native: null,
        excusedBy: 'eventRead',
        owed: 'the fixture has no events and no despawn, so nothing holds the WEB road here',
    },
    {
        id: 'event-payloads-released',
        what: 'the payload blocks a call was given are handed back after it',
        web: ['runtime.addresses.releasePayloads'],
        native: null,
        excusedBy: 'eventRead',
        owed: 'the fixture has no events and no despawn, so nothing holds the WEB road here',
    },
    {
        id: 'event-records-sized',
        what: 'the record area is sized for the payloads a writer may append',
        web: ['runtime.ctx.setRecordLengths'],
        native: null,
        excusedBy: 'eventWrite',
        owed: 'the fixture has no events and no despawn, so nothing holds the WEB road here',
    },
    {
        id: 'events-out',
        what: 'what the call appended is delivered as an event',
        web: ['runtime.ctx.events', 'runtime.addresses.sendEvent'],
        native: null,
        excusedBy: 'eventWrite',
        owed: 'the fixture has no events and no despawn, so nothing holds the WEB road here',
    },
    {
        id: 'commands-out',
        what: 'a command record reaches the world the interpreter would have used',
        web: ['runtime.ctx.commands', 'world.despawn'],
        native: null,
        excusedBy: 'commands',
        owed: 'the fixture has no events and no despawn, so nothing holds the WEB road here',
    },
];

/**
 * Calls that are a road's own bookkeeping rather than a duty to the world.
 *
 * Named one by one, not matched by a pattern: "it looked internal" is how a duty
 * hides. An entry nobody makes any more is a finding, the same way a stale
 * excuse is.
 */
export const BOOKKEEPING = {
    'plans.get': 'the per-system plan cache, which only this road has',
    'plans.set': 'the per-system plan cache, which only this road has',
    'plans.clear': 'dropping the plans on reset',
    'indexByName.get': "the host's index for a system name, resolved at install",
    'running_.has': 'so the "running compiled" line is said once per system',
    'running_.add': 'so the "running compiled" line is said once per system',
};

/** The two roads, and where each one's dispatcher lives. */
export const ROADS = [
    {
        id: 'web',
        path: 'sdk/src/ecs/aot/AotDispatch.ts',
        className: 'AotDispatch',
        capabilities: 'WEB_AOT',
    },
    {
        id: 'native',
        path: 'sdk/src/ecs/aot/installNativeAot.ts',
        className: 'NativeAotDispatch',
        capabilities: 'NATIVE_AOT',
    },
];

export const CAPABILITIES_AT = 'sdk/src/ecs/aot/executorCapabilities.ts';
