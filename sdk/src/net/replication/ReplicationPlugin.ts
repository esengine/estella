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
import { ReplicationClient, type ReplicationClientOptions } from './client';
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

    /** Become a replica: handshake over the given transport. The role commits
     *  SYNCHRONOUSLY — from this call on, the session never simulates as the
     *  authority, even while the handshake is still in flight. (A role that
     *  only flipped on completion let authority-gated systems run for the
     *  first few ticks of a client realm and spawn local state that then
     *  lingered beside the replicated ghosts.) A failed handshake reverts to
     *  offline. */
    async connect(transport: NetTransport, options?: ReplicationClientOptions): Promise<ReplicationClient> {
        if (this.role_ !== 'offline') throw new Error(`[repl] session already ${this.role_}`);
        const client = new ReplicationClient(this.app_.world, options);
        this.role_ = 'client';
        this.client_ = client;
        try {
            await client.connect(transport);
        } catch (err) {
            this.client_ = null;
            this.role_ = 'offline';
            throw err;
        }
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
                (time: TimeData) => {
                    session.client?.setFixedDelta(time.fixedDelta);
                    session.client?.applyPending();
                },
                { name: 'ReplicationApplySystem' },
            ),
            { runIf: () => session.role === 'client' },
        );

        // Before gameplay: dequeue each connection's input command for this
        // tick (the exactly-once contract behind tickInputOf + prediction).
        app.addSystemToSchedule(
            Schedule.FixedPreUpdate,
            defineSystem(
                [Res(Time)],
                (time: TimeData) => {
                    session.server?.beginTick(time.fixedDelta);
                },
                { name: 'ReplicationBeginTickSystem' },
            ),
            { runIf: () => session.role === 'server' },
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

        app.addSystemToSchedule(
            Schedule.PostUpdate,
            defineSystem(
                [Res(Time)],
                (time: TimeData) => {
                    session.client?.sampleInterpolation(
                        time.fixedDelta > 0 ? time.delta / time.fixedDelta : 0,
                    );
                },
                { name: 'ReplicationInterpolateSystem' },
            ),
            { runIf: () => session.role === 'client' },
        );
    }
}

export const replicationPlugin = new ReplicationPlugin();
