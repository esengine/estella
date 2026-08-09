// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The diagnostic bundle: what it collects, and what it refuses to carry.
 *
 *        Two properties do the work. A bundle is assembled from a REGISTRY, so a
 *        subsystem that has something to say is not also a line in an exporter
 *        that can be forgotten. And the user's own content is marked on the
 *        VALUE, so the safe export cannot drift from the real one — there is only
 *        one collector.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { diagnosticsRegistry } from '@/diagnostics/registry';
import { collectBundle, serializeBundle, bundleFileName, BUNDLE_FORMAT } from '@/diagnostics/bundle';
import { personal, resolve, placeholder, stableTag } from '@/diagnostics/redact';

const AT = '2026-08-08T21:30:00.000Z';
const disposers: { dispose(): void }[] = [];
const section = (id: string, collect: () => unknown) => {
    disposers.push(diagnosticsRegistry.register({ id, collect }, 'plugin:test'));
};

afterEach(() => {
    diagnosticsRegistry.disposeOwner('plugin:test');
    disposers.length = 0;
});

describe('a personal value', () => {
    it('reads as the same placeholder everywhere it appears', () => {
        // The whole point of a sequence is telling "deleted X then undid X" from
        // "deleted X then undid Y". A per-occurrence placeholder erases exactly
        // that, so equal values must produce equal tags.
        const a = placeholder(personal('Player', 'name'));
        const b = placeholder(personal('Player', 'name'));
        expect(a).toBe(b);
        expect(placeholder(personal('Enemy', 'name'))).not.toBe(a);
    });

    it('keeps the kind and the shape, which is often the diagnosis', () => {
        expect(placeholder(personal('assets/x.png', 'path'))).toContain('path#');
        expect(placeholder(personal('assets/x.png', 'path'))).toContain('len=12');
        // Absent and zero are different bugs; redaction must not merge them.
        expect(placeholder(personal(undefined, 'value'))).toBe('value#undefined');
        expect(placeholder(personal(0, 'value'))).toBe('value#number');
        expect(placeholder(personal(null, 'value'))).toBe('value#null');
    });

    it('is carried only at full detail', () => {
        const tree = { keep: 1, mine: personal('Player', 'name') };
        expect(resolve(tree, 'full')).toEqual({ keep: 1, mine: 'Player' });
        expect((resolve(tree, 'safe') as { mine: string }).mine).toContain('name#');
        expect(JSON.stringify(resolve(tree, 'safe'))).not.toContain('Player');
    });

    it('is resolved wherever it is nested', () => {
        // A section returns a tree, not a flat record, so redaction that only
        // looked at the top level would leak everything one level down.
        const tree = { a: [{ b: { c: personal('secret', 'text') } }] };
        expect(JSON.stringify(resolve(tree, 'safe'))).not.toContain('secret');
    });

    it('does not serialize live objects, or loop on a cycle', () => {
        class Live { x = 1; }
        const cyclic: Record<string, unknown> = { n: 1 };
        cyclic.self = cyclic;
        expect(resolve({ live: new Live() }, 'safe')).toEqual({ live: '[Live]' });
        expect(resolve(cyclic, 'safe')).toEqual({ n: 1, self: '[circular]' });
        expect(resolve({ f: () => 0 }, 'safe')).toEqual({ f: '[function]' });
    });
});

describe('the bundle', () => {
    it('is whatever registered, not a list the exporter keeps', () => {
        section('probe', () => ({ hello: 'world' }));
        const b = collectBundle('safe', AT);
        expect(b.sections.probe).toEqual({ hello: 'world' });
        expect(b.formatVersion).toBe(BUNDLE_FORMAT);
        expect(b.createdAt).toBe(AT);
    });

    it('survives a section that throws, and says which', () => {
        // During an incident a bundle that is mostly present beats no bundle, and
        // the collector that failed is itself a finding.
        section('good', () => ({ ok: true }));
        section('bad', () => { throw new Error('probe exploded'); });
        const b = collectBundle('safe', AT);
        expect(b.sections.good).toEqual({ ok: true });
        expect(b.sections.bad).toBeUndefined();
        expect(b.failedSections.bad).toBe('probe exploded');
    });

    it('leaves out a section with nothing to say', () => {
        // Absent and empty are different facts: "no project open" must not read
        // as "a project with nothing in it".
        section('quiet', () => null);
        expect('quiet' in collectBundle('safe', AT).sections).toBe(false);
    });

    it('carries no personal value at safe detail, whichever section held it', () => {
        section('leaky', () => ({ deep: { name: personal('MyGame', 'project') } }));
        expect(serializeBundle(collectBundle('safe', AT))).not.toContain('MyGame');
        expect(serializeBundle(collectBundle('full', AT))).toContain('MyGame');
    });

    it('names a file that sorts by time and is legal on Windows', () => {
        const name = bundleFileName(AT);
        expect(name).toMatch(/^estella-diagnostics-[\d-]+T[\d-]+\.json$/);
        expect(name).not.toContain(':');
    });
});

describe('the core sections', () => {
    it('are registered by importing the barrel', async () => {
        await import('@/diagnostics');
        const ids = diagnosticsRegistry.all().map((s) => s.id);
        expect(ids).toEqual(expect.arrayContaining(['editor', 'engine', 'project', 'census', 'log']));
    });

    it('have distinct ids, so none silently replaces another', () => {
        const ids = diagnosticsRegistry.all().map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('the stable tag', () => {
    it('is the same across runs for the same value', () => {
        expect(stableTag('Player')).toBe(stableTag('Player'));
        expect(stableTag('Player')).toHaveLength(4);
    });
});
