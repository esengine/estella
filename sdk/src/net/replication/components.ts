// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    components.ts
 * @brief   The replication marker components. `Replicated` is the authoring
 *          surface: put it on a server entity and the entity replicates —
 *          which fields flow is declared per component (`replicated`
 *          annotations / metadata), not here. `NetGhost` tags the client-side
 *          proxies so local simulation (physics, AI) can yield to the incoming
 *          authoritative state via Without(NetGhost) queries.
 *
 * @beta   Pre-1.0 networking: client prediction will reshape this surface.
 */
import { defineComponent, defineTag } from '../../component';

export interface ReplicatedData {
    /** Stable network identity, allocated by the server (0 = unassigned). */
    netId: number;
    /** Owning connection id (0 = the server) — input/authority routing (N4). */
    owner: number;
}

export const Replicated = defineComponent<ReplicatedData>('Replicated', {
    netId: 0,
    owner: 0,
});

/** Client-side proxy of a server entity: state arrives over the wire. */
export const NetGhost = defineTag('NetGhost');

/**
 * Re-register after a user-component registry reset (project reload wipes the
 * per-context catalogue; the interned-by-name _id keeps old const handles and
 * fresh registrations pointing at the same storage). ReplicationPlugin.build
 * calls this, so any app built after a reset still serializes these.
 */
export function ensureReplicationComponentsRegistered(): void {
    defineComponent<ReplicatedData>('Replicated', { netId: 0, owner: 0 });
    defineTag('NetGhost');
}
