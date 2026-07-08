// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ReplicationPlugin.ts
 * @brief   Replication as a normal plugin on the normal schedules — no second
 *          runtime (the defineBehavior/FSM/BT unification rule). The netcode
 *          shares the physics cadence: FixedPreUpdate applies received state,
 *          FixedPostUpdate samples + broadcasts. Role gating is a resource,
 *          not an environment flag: everything no-ops while NetRole stays
 *          'offline', so the plugin is safe to install unconditionally.
 */
import type { App, Plugin } from '../../app';
import { defineSystem, Schedule } from '../../system';
import { defineResource, Res, Time, type TimeData } from '../../resource';
import type { NetTransport } from '../NetChannel';
import { ReplicationServer } from './server';
import { ReplicationClient } from './client';
import { ensureReplicationComponentsRegistered } from './components';

export type NetRoleKind = 'offline' | 'server' | 'client';

export class NetSession {
    private role_: NetRoleKind = 'offline';
    private server_: ReplicationServer | null = null;
    private client_: ReplicationClient | null = null;

    constructor(private readonly app_: App) {}

    get role(): NetRoleKind {
        return this.role_;
    }

    get server(): ReplicationServer | null {
        return this.server_;
    }

    get client(): ReplicationClient | null {
        return this.client_;
    }

    /** Become the authority. Attach one transport per accepted client. */
    startServer(): ReplicationServer {
        if (this.role_ !== 'offline') throw new Error(`[repl] session already ${this.role_}`);
        this.role_ = 'server';
        this.server_ = new ReplicationServer(this.app_.world);
        return this.server_;
    }

    /** Become a replica: handshake over the given transport. */
    async connect(transport: NetTransport): Promise<ReplicationClient> {
        if (this.role_ !== 'offline') throw new Error(`[repl] session already ${this.role_}`);
        const client = new ReplicationClient(this.app_.world);
        await client.connect(transport);
        this.role_ = 'client';
        this.client_ = client;
        return client;
    }

    stop(): void {
        this.client_?.disconnect();
        this.client_ = null;
        this.server_ = null;
        this.role_ = 'offline';
    }
}

export const Net = defineResource<NetSession>(null!, 'Net');

export class ReplicationPlugin implements Plugin {
    name = 'replication';

    build(app: App): void {
        ensureReplicationComponentsRegistered();
        const session = new NetSession(app);
        app.insertResource(Net, session);

        app.addSystemToSchedule(
            Schedule.FixedPreUpdate,
            defineSystem(
                [Res(Time)],
                (_time: TimeData) => {
                    session.client?.applyPending();
                },
                { name: 'ReplicationApplySystem' },
            ),
            { runIf: () => session.role === 'client' },
        );

        app.addSystemToSchedule(
            Schedule.FixedPostUpdate,
            defineSystem(
                [Res(Time)],
                (time: TimeData) => {
                    session.server?.sample(time.fixedTick);
                },
                { name: 'ReplicationSampleSystem' },
            ),
            { runIf: () => session.role === 'server' },
        );
    }
}

export const replicationPlugin = new ReplicationPlugin();
