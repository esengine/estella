// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeEach, expect, it, onTestFinished } from 'vitest';
import { App } from '../src/app/app';
import { clearUserComponents, defineComponent } from '../src/ecs/component';
import { MemoryTransport } from '../src/net/MemoryTransport';
import {
    Net, Replicated, quantizeReplicatedFields, registerReplicationArchetype, replicationPlugin,
    type ReplicationClientOptions, type ReplicationServer,
} from '../src/net/replication';
import { clearReplicationArchetypes } from '../src/net/replication/archetype';
import { ReplMsg } from '../src/net/replication/protocol';

const STEP = 1 / 60;
beforeEach(() => { clearUserComponents(); clearReplicationArchetypes(); });

function app() {
    const a = App.new();
    a.addPlugin(replicationPlugin);
    return a;
}

function host() {
    const a = app();
    const server = a.getResource(Net).startServer({ authenticate: credentials => ({ playerId: String(credentials) }) });
    onTestFinished(() => server.dispose());
    return { server, world: a.world, step: () => a.tick(STEP) };
}

async function join(server: ReplicationServer, credentials: string, options?: ReplicationClientOptions) {
    const a = app(), [link, peer] = MemoryTransport.pair();
    const messages: string[] = [];
    peer.on('message', data => {
        if (typeof data !== 'string') messages.push('state');
        else if (JSON.parse(data).t === ReplMsg.componentRemove) messages.push('remove');
    });
    const id = server.attachConnection(link);
    const client = await a.getResource(Net).connect(peer, { interpolationDelayTicks: 0, credentials, ...options });
    onTestFinished(() => client.disconnect());
    return { client, id, messages, world: a.world };
}

it.each(['immediate', 'interpolated', 'predicted'])('reconciles exactly the received components on resume (%s)', async mode => {
    const mark = defineComponent('Mark', { value: 0, tint: 'default' }, { replicatedFields: ['value'] });
    const effect = defineComponent('Effect', { power: 0 }, { replicatedFields: ['power'] });
    const added = defineComponent('Added', { target: 0 }, { entityFields: ['target'], replicatedFields: ['target'] });
    const local = defineComponent('LocalFrame', { frame: 0 }, { replicatedFields: ['frame'] });
    registerReplicationArchetype('pawn', (w, e) => {
        w.insert(e, mark, { tint: 'archetype' });
        w.insert(e, local, { frame: 3 });
    });
    const h = host();
    const { client, world, id } = await join(h.server, 'one', {
        interpolationDelayTicks: mode === 'immediate' ? 0 : 3,
        prediction: mode === 'predicted' ? { apply() {} } : undefined,
    });
    const pawn = h.world.spawn('pawn');
    h.world.insert(pawn, Replicated, { archetype: 'pawn', owner: id });
    h.world.insert(pawn, mark, { value: 10, tint: 'private' });
    h.world.insert(pawn, effect, { power: 8 });
    await h.step();
    client.applyPending();
    const ghost = world.findEntityByName('pawn')!;
    expect(world.get(ghost, mark)).toEqual({ value: 10, tint: 'archetype' });
    world.update(ghost, mark, d => { d.tint = 'custom'; });
    world.update(ghost, local, d => { d.frame = 17; });
    const target = h.world.spawn('target');
    h.world.insert(target, Replicated, {});
    h.world.insert(pawn, added, { target });
    await h.step();
    client.applyPending(); // The interpolated delta has arrived but has never been presented.
    expect(world.has(ghost, added)).toBe(mode !== 'interpolated');
    expect(world.get(ghost, local).frame).toBe(17);

    h.server.detachConnection(id);
    h.world.remove(pawn, added);
    h.world.remove(pawn, effect);
    h.world.update(pawn, mark, d => { d.value = 33; });
    await h.step();
    const [a, b] = MemoryTransport.pair();
    const resumedLink = h.server.attachConnection(a);
    await client.resume(b);
    client.applyPending();
    expect(world.findEntityByName('pawn')).toBe(ghost);
    expect(world.get(ghost, mark)).toEqual({ value: 33, tint: 'custom' });
    expect(world.get(ghost, local).frame).toBe(17);
    // Re-entering a referenced target and advancing the render clock cannot
    // revive the removed component through an old projection or buffered row.
    h.world.remove(target, Replicated);
    await h.step();
    client.applyPending();
    h.world.insert(target, Replicated, {});
    await h.step();
    client.applyPending();
    client.sampleInterpolation(10);
    expect(world.has(ghost, effect)).toBe(false);
    expect(world.has(ghost, added)).toBe(false);

    h.world.insert(pawn, effect, { power: 24 });
    await h.step();
    client.applyPending();
    client.sampleInterpolation(10);
    client.sampleInterpolation(10);
    expect(world.get(ghost, effect).power).toBe(24);
    h.world.remove(pawn, effect);
    await h.step();
    client.applyPending();
    expect(world.has(ghost, effect)).toBe(false);
    world.insert(ghost, effect, { power: 7 });
    h.server.detachConnection(resumedLink);
    const [c, d] = MemoryTransport.pair();
    h.server.attachConnection(c);
    await client.resume(d);
    client.applyPending();
    expect(world.get(ghost, effect).power).toBe(7);
});

