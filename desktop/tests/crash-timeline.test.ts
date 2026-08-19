// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The run-up to a crash: one ordered stream, recorded where the editor's
 *        two write doors already converge.
 *
 *        The stream is kept UNREDACTED, which is only defensible if what goes
 *        into it is safe by construction — ids and shapes, never a name or a
 *        value. That property is what most of this file checks.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { note, timelineSnapshot, clearTimeline } from '@/diagnostics/timeline';
import { commands } from '@/commands';
import { EditorHistory } from '@/engine/EditorHistory';

const NOW = 1_000_000_000_000;

beforeEach(() => clearTimeline());

describe('the timeline', () => {
    it('is one stream, so the order across sources survives', () => {
        // Two streams carry this order only if a reader re-merges them by clock.
        // The kind is a field precisely so nobody has to.
        note('command', 'project.open');
        note('edit', 'Delete entity', 'remove×1');
        note('command', 'edit.undo');
        const t = timelineSnapshot(NOW);
        expect(t.events.map((e) => `${e.kind}:${e.id}`)).toEqual([
            'command:project.open', 'edit:Delete entity', 'command:edit.undo',
        ]);
    });

    it('collapses a repeat instead of flushing the interesting thing out', () => {
        // A gizmo drag records one edit per frame. Without collapsing, the
        // buffer would hold nothing but the drag.
        note('command', 'project.open');
        for (let i = 0; i < 500; i++) note('edit', 'Move entity', 'modify×1 Transform');
        const t = timelineSnapshot(NOW);
        expect(t.events).toHaveLength(2);
        expect(t.events[0].id).toBe('project.open');
        expect(t.events[1].count).toBe(500);
    });

    it('keeps the newest when it overflows, and says the buffer is full', () => {
        for (let i = 0; i < 400; i++) note('command', `cmd.${i}`);
        const t = timelineSnapshot(NOW);
        expect(t.kept).toBe(t.capacity);
        expect(t.events[t.events.length - 1].id).toBe('cmd.399');
        expect(t.events[0].id).not.toBe('cmd.0');
    });

    it('times events relative to the report, not to a clock in some timezone', () => {
        note('command', 'project.open');
        const t = timelineSnapshot(Date.now() + 4200);
        expect(t.events[0].tMinusSec).toBeGreaterThanOrEqual(4.1);
        expect(t.events[0].tMinusSec).toBeLessThanOrEqual(4.4);
        expect(t.newestAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
});

describe('what the editor records', () => {
    it('notes a command at the one place commands dispatch', () => {
        // A command of this test's own, so what is asserted is the dispatch
        // point rather than any real command's implementation.
        let ran = 0;
        const off = commands.register(
            { id: 'test.noop', label: 'noop', category: 'test', run: () => { ran++; } },
            'plugin:test');
        commands.run('test.noop');
        off.dispose();
        expect(ran).toBe(1);
        const t = timelineSnapshot(NOW);
        expect(t.events.some((e) => e.kind === 'command' && e.id === 'test.noop')).toBe(true);
    });

    it('notes a command that was REFUSED, which is half of a bug report', () => {
        // "I pressed undo and nothing happened" is a report. A stream that only
        // held what ran would show nothing at the moment being described.
        expect(EditorHistory.canUndo()).toBe(false);
        commands.run('edit.undo');
        const t = timelineSnapshot(NOW);
        const undo = t.events.find((e) => e.id === 'edit.undo');
        expect(undo?.detail).toBe('disabled');
    });

    it('notes an edit as a shape — no name, no value ever reaches the stream', () => {
        // The stream is not redacted, so this is the property that makes that
        // safe. An entity called "SecretBossName" must not appear here.
        // Six digits, because this is a substring check over a snapshot carrying
        // an ISO timestamp: `999` matched a millisecond field about one run in a
        // thousand. No six-digit run occurs in an ISO time — the year is four.
        EditorHistory.describe({
            kind: 'modify', entity: 7, name: 'SecretBossName',
            component: 'Transform', field: 'x', before: 1, after: 987654,
        });
        EditorHistory.record('Move entity', () => {}, () => {});
        const t = timelineSnapshot(NOW);
        const edit = t.events.find((e) => e.kind === 'edit');
        expect(edit?.id).toBe('Move entity');
        expect(edit?.detail).toBe('modify×1 Transform');
        expect(JSON.stringify(t)).not.toContain('SecretBossName');
        expect(JSON.stringify(t)).not.toContain('987654');
    });

    it('names the step an undo reached, not just that undo happened', () => {
        // Found by reading a real timeline: it showed `command:edit.undo` with
        // no subject. "Undo" alone cannot be read back or replayed, and the
        // command has no way to know which step it reached.
        EditorHistory.describe({ kind: 'add', entity: 3, name: 'Sprite0' });
        EditorHistory.record('Add Entity', () => {}, () => {});
        clearTimeline();
        EditorHistory.undo();
        EditorHistory.redo();
        const t = timelineSnapshot(NOW);
        expect(t.events.map((e) => `${e.id}|${e.detail}`)).toEqual([
            'Add Entity|undo add×1', 'Add Entity|redo add×1',
        ]);
        expect(JSON.stringify(t)).not.toContain('Sprite0');
    });

    it('records an edit with nothing declared, rather than dropping the step', () => {
        // `describe` is optional today. A step without it still has to appear —
        // "something changed here and did not say what" is a finding, and a gap
        // in the sequence is not.
        EditorHistory.record('Untold edit', () => {}, () => {});
        const t = timelineSnapshot(NOW);
        const edit = t.events.find((e) => e.id === 'Untold edit');
        expect(edit).toBeDefined();
        expect(edit?.detail).toBeUndefined();
    });
});
