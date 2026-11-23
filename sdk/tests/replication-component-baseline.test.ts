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

it.each(['broadcast', 'filtered', 'budgeted'])('keeps each viewer within half a step after an exact spawn (%s)', async route => {
    const spot = defineComponent('ExactSpot', { at: { x: 0, y: 0, z: 0 }, weight: 0, name: '' },
        { replicatedFields: ['at', 'weight', 'name'] });
    quantizeReplicatedFields('ExactSpot', { at: 1, weight: 10 });
    onTestFinished(() => quantizeReplicatedFields('ExactSpot', {}));
    const h = host(), off = await join(h.server, 'first');
    if (route === 'filtered') h.server.setInterestPolicy(() => 'all');
    if (route === 'budgeted') h.server.setBandwidthBudget({ bytesPerSecond: 1 });
    const e = h.world.spawn('actor');
    h.world.insert(e, Replicated, {});
    h.world.insert(e, spot, { at: { x: 0, y: 0, z: 0.49 }, weight: 4.5 });
    await h.step();
    off.client.applyPending();
    const offGhost = off.world.findEntityByName('actor')!;
    expect(off.world.get(offGhost, spot).at.z).toBe(0.49);
    h.world.update(e, spot, d => { d.at.z = 0; d.weight = 0; });
    await h.step();
    const grid = await join(h.server, 'second');
    const step = async () => { await h.step(); off.client.applyPending(); grid.client.applyPending(); };
    grid.client.applyPending(); // The next write happens before this viewer's first sample.
    const gridGhost = grid.world.findEntityByName('actor')!;
    expect(grid.world.get(gridGhost, spot).at.z).toBe(0);
    h.world.update(e, spot, d => { d.at.z = -0.01; d.weight = -0.5; });
    await step();
    expect([off.messages, grid.messages]).toEqual([[], []]); // Exactly half a step is still within tolerance.
    h.world.update(e, spot, d => { d.name = 'running'; });
    await step();
    expect([off.messages, grid.messages]).toEqual([['state'], ['state']]);
    h.world.update(e, spot, d => { d.at.z = -0.49; });
    await step();
    expect(off.world.get(offGhost, spot)).toEqual({ at: { x: 0, y: 0, z: 0 }, weight: 4.5, name: 'running' });
    h.world.update(e, spot, d => { d.at.z = 0.35; d.weight = -4.5; });
    await step();
    expect(off.world.get(offGhost, spot).weight).toBe(0);
    expect([off.messages.length, grid.messages.length]).toEqual([3, 1]);
    for (const z of [-0.49, 0.49, 0]) {
        h.world.update(e, spot, d => { d.at.z = z; });
        await step();
    }
    expect([off.messages.length, grid.messages.length]).toEqual([3, 1]);
});

it('keeps corrections to different fields while two viewers of the same spawn spend different budgets', async () => {
    const spot = defineComponent('SharedSpot', { x: 0, y: 0 }, { replicatedFields: ['x', 'y'] });
    quantizeReplicatedFields('SharedSpot', { x: 1, y: 1 });
    onTestFinished(() => quantizeReplicatedFields('SharedSpot', {}));
    const h = host(), fast = await join(h.server, 'first'), waiting = await join(h.server, 'second');
    const actor = h.world.spawn('actor'), blocker = h.world.spawn('blocker');
    for (const e of [actor, blocker]) h.world.insert(e, Replicated, {});
    h.world.insert(actor, spot, { x: 0.49, y: 0.49 });
    h.world.insert(blocker, spot, {});
    h.server.setBandwidthBudget({ bytesPerSecond: 1, priority: ({ connectionId, entity }) =>
        entity === (connectionId === fast.id ? actor : blocker) ? 10 : 1 });
    const step = async () => { await h.step(); fast.client.applyPending(); waiting.client.applyPending(); };
    const position = (peer: typeof fast) => peer.world.get(peer.world.findEntityByName('actor')!, spot);
    await step();
    h.world.update(actor, spot, d => { d.x = -0.49; });
    h.world.update(blocker, spot, d => { d.x = 1; });
    await step();
    expect(position(fast)).toEqual({ x: 0, y: 0.49 });
    expect(position(waiting)).toEqual({ x: 0.49, y: 0.49 });
    h.world.update(actor, spot, d => { d.y = -0.49; });
    await step();
    expect(position(fast)).toEqual({ x: 0, y: 0 });
    expect(position(waiting)).toEqual({ x: 0, y: 0 });
    expect(h.server.owedCount(waiting.id)).toBe(0);
});

