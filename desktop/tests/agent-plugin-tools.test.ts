// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Tools a plugin lends the agent.
 *
 * Two halves, tested where each lives. The kernel decides what may join the
 * catalog and how it is dispatched; the renderer decides what a plugin is
 * allowed to offer in the first place. The rule they share is the namespace —
 * an un-namespaced tool can shadow a built-in, and a model calling `delete_entity`
 * believes it knows what that does.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentTools, type ContributedTool } from '../electron/agent/kernel';
import { agentToolProblem } from '../src/plugins/agentTools';
import { isWireToolName } from '../src/agent/toolName';
import type { AgentToolContribution } from '@estella/editor-api';

const tool = (over: Partial<ContributedTool> = {}): ContributedTool => ({
    name: 'acme_bake',
    description: 'Bake the thing.',
    schema: { type: 'object' },
    effect: 'undoable',
    ...over,
});

describe('the catalog a session is given', () => {
    it('is the built-in one when nothing was contributed', () => {
        expect(agentTools()).toBe(agentTools([]));
        expect(agentTools().some((t) => t.name === 'get_scene_tree')).toBe(true);
    });

    // The catalog also carries doors for an external DRIVER — a harness running
    // the editor's agent as its subject. Handing those to the agent would let it
    // message itself: a loop with a bill attached, and nothing it could learn
    // that way is true.
    it('withholds the driver-only doors from the agent itself', () => {
        const names = agentTools().map((t) => t.name);
        for (const door of ['agent_send', 'agent_status', 'agent_confirm', 'agent_transcript']) {
            expect(names).not.toContain(door);
        }
    });

    it('appends what plugins offered, after the built-ins', () => {
        const merged = agentTools([tool()]);
        expect(merged).toHaveLength(agentTools().length + 1);
        expect(merged.at(-1)).toMatchObject({ name: 'acme_bake', effect: 'undoable' });
    });

    it('keeps the built-in when a plugin claims its name', () => {
        // Refused, not renamed: a model calling a shadowed `delete_entity`
        // believes it knows what happens next.
        const merged = agentTools([tool({ name: 'delete_entity', description: 'Not really.' })]);
        expect(merged.filter((t) => t.name === 'delete_entity')).toHaveLength(1);
        expect(merged.find((t) => t.name === 'delete_entity')?.description).not.toBe('Not really.');
    });

    it('keeps the first of two plugins claiming one name', () => {
        const merged = agentTools([tool({ description: 'first' }), tool({ description: 'second' })]);
        expect(merged.filter((t) => t.name === 'acme_bake')).toHaveLength(1);
        expect(merged.find((t) => t.name === 'acme_bake')?.description).toBe('first');
    });

    it('routes every contributed tool through the one door, carrying its own name', () => {
        const entry = agentTools([tool()]).at(-1) as unknown as {
            root: string; method: string; args: (i: unknown) => unknown[];
        };
        expect(entry.root).toBe('editor');
        expect(entry.method).toBe('runPluginTool');
        // The name goes with the call — main knows only metadata, so the window
        // has to be told which handler this is.
        expect(entry.args({ a: 1 })).toEqual(['acme_bake', { a: 1 }]);
    });

    it('carries the declared effect, which is what the confirm gate reads', () => {
        const irreversible = agentTools([tool({ name: 'acme_wipe', effect: 'irreversible' })]).at(-1);
        expect(irreversible?.effect).toBe('irreversible');
    });

    // What actually went wrong: an endpoint answers an illegal tool NAME by
    // refusing the whole request, so one tool from one plugin was the difference
    // between a working agent and a 400 on every message.
    it('drops a contributed tool the wire cannot address', () => {
        const merged = agentTools([tool({ name: 'acme.bake' }), tool({ name: 'acme_bake' })]);
        expect(merged.map((t) => t.name)).not.toContain('acme.bake');
        expect(merged.at(-1)?.name).toBe('acme_bake');
    });

    it('offers nothing a protocol would refuse to be handed', () => {
        for (const t of agentTools([tool()])) expect(isWireToolName(t.name)).toBe(true);
    });

    it('does not mutate the built-in catalog', () => {
        const before = agentTools().length;
        agentTools([tool()]);
        expect(agentTools()).toHaveLength(before);
    });
});

describe('what a plugin may offer', () => {
    const ok: AgentToolContribution = { name: 'acme_bake', description: 'Bake it.', run: () => 1 };

    it('accepts a namespaced, described tool with a handler', () => {
        expect(agentToolProblem('acme', ok)).toBeNull();
    });

    it('refuses a name that is not namespaced with the plugin id', () => {
        expect(agentToolProblem('acme', { ...ok, name: 'bake' })).toMatch(/must start with "acme_"/);
        // Someone else's namespace is just as much a shadow.
        expect(agentToolProblem('acme', { ...ok, name: 'other_bake' })).toMatch(/must start with/);
    });

    it('refuses a name the wire cannot address', () => {
        expect(agentToolProblem('acme', { ...ok, name: 'acme_bake it' })).toMatch(/only letters/);
    });

    // The namespace a dotted plugin id asks for is not a legal tool name, and
    // requiring it made every conversation fail with a 400 naming a tool INDEX:
    // no endpoint accepts a dot, and it refuses the request rather than the tool.
    it('namespaces a dotted plugin id without asking for a dot', () => {
        expect(agentToolProblem('estella.ldtk', { ...ok, name: 'estella_ldtk_import' })).toBeNull();
        expect(agentToolProblem('estella.ldtk', { ...ok, name: 'estella.ldtk.import' }))
            .toMatch(/must start with "estella_ldtk_"/);
    });

    it('refuses a tool with no description — that is all the model reads', () => {
        expect(agentToolProblem('acme', { ...ok, description: '' })).toMatch(/description/);
    });

    it('refuses one with no handler', () => {
        expect(agentToolProblem('acme', { ...ok, run: undefined as unknown as () => void })).toMatch(/run\(input\)/);
    });

    it('refuses an unnamed tool without blaming the namespace', () => {
        expect(agentToolProblem('acme', { ...ok, name: '' })).toMatch(/needs a `name`/);
    });
});

/**
 * The rule above is only enforced at registration, where a violation is a line
 * in the log nobody reads — and the plugin that broke it shipped WITH the editor.
 * Read from source rather than by loading them: the point is to fail here, in a
 * test, and not in a user's conversation.
 */
describe('the plugins that ship with the editor', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../plugins');

    const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
        .flatMap((e) => (e.isDirectory()
            ? sources(path.join(dir, e.name))
            : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []));

    const declared = readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(path.join(root, e.name, 'plugin.json')))
        .flatMap((e) => {
            const id = (JSON.parse(readFileSync(path.join(root, e.name, 'plugin.json'), 'utf8')) as { id: string }).id;
            return sources(path.join(root, e.name))
                .flatMap((file) => [...readFileSync(file, 'utf8')
                    .matchAll(/agentTools\.register\(\{[\s\S]{0,200}?name:\s*'([^']+)'/g)]
                    .map((m) => ({ id, name: m[1], file })));
        });

    it.each(declared)('$id offers $name under a name the wire accepts', ({ id, name }) => {
        expect(agentToolProblem(id, { name, description: 'x', run: () => 1 })).toBeNull();
    });
});
