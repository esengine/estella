// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  replicationSupport.ts — what a build that ships replication tells the
 *        core. A call, not a file's side effect — see spine/spineSupport.ts.
 *
 * The sockets stay on `esengine`: a platform adapter builds one, and a game
 * that only talks to a server over a channel needs no replication at all.
 */
import { addEntryPlugin } from '../../runtime/entryPlugins';
import { ReplicationPlugin } from './ReplicationPlugin';

export function registerReplicationSupport(): void {
  addEntryPlugin('replication', () => new ReplicationPlugin());
}
