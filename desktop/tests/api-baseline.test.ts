// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  api-baseline.test.ts — the rule that decides a broken API promise.
 *
 * It only fires the release AFTER a symbol is frozen, so without these it would
 * first be exercised on the day it had to be right.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — a repo tool, shipped as .mjs with no declarations
import { parseSnapshot, baselineFindings, UNCLAIMED } from '../../tools/lib/apiSnapshot.mjs';

type Entry = { kind: string; tier: string; deprecated: boolean; body: string };

function snapshot(...sections: string[]): Map<string, Entry> {
    return parseSnapshot(`# API surface — esengine/test\n\n${sections.join('\n\n')}\n`);
}

const sig = (heading: string, body: string) => `## ${heading}\n\`\`\`\n${body}\n\`\`\``;

describe('parseSnapshot', () => {
    it('reads the tier and the deprecation as separate axes', () => {
        const s = snapshot(
            sig('defineComponent — function @public', '(name: string): ComponentDef'),
            sig('oldThing — function @public @deprecated', '(): void'),
            sig('graph — const @beta', 'MaterialGraph'),
        );
        expect(s.get('defineComponent')).toMatchObject({ tier: 'public', deprecated: false });
        expect(s.get('oldThing')).toMatchObject({ tier: 'public', deprecated: true });
        expect(s.get('graph')).toMatchObject({ tier: 'beta', deprecated: false });
    });

    it('reads a snapshot written before the tiers existed as claiming nothing', () => {
        const s = snapshot(sig('Query — class', 'call ()'));
        expect(s.get('Query')?.tier).toBe(UNCLAIMED);
    });
});

describe('baselineFindings', () => {
    const frozen = snapshot(sig('Commands — class @public', 'spawn(): Entity'));

    it('passes when the frozen signature is untouched', () => {
        const now = snapshot(sig('Commands — class @public', 'spawn(): Entity'));
        expect(baselineFindings(frozen, now).failures).toEqual([]);
    });

    it('fails a removal that never went through @deprecated', () => {
        const now = snapshot(sig('Other — class @public', 'x(): void'));
        expect(baselineFindings(frozen, now).failures).toEqual([
            expect.stringContaining('Commands — removed while @public and never @deprecated'),
        ]);
    });

    it('allows a removal that was deprecated in the release before it', () => {
        const was = snapshot(sig('Commands — class @public @deprecated', 'spawn(): Entity'));
        expect(baselineFindings(was, snapshot()).failures).toEqual([]);
    });

    it('fails a changed signature', () => {
        const now = snapshot(sig('Commands — class @public', 'spawn(name: string): Entity'));
        expect(baselineFindings(frozen, now).failures).toEqual([
            expect.stringContaining('@public signature changed'),
        ]);
    });

    it('fails a kind change', () => {
        const now = snapshot(sig('Commands — interface @public', 'spawn(): Entity'));
        expect(baselineFindings(frozen, now).failures).toEqual([
            expect.stringContaining('class became a interface'),
        ]);
    });

    it('fails a thaw back to a weaker tier', () => {
        const now = snapshot(sig('Commands — class @public', 'spawn(): Entity')
            .replace('@public', '@beta'));
        expect(baselineFindings(frozen, now).failures).toEqual([
            expect.stringContaining('a freeze does not thaw'),
        ]);
    });

    it('notes but does not fail a @beta change', () => {
        const was = snapshot(sig('graph — const @beta', 'MaterialGraph'));
        const { failures, notes } = baselineFindings(was, snapshot());
        expect(failures).toEqual([]);
        expect(notes).toEqual([expect.stringContaining('@beta removed')]);
    });

    it('claims nothing about a symbol no release tiered', () => {
        const was = snapshot(sig('legacy — function', '(): void'));
        const { failures, notes } = baselineFindings(was, snapshot());
        expect(failures).toEqual([]);
        expect(notes).toEqual([]);
    });

    it('lets an @internal member change, because none was promised', () => {
        const was = snapshot(sig('Handle — class @public', 'get(): number\n@internal _raw: string'));
        const now = snapshot(sig('Handle — class @public', 'get(): number\n@internal _raw: number'));
        expect(baselineFindings(was, now).failures).toEqual([]);
    });

    it('still fails when a promised member beside an @internal one changes', () => {
        const was = snapshot(sig('Handle — class @public', 'get(): number\n@internal _raw: string'));
        const now = snapshot(sig('Handle — class @public', 'get(): string\n@internal _raw: string'));
        expect(baselineFindings(was, now).failures).toEqual([
            expect.stringContaining('@public signature changed'),
        ]);
    });
});