it('uses the value from the latest interest entry and retires a spawn immediately covered by a broadcast', async () => {
    const spot = defineComponent('ViewSpot', { x: 0 }, { replicatedFields: ['x'] });
    quantizeReplicatedFields('ViewSpot', { x: 1 });
    onTestFinished(() => quantizeReplicatedFields('ViewSpot', {}));
    const h = host(), steady = await join(h.server, 'steady'), visitor = await join(h.server, 'visitor');
    let visible = false;
    h.server.setInterestPolicy(({ connectionId, candidates }) =>
        connectionId === visitor.id && !visible ? new Set() : new Set(candidates));
    const e = h.world.spawn('actor');
    h.world.insert(e, Replicated, {});
    h.world.insert(e, spot, { x: 0 });
    const step = async () => { await h.step(); steady.client.applyPending(); visitor.client.applyPending(); };
    await step();
    h.world.update(e, spot, d => { d.x = 0.48; });
    visible = true;
    await step();
    const old = visitor.world.findEntityByName('actor')!;
    expect(visitor.world.get(old, spot).x).toBe(0.48);
    visible = false;
    h.world.update(e, spot, d => { d.x = -0.49; });
    await step();
    expect(visitor.world.valid(old)).toBe(false);
    expect(visitor.messages).toEqual([]);
    visible = true;
    await step();
    const returned = visitor.world.findEntityByName('actor')!;
    expect(visitor.world.get(returned, spot).x).toBe(-0.49);
    h.world.update(e, spot, d => { d.x = 0.49; });
    await step();
    expect(visitor.world.get(returned, spot).x).toBe(0);
    expect([steady.messages, visitor.messages]).toEqual([[], ['state']]);

    visible = false;
    h.world.update(e, spot, d => { d.x = 1.1; });
    await step();
    h.server.setInterestPolicy(null);
    h.world.update(e, spot, d => { d.x = 0.49; });
    await step(); // The catch-up spawn is followed by this sample's shared binary row.
    const again = visitor.world.findEntityByName('actor')!;
    expect(visitor.world.get(again, spot).x).toBe(0);
    h.world.update(e, spot, d => { d.x = -0.49; });
    await step();
    expect(visitor.messages).toEqual(['state', 'state']);
});

it.each(['exact spawn', 'regular delta'])('frees the bandwidth slot when a deferred component is removed (%s)', async source => {
    const spot = defineComponent('BudgetSpot', { x: 0, revision: 0 }, { replicatedFields: ['x', 'revision'] });
    quantizeReplicatedFields('BudgetSpot', { x: 1 });
    onTestFinished(() => quantizeReplicatedFields('BudgetSpot', {}));
    const h = host(), peer = await join(h.server, 'viewer');
    h.server.setBandwidthBudget({ bytesPerSecond: 1, priority: () => 1 });
    const names = ['one', 'two', 'three'];
    const actors = names.map(name => {
        const e = h.world.spawn(name);
        h.world.insert(e, Replicated, {});
        h.world.insert(e, spot, { x: source === 'exact spawn' ? 0.49 : 0 });
        return e;
    });
    const step = async () => { await h.step(); peer.client.applyPending(); };
    await step();
    for (const e of actors) h.world.update(e, spot, d => { d.x = source === 'exact spawn' ? -0.49 : 1.2; });
    await step();
    const ghost = (name: string) => peer.world.findEntityByName(name)!;
    const waiting = names.filter(name => peer.world.get(ghost(name), spot).x === (source === 'exact spawn' ? 0.49 : 0));
    expect(waiting).toHaveLength(2);
    expect(h.server.owedCount(peer.id)).toBe(2);
    h.world.remove(h.world.findEntityByName(waiting[0]!)!, spot);
    h.world.update(h.world.findEntityByName(waiting[1]!)!, spot, d => { d.x = 1.3; d.revision = 2; });
    await step();
    expect(peer.world.has(ghost(waiting[0]!), spot)).toBe(false);
    expect(peer.world.get(ghost(waiting[1]!), spot)).toEqual({ x: 1, revision: 2 });
    expect(h.server.owedCount(peer.id)).toBe(0);
});

it('replaces the high field bit with the returning player’s exact baseline', async () => {
    const fields = Array.from({ length: 32 }, (_, i) => 'n' + i);
    const wide = defineComponent('WideSpot', Object.fromEntries(fields.map(f => [f, 0])) as Record<string, number>,
        { replicatedFields: fields });
    quantizeReplicatedFields('WideSpot', { n31: 1 });
    onTestFinished(() => quantizeReplicatedFields('WideSpot', {}));
    const h = host(), peer = await join(h.server, 'player');
    const e = h.world.spawn('wide');
    h.world.insert(e, Replicated, {});
    h.world.insert(e, wide, { n31: 0.49 });
    await h.step();
    peer.client.applyPending();
    const ghost = peer.world.findEntityByName('wide')!;
    h.server.detachConnection(peer.id);
    h.world.update(e, wide, d => { d.n31 = -0.49; });
    const [a, b] = MemoryTransport.pair();
    h.server.attachConnection(a);
    await peer.client.resume(b);
    await h.step();
    peer.client.applyPending();
    expect(peer.world.get(ghost, wide).n31).toBe(-0.49);
    h.world.update(e, wide, d => { d.n31 = 0.49; });
    await h.step();
    peer.client.applyPending();
    expect(peer.world.findEntityByName('wide')).toBe(ghost);
    expect(peer.world.get(ghost, wide).n31).toBe(0);
});
