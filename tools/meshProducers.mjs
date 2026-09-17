// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  meshProducers.mjs — every path that can mint a persistent MeshHandle,
 *        and what each one promises about surviving a device generation.
 *
 * A MeshHandle and the buffers behind it survive a device loss; the device
 * rebuilds the buffers. What it cannot answer for itself is where the geometry
 * comes back FROM, and only whoever minted the handle knows — so a producer says,
 * in advance, here: a source to replay, or bytes the device keeps.
 *
 * The ABSENCE of a recorded source is a fact about a handle, never a recovery
 * policy: a production mesh whose provenance went missing is a broken contract,
 * and must never be quietly downgraded into a mesh the device keeps.
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
    'host-only-retained': {
        owes: 'why',
        policy: 'HostOnly',
        means: 'the geometry exists only in the process that built it, by design;'
            + ' the device keeps its bytes and puts them back after a loss itself',
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
        class: 'host-only-retained',
        why: 'it uploads a MeshRenderer\'s INLINE payload — vertices that live in a component,'
            + ' authored by whoever built the entity, with no asset under them — and clears the'
            + ' payload afterwards, so the geometry survives nowhere else. Its only callers are'
            + ' render-host and headless (meshRenderer_makeAllResident), which use it to prove the'
            + ' resident path draws the frame the inline path draws. Verification infrastructure:'
            + ' never a production mesh, and never to be treated as one.',
    },
];