it('enables prediction from received fields even after a local edit to a nested value', async () => {
    const pose = defineComponent('Pose', { offset: { x: 0, y: 0 } }, { replicatedFields: ['offset'] });
    const h = host();
    const { client, id, world } = await join(h.server, 'one');
    const pawn = h.world.spawn('pawn');
    h.world.insert(pawn, Replicated, { owner: id });
    h.world.insert(pawn, pose, { offset: { x: 10, y: 2 } });
    await h.step();
    client.applyPending();
    h.world.update(pawn, pose, d => { d.offset.x = 20; });
    await h.step();
    client.applyPending();
    const ghost = world.findEntityByName('pawn')!;
    world.update(ghost, pose, d => { d.offset.x = 999; });
    client.enablePrediction({ apply() {} });
    client.applyPending();
    expect(world.get(ghost, pose).offset).toEqual({ x: 20, y: 2 });
});

it.each(['broadcast', 'filtered', 'budgeted'])('converges after a join between samples (%s)', async route => {
    const kept = defineComponent('Kept', { value: 0, other: 0 }, { replicatedFields: ['value', 'other'] });
    const missing = defineComponent('Missing', { value: 0 }, { replicatedFields: ['value'] });
    const transient = defineComponent('Transient', { value: 0 }, { replicatedFields: ['value'] });
    const expired = defineComponent('Expired', { ttl: 1 }, { replicatedFields: ['ttl'] });
    const h = host();
    if (route === 'filtered') h.server.setInterestPolicy(() => 'all');
    if (route === 'budgeted') h.server.setBandwidthBudget({ bytesPerSecond: 1 });
    const early = await join(h.server, 'early');
    const actor = h.world.spawn('actor');
    h.world.insert(actor, Replicated, {});
    h.world.insert(actor, kept, { value: 2, other: 3 });
    h.world.insert(actor, missing, { value: 33 });
    h.world.insert(actor, expired, {});
    await h.step();
    early.client.applyPending();
    const earlyGhost = early.world.findEntityByName('actor')!;
    early.world.insert(earlyGhost, transient, { value: 777 });

    h.world.update(actor, kept, d => { d.value = 99; });
    h.world.remove(actor, missing);
    h.world.insert(actor, transient, { value: 44 });
    const late = await join(h.server, 'late');
    late.client.applyPending();
    const ghost = late.world.findEntityByName('actor')!;
    expect(late.world.get(ghost, kept).value).toBe(99);
    expect(late.world.has(ghost, missing)).toBe(false);
    expect(late.world.get(ghost, transient).value).toBe(44);

    // One field reverts, another needs an ordinary delta in the same row.
    h.world.update(actor, kept, d => { d.value = 2; d.other = 7; });
    h.world.insert(actor, missing, { value: 33 });
    h.world.remove(actor, transient);
    h.world.remove(actor, expired);
    await h.step();
    late.client.applyPending();
    early.client.applyPending();
    expect(late.world.get(ghost, kept)).toEqual({ value: 2, other: 7 });
    expect(late.world.get(ghost, missing).value).toBe(33);
    expect(late.world.has(ghost, transient)).toBe(false);
    expect(early.world.get(earlyGhost, transient).value).toBe(777);
    expect(early.messages).toEqual(['remove', 'state']);
    expect(late.world.has(ghost, expired)).toBe(false);
    expect(late.messages.indexOf('state')).toBeGreaterThan(late.messages.lastIndexOf('remove'));
    const count = late.messages.length;
    await h.step();
    expect(late.messages).toHaveLength(count);
});

