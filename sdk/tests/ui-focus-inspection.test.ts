// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach } from 'vitest';
import { flushPendingRegistrations } from '../src/app/app';
import { Parent } from '../src/ecs/component';
import { Input, InputState } from '../src/input/input';
import { UIEvents, UIEventQueue } from '../src/ui/core/events';
import { UINode, UIDisplay } from '../src/ui/core/ui-node';
import { UIDialog } from '../src/ui/behavior/dialog';
import { Focusable, FocusManager } from '../src/ui/input/focusable';
import { Interactable } from '../src/ui/input/interactable';
import { inspectFocusTraversal } from '../src/ui/input/focus-inspection';
import { focusPlugin } from '../src/ui/input/focus';
import { bootMockApp } from './helpers/mockApp';
import type { Entity } from '../src/types';
let harness: ReturnType<typeof bootMockApp>;
beforeEach(() => { harness = bootMockApp(); });
function control(index: number, enabled = true) {
    const entity = harness.app.world.spawn();
    harness.app.world.insert(entity, Focusable, { tabIndex: index, isFocused: false });
    harness.app.world.insert(entity, Interactable, { enabled });
    return entity;
}
describe('focus inspection shares runtime traversal', () => {
    it('reports disabled entries and stable ties, without focusing or writing', async () => {
        const { app } = harness;
        app.insertResource(Input, new InputState());
        app.insertResource(UIEvents, new UIEventQueue());
        focusPlugin.build(app);
        flushPendingRegistrations(app);
        const first = control(2), skipped = control(1, false), last = control(2);
        const snapshot = inspectFocusTraversal(app.world);
        expect(snapshot.entries.map(e => e.entity)).toEqual([skipped, first, last]);
        expect(snapshot.entries[0].skipped).toBe('disabled');
        expect(app.getResource(FocusManager).focusedEntity).toBeNull();
        expect(app.world.get(first, Focusable).isFocused).toBe(false);
        const input = app.getResource(Input);
        input.keysPressed.add('Tab');
        await app.tick(1 / 60);
        expect(app.getResource(FocusManager).focusedEntity).toBe(first);
        input.keysPressed.clear();
        input.keysDown.add('Shift');
        input.keysPressed.add('Tab');
        await app.tick(1 / 60);
        expect(app.getResource(FocusManager).focusedEntity).toBe(last);
    });
    it('uses host hierarchical visibility, with disabled taking precedence', () => {
        const hidden = control(0), disabled = control(1, false), shown = control(2);
        harness.module.getUINodeHiddenInTree = (_registry: unknown, entity: Entity) => entity !== shown;
        const result = inspectFocusTraversal(harness.app.world);
        expect(result.visibilityResolved).toBe(true);
        expect(result.entries.map(e => [e.entity, e.skipped])).toEqual([[hidden, 'hidden'], [disabled, 'disabled'], [shown, null]]);
    });
    it('limits an open dialog to its root and descendants; closing restores the ring', () => {
        const world = harness.app.world;
        const outside = control(0), root = control(1), child = control(2);
        world.insert(root, UIDialog);
        world.insert(root, UINode, { display: UIDisplay.Flex });
        world.insert(child, Parent, { entity: root });
        expect(inspectFocusTraversal(world).entries.map(e => e.skipped)).toEqual(['outside-dialog', null, null]);
        world.update(root, UINode, node => { node.display = UIDisplay.None; });
        expect(inspectFocusTraversal(world).entries.find(e => e.entity === outside)?.skipped).toBeNull();
    });
    it('discloses unavailable host visibility rather than asserting visible bounds', () => {
        control(0);
        delete harness.module.getUINodeHiddenInTree;
        expect(inspectFocusTraversal(harness.app.world).visibilityResolved).toBe(false);
    });
});


it('does not trap visible controls behind a dialog hidden by an ancestor', () => {
    const world = harness.app.world;
    const outside = control(0), dialog = control(1);
    const host = world.spawn();
    world.insert(host, UINode, { display: UIDisplay.None });
    world.insert(dialog, Parent, { entity: host });
    world.insert(dialog, UIDialog);
    world.insert(dialog, UINode, { display: UIDisplay.Flex });
    let hidden = true;
    harness.module.getUINodeHiddenInTree = (_registry: unknown, entity: Entity) => hidden && entity === dialog;
    expect(inspectFocusTraversal(world).entries.map(e => e.skipped)).toEqual([null, 'hidden']);
    hidden = false;
    expect(inspectFocusTraversal(world).entries.map(e => e.skipped)).toEqual(['outside-dialog', null]);
    world.despawn(dialog);
    expect(inspectFocusTraversal(world).entries.find(e => e.entity === outside)?.skipped).toBeNull();
});

it('keeps a visible modal active when a second modal is hierarchically hidden', () => {
    const world = harness.app.world;
    const background = control(0), visible = control(1), hidden = control(2);
    for (const entity of [visible, hidden]) {
        world.insert(entity, UIDialog);
        world.insert(entity, UINode, { display: UIDisplay.Flex });
    }
    harness.module.getUINodeHiddenInTree = (_registry: unknown, entity: Entity) => entity === hidden;
    expect(inspectFocusTraversal(world).entries.map(e => [e.entity, e.skipped]))
        .toEqual([[background, 'outside-dialog'], [visible, null], [hidden, 'hidden']]);
});
