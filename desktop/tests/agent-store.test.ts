// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    agent-store.test.ts
 * @brief   Conversations kept on disk: what survives, what is deliberately
 *          dropped, and what is refused rather than half-read.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
    saveConversation, loadConversation, listConversations, deleteConversation,
} from '../electron/agent/store';
import type { AgentEvent } from '../electron/agent/types';

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'estella-agent-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const turn = (index: number, prompt: string): AgentEvent[] => [
    { type: 'turn_start', prompt, model: 'fake-model', index },
    { type: 'text', delta: 'sure' },
    { type: 'turn_end', steps: 1, mark: { seq: index }, tx: null, files: [], reason: 'end_turn' },
];

const conversation = (over: Partial<Parameters<typeof saveConversation>[1]> = {}) => ({
    id: 'abc-123',
    startedAt: 1000,
    model: 'fake-model',
    endpoint: 'anthropic',
    events: turn(0, 'add a pause menu'),
    memory: { v: 1, messages: [{ role: 'user', content: 'add a pause menu' }] },
    ...over,
});

describe('keeping a conversation', () => {
    it('round-trips the events and the model memory', async () => {
        await saveConversation(root, conversation());
        const back = await loadConversation(root, 'abc-123');
        expect(back?.events).toEqual(turn(0, 'add a pause menu'));
        expect(back?.memory).toEqual({ v: 1, messages: [{ role: 'user', content: 'add a pause menu' }] });
    });

    // The memory is the half that makes a resumed conversation continuable; the
    // events alone would give you one you can read and not carry on.
    it('keeps the memory opaque — whatever the provider handed over comes back', async () => {
        const odd = { v: 1, weird: [1, { nested: true }], blocks: [{ type: 'thinking', signature: 'xyz' }] };
        await saveConversation(root, conversation({ memory: odd }));
        expect((await loadConversation(root, 'abc-123'))?.memory).toEqual(odd);
    });

    it('names itself after the first thing asked', async () => {
        await saveConversation(root, conversation({
            events: [...turn(0, '  give   every button a\nnine-slice  '), ...turn(1, 'now the fonts')],
        }));
        expect((await loadConversation(root, 'abc-123'))?.title).toBe('give every button a nine-slice');
    });

    // A frame is hundreds of kilobytes of base64 and would dominate the file;
    // what the call ANSWERED is in the summary either way.
    it('drops screenshots but keeps the row that took them', async () => {
        const withShot: AgentEvent[] = [
            { type: 'turn_start', prompt: 'look', model: 'm', index: 0 },
            { type: 'tool_end', id: 'c1', ok: true, summary: 'screenshot attached', image: 'data:image/png;base64,AAAA' },
            { type: 'turn_end', steps: 0, mark: null, tx: null, files: [], reason: 'end_turn' },
        ];
        await saveConversation(root, conversation({ events: withShot }));
        const back = await loadConversation(root, 'abc-123');
        const end = back!.events.find((e) => e.type === 'tool_end');
        expect(end).toBeDefined();
        expect(end).not.toHaveProperty('image');
        expect(end).toMatchObject({ id: 'c1', ok: true, summary: 'screenshot attached' });
    });

    it('lists newest first, with the turn count', async () => {
        await saveConversation(root, conversation({ id: 'older', events: turn(0, 'first') }));
        await new Promise((r) => { setTimeout(r, 5); });
        await saveConversation(root, conversation({
            id: 'newer', events: [...turn(0, 'second'), ...turn(1, 'and again')],
        }));
        const list = await listConversations(root);
        expect(list.map((c) => c.id)).toEqual(['newer', 'older']);
        expect(list[0]).toMatchObject({ title: 'second', turns: 2, model: 'fake-model' });
    });

    it('has none before anything is saved, and none after deleting', async () => {
        expect(await listConversations(root)).toEqual([]);
        await saveConversation(root, conversation());
        await deleteConversation(root, 'abc-123');
        expect(await listConversations(root)).toEqual([]);
        expect(await loadConversation(root, 'abc-123')).toBeNull();
    });

    it('deleting one that is not there is not a failure', async () => {
        await expect(deleteConversation(root, 'never-existed')).resolves.toBeUndefined();
    });
});

describe('what it refuses', () => {
    // Ids name a file. Anything that could climb out of the directory is refused
    // rather than sanitised into some other path.
    it('will not read or write an id that is not one of ours', async () => {
        await saveConversation(root, conversation({ id: '../escape' }));
        expect(await loadConversation(root, '../escape')).toBeNull();
        expect(await listConversations(root)).toEqual([]);
    });

    it('refuses a file from a newer editor rather than reading half of it', async () => {
        await mkdir(path.join(root, '.esengine', 'agent'), { recursive: true });
        await writeFile(
            path.join(root, '.esengine', 'agent', 'future.json'),
            JSON.stringify({ v: 99, id: 'future', events: [], memory: {} }),
            'utf8',
        );
        expect(await loadConversation(root, 'future')).toBeNull();
        expect(await listConversations(root)).toEqual([]);
    });

    it('survives a corrupt file — it is one conversation lost, not the list', async () => {
        await saveConversation(root, conversation({ id: 'good' }));
        await writeFile(path.join(root, '.esengine', 'agent', 'bad.json'), '{ not json', 'utf8');
        const list = await listConversations(root);
        expect(list.map((c) => c.id)).toEqual(['good']);
    });

    it('leaves the file it could not parse alone', async () => {
        await mkdir(path.join(root, '.esengine', 'agent'), { recursive: true });
        const p = path.join(root, '.esengine', 'agent', 'bad.json');
        await writeFile(p, '{ not json', 'utf8');
        await listConversations(root);
        expect(await readFile(p, 'utf8')).toBe('{ not json');
    });
});