it('meters initial corrections and retires deferred rows when an entity leaves the view', async () => {
    const value = defineComponent('Value', { x: 0 }, { replicatedFields: ['x'] });
    const h = host();
    h.server.setBandwidthBudget({ bytesPerSecond: 1, priority: () => 1 });
    await join(h.server, 'early');
    const names = ['a', 'b', 'c'];
    const actors = names.map(name => {
        const e = h.world.spawn(name);
        h.world.insert(e, Replicated, {});
        h.world.insert(e, value, { x: 1 });
        return e;
    });
    await h.step();
    for (const e of actors) h.world.update(e, value, d => { d.x = 2; });
    const late = await join(h.server, 'late');
    late.client.applyPending();
    for (const e of actors) h.world.update(e, value, d => { d.x = 1; });
    await h.step();
    late.client.applyPending();
    expect(h.server.owedCount(late.id)).toBe(2);
    const name = names.find(n => late.world.get(late.world.findEntityByName(n)!, value).x === 2)!;
    const deferred = h.world.findEntityByName(name)!;
    h.server.setInterestPolicy(({ candidates }) => new Set(candidates.filter(e => e !== deferred)));
    await h.step();
    late.client.applyPending();
    expect(late.world.findEntityByName(name)).toBeNull();
    expect(h.server.owedCount(late.id)).toBe(0);
    h.server.setInterestPolicy(null);
    await h.step();
    late.client.applyPending();
    expect(late.world.get(late.world.findEntityByName(name)!, value).x).toBe(1);
});

it('preserves a local component when the server removes an addition this client never received', async () => {
    const effect = defineComponent('Effect', { level: 0 }, { replicatedFields: ['level'] });
    const h = host();
    h.server.setBandwidthBudget({ bytesPerSecond: 1, priority: () => 1 });
    const peer = await join(h.server, 'one');
    const names = ['first', 'second'];
    const actors = names.map(name => {
        const e = h.world.spawn(name);
        h.world.insert(e, Replicated, {});
        return e;
    });
    await h.step();
    peer.client.applyPending();
    const ghosts = names.map(name => peer.world.findEntityByName(name)!);
    for (const e of ghosts) peer.world.insert(e, effect, { level: 7 });
    for (const e of actors) h.world.insert(e, effect, { level: 22 });
    await h.step();
    peer.client.applyPending();
    const sent = ghosts.filter(e => peer.world.get(e, effect).level === 22);
    const deferred = ghosts.filter(e => peer.world.get(e, effect).level === 7);
    expect(sent).toHaveLength(1);
    expect(deferred).toHaveLength(1);
    for (const e of actors) h.world.remove(e, effect);
    await h.step();
    peer.client.applyPending();
    expect(peer.world.has(sent[0]!, effect)).toBe(false);
    expect(peer.world.get(deferred[0]!, effect).level).toBe(7);
});

it('repairs only joins that saw an intermediate value in the same sample interval', async () => {
    const value = defineComponent('Value', { x: 0 }, { replicatedFields: ['x'] });
    const h = host();
    const actor = h.world.spawn('actor');
    h.world.insert(actor, Replicated, {});
    h.world.insert(actor, value, { x: 4 });
    const early = await join(h.server, 'first');
    await h.step();
    h.world.update(actor, value, d => { d.x = 50; });
    const intermediate = await join(h.server, 'second');
    h.world.update(actor, value, d => { d.x = 4; });
    const current = await join(h.server, 'third');
    await h.step();
    for (const peer of [early, intermediate, current]) {
        peer.client.applyPending();
        expect(peer.world.get(peer.world.findEntityByName('actor')!, value).x).toBe(4);
    }
    expect([early.messages, intermediate.messages, current.messages]).toEqual([[], ['state'], []]);
});

it('compares exact initial values even when both ends of a movement quantize to the same step', async () => {
    const spot = defineComponent('JoinSpot', { x: 0, y: 0 }, { replicatedFields: ['x', 'y'] });
    quantizeReplicatedFields('JoinSpot', { x: 1, y: 1 });
    onTestFinished(() => quantizeReplicatedFields('JoinSpot', {}));
    const h = host();
    const actor = h.world.spawn('actor');
    h.world.insert(actor, Replicated, {});
    h.world.insert(actor, spot, { x: 0.49, y: 0 });
    const early = await join(h.server, 'first');
    await h.step();
    h.world.update(actor, spot, d => { d.x = -0.49; d.y = -0.49; });
    const late = await join(h.server, 'second');
    late.client.applyPending();
    const ghost = late.world.findEntityByName('actor')!;
    expect(late.world.get(ghost, spot)).toEqual({ x: -0.49, y: -0.49 });
    h.world.update(actor, spot, d => { d.x = 0.49; });
    await h.step();
    late.client.applyPending();
    // The moving field receives its ordinary wire precision. The still field
    // keeps the exact spawn value, and the earlier link receives no correction.
    expect(late.world.get(ghost, spot)).toEqual({ x: 0, y: -0.49 });
    expect([early.messages, late.messages]).toEqual([[], ['state']]);
});
