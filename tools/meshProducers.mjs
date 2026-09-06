// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  meshProducers.mjs — every path that can mint a persistent MeshHandle,
 *        and what each one promises about surviving a device generation.
 *
 * A MeshHandle is a LOGICAL resource identity. The VBO, the EBO and the vertex
 * layout it points at are that identity's realization on one device generation,
 * and a lost device takes all three; recovery replaces them underneath the same
 * handle, so nothing that stored one ever hears about it.
 *
 * Which leaves the only question recovery cannot answer for itself: where does
 * the geometry come back FROM? Only whoever minted the handle knows, so only a
 * producer can say — in advance, here.
 *
 * The distinction this table exists to keep: the ABSENCE of a recorded source is
 * a fact about a handle, never a recovery policy. A production mesh whose
 * provenance went missing is a broken contract and has to be reported as one; it
 * is not, and must never be quietly downgraded into, a mesh that was never
 * recoverable. Only a producer declared `host-only-non-recoverable` below is
 * allowed to have no way back.
 */

/**
 * The one seam that adds a record to the mesh pool. Everything below reaches a
 * new MeshHandle through it — a second minting path would be a second identity
 * authority, and the census cannot see past this one.
 */
export const MINT = {
    file: 'src/esengine/resource/ResourceManager.cpp',
    header: 'src/esengine/resource/ResourceManager.hpp',
    fn: 'ResourceManager::createMesh',
    pool: 'meshes_',
};

/**
 * `source` (recoverable) and `why` (non-recoverable) are each owed: a class on
 * its own is a label, and the sentence beside it is what a later reader checks
 * the class against.
 *
 * `policy` is the same answer in the engine's own words — the MeshRecovery a
 * producer hands createMesh. Naming it here is what stops the table and the code
 * drifting into two different answers, one of which recovery would act on.
 */
export const CLASSES = {
    'asset-backed-recoverable': {
        owes: 'source',
        policy: 'SourceReplayable',
        means: 'the geometry is replayable from an asset the loader can load again;'
            + ' a handle of this class with no recorded source is a contract violation',
    },
    'host-only-non-recoverable': {
        owes: 'why',
        policy: 'HostOnly',
        means: 'the geometry exists only in the process that built it, by design;'
            + ' a device generation ends it, and no source can bring it back',
    },
};

export const MESH_PRODUCERS = [
    {
        id: 'mesh_createFromChannels',
        file: 'src/esengine/bindings/RendererBindings.cpp',
        class: 'asset-backed-recoverable',
        source: 'the .esmesh (or `builtin:` template) MeshAssetLoader decoded; Assets records'
            + ' `mesh:<handle>` → path on the load, so the file can be decoded and uploaded again',
    },
    {
        id: 'freezeMeshGeometry',
        file: 'src/esengine/bindings/RendererBindings.cpp',
        class: 'host-only-non-recoverable',
        why: 'it uploads a MeshRenderer\'s INLINE payload — vertices that live in a component,'
            + ' authored by whoever built the entity, with no asset under them — and clears the'
            + ' payload afterwards, so the geometry survives nowhere else. Its only callers are'
            + ' render-host and headless (meshRenderer_makeAllResident), which use it to prove the'
            + ' resident path draws the frame the inline path draws. Verification infrastructure:'
            + ' never a production mesh, and never to be treated as one.',
    },
];
