// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { bootMockApp } from './helpers/mockApp';
import { flushPendingRegistrations } from '../src/app/app';
import { Input, InputState } from '../src/input/input';
import { UICameraInfo } from '../src/ui/core/ui-camera-info';
import { ScreenOverlay } from '../src/ui/core/screen-overlay';
import { UILayoutGeneration } from '../src/ui/layout/ui-layout-generation';
import { UIInteraction, Interactable } from '../src/ui/input/interactable';
import { Focusable, FocusManager } from '../src/ui/input/focusable';
import { focusPlugin } from '../src/ui/input/focus';
import { uiInteractionPlugin } from '../src/ui/input/interaction';
import { UIEvents } from '../src/ui/core/events';
const hit = vi.hoisted(() => ({ entity: null as number | null }));
vi.mock('../src/ui/util/ui-pick', () => ({
  screenToUiWorld: () => ({ x: 0, y: 0 }), screenToUiLayout: () => ({ x: 0, y: 0 }),
  uiPointerRay: () => ({}), uiLayoutRay: () => ({}), uiHitTestWorld: () => hit.entity,
}));

describe('quick pointer focus through real interaction projection', () => {
  it('preserves press/release edges when the whole click ends before a frame', async () => {
    const { app } = bootMockApp();
    const input = new InputState();
    app.insertResource(Input, input);
    app.insertResource(UICameraInfo, { valid: false } as any);
    app.insertResource(ScreenOverlay, { active: true, surfaceH: 600 } as any);
    app.insertResource(UILayoutGeneration, { generation: 0 });
    uiInteractionPlugin.build(app);
    focusPlugin.build(app);
    flushPendingRegistrations(app);
    const entity = app.world.spawn();
    app.world.insert(entity, Interactable, { enabled: true });
    app.world.insert(entity, Focusable, {});
    hit.entity = entity;
    const kinds: string[] = [];
    for (const kind of ['press', 'release', 'click']) app.getResource(UIEvents).on(entity, kind, () => kinds.push(kind));
    input.noteMouseDown(0);
    input.noteMouseUp(0);
    await app.tick(1 / 60);
    expect(kinds).toEqual(['press', 'release', 'click']);
    expect(app.world.get(entity, UIInteraction)).toMatchObject({ pressed: false, justPressed: true, justReleased: true });
    expect(app.getResource(FocusManager).focusedEntity).toBe(entity);
    expect(app.getResource(FocusManager).focusVisible).toBe(false);
    input.clearFrameState();
    await app.tick(1 / 60);
    expect(app.world.get(entity, UIInteraction)).toMatchObject({ justPressed: false, justReleased: false });
    expect(app.getResource(FocusManager).focusedEntity).toBe(entity);
  });
});
