// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { bootMockApp } from './helpers/mockApp';
import { flushPendingRegistrations } from '../src/app/app';
import { Input, InputState, inputEventCallbacks } from '../src/input/input';
import { UICameraInfo } from '../src/ui/core/ui-camera-info';
import { ScreenOverlay } from '../src/ui/core/screen-overlay';
import { UILayoutGeneration } from '../src/ui/layout/ui-layout-generation';
import { UIInteraction, Interactable } from '../src/ui/input/interactable';
import { Focusable, FocusManager } from '../src/ui/input/focusable';
import { focusPlugin } from '../src/ui/input/focus';
import { UIInteractionPlugin, uiInteractionPlugin } from '../src/ui/input/interaction';
import { uiLayoutPlugin } from '../src/ui/layout/layout';
import { UIEvents } from '../src/ui/core/events';
import { setEntityActive } from '../src/ecs/entityUtils';
import { inputRouter } from '../src/input/inputRouter';
import { onGestureClick, takeGestureFired } from '../src/ui/input/gestureClick';
import { getComponent } from '../src/ecs/component';
import { inspectableTypes } from '../src/runtime/worldSnapshot';
const hit = vi.hoisted(() => ({ entity: null as number | null }));
vi.mock('../src/ui/util/ui-pick', () => ({
  screenToUiWorld: () => ({ x: 0, y: 0 }), screenToUiLayout: () => ({ x: 0, y: 0 }),
  uiPointerRay: () => ({}), uiLayoutRay: () => ({}), uiHitTestWorld: () => hit.entity, uiHitAtScreen: () => hit.entity,
}));

describe('quick pointer focus through real interaction projection', () => {
  it.each(['quick', 'held', 'cleared'])('a consumed release cancels UI capture without clicking through: %s', async phase => {
    const { app } = bootMockApp(); const input = new InputState();
    app.insertResource(Input, input); app.insertResource(UICameraInfo, { valid: false } as any);
    app.insertResource(ScreenOverlay, { active: true, surfaceH: 600 } as any);
    app.addPlugin(uiLayoutPlugin); app.addPlugin(new UIInteractionPlugin()); flushPendingRegistrations(app);
    const entity = app.world.spawn(); app.world.insert(entity, Interactable); hit.entity = entity;
    const clicked = vi.fn(); app.getResource(UIEvents).on(entity, 'click', clicked);
    const callbacks = inputEventCallbacks(input);
    callbacks.onPointerDown(0, 0, 0);
    if (phase !== 'quick') { await app.tick(1 / 60); input.clearFrameState(); }
    const off = inputRouter.setEditorHandler({ onPointerUp: () => true });
    try { callbacks.onPointerUp(0); } finally { off(); }
    if (phase === 'cleared') input.clearFrameState();
    await app.tick(1 / 60);
    expect(clicked).not.toHaveBeenCalled();
    expect(app.world.get(entity, UIInteraction).pressed).toBe(false);
    expect(app.world.get(entity, UIInteraction).justPressed).toBe(false);
    app.quit();
  });
  it('does not let a disabled gesture suppress a later quick tap after re-enabling', async () => {
    const { app } = bootMockApp(); const input = new InputState();
    app.insertResource(Input, input); app.insertResource(UICameraInfo, { valid: false } as any);
    app.insertResource(ScreenOverlay, { active: true, surfaceH: 600 } as any);
    app.addPlugin(uiLayoutPlugin); app.addPlugin(new UIInteractionPlugin()); flushPendingRegistrations(app);
    const entity = app.world.spawn(); app.world.insert(entity, Interactable); hit.entity = entity;
    const clicked = vi.fn();
    onGestureClick(app.world, entity, () => {
      clicked(); app.world.update(entity, Interactable, data => { data.enabled = false; });
    });
    app.getResource(UIEvents).on(entity, 'click', () => {
      if (!takeGestureFired(app.world, entity)) clicked();
    });
    input.noteMouseDown(0); await app.tick(1 / 60); input.clearFrameState();
    inputRouter.dispatchPointerUp(0); input.noteMouseUp(0); await app.tick(1 / 60);
    expect(clicked).toHaveBeenCalledOnce(); input.clearFrameState();
    app.world.update(entity, Interactable, data => { data.enabled = true; });
    input.noteMouseDown(0); input.noteMouseUp(0); await app.tick(1 / 60);
    expect(clicked).toHaveBeenCalledTimes(2); app.quit();
  });
  it('quitting an app unregisters its UI release handler', async () => {
    const { app } = bootMockApp(); const input = new InputState();
    app.insertResource(Input, input); app.insertResource(UICameraInfo, { valid: false } as any);
    app.insertResource(ScreenOverlay, { active: true, surfaceH: 600 } as any);
    app.addPlugin(uiLayoutPlugin); app.addPlugin(new UIInteractionPlugin());
    flushPendingRegistrations(app);
    const entity = app.world.spawn(); app.world.insert(entity, Interactable); hit.entity = entity;
    input.noteMouseDown(0); await app.tick(1 / 60);
    app.quit();
    const read = vi.spyOn(app.world, 'isEntityActive');
    inputRouter.dispatchPointerUp(0);
    expect(read).not.toHaveBeenCalled(); read.mockRestore();
  });
  it('quitting an older app leaves the newer app gesture handler installed', async () => {
    const plugin = new UIInteractionPlugin();
    const capture = async () => {
      const { app } = bootMockApp(); const input = new InputState();
      app.insertResource(Input, input); app.insertResource(UICameraInfo, { valid: false } as any);
      app.insertResource(ScreenOverlay, { active: true, surfaceH: 600 } as any);
      app.addPlugin(uiLayoutPlugin); app.addPlugin(plugin); flushPendingRegistrations(app);
      const entity = app.world.spawn(); app.world.insert(entity, Interactable); hit.entity = entity;
      input.noteMouseDown(0); await app.tick(1 / 60);
      return { app, entity };
    };
    const first = await capture(), second = await capture(), clicked = vi.fn();
    onGestureClick(second.app.world, second.entity, clicked);
    first.app.quit(); inputRouter.dispatchPointerUp(0);
    expect(clicked).toHaveBeenCalledOnce();
    second.app.quit();
  });
  it.each(['hover_enter', 'press', 'release'])('stops a queued click when %s disables the control', async phase => {
    const { app } = bootMockApp(); const input = new InputState();
    app.insertResource(Input, input);
    app.insertResource(UICameraInfo, { valid: false } as any);
    app.insertResource(ScreenOverlay, { active: true, surfaceH: 600 } as any);
    app.insertResource(UILayoutGeneration, { generation: 0 });
    uiInteractionPlugin.build(app); flushPendingRegistrations(app);
    const entity = app.world.spawn();
    app.world.insert(entity, Interactable, { enabled: true }); hit.entity = entity;
    const kinds: string[] = [];
    for (const kind of ['hover_enter', 'press', 'release', 'click']) {
      app.getResource(UIEvents).on(entity, kind, () => {
        kinds.push(kind);
        if (kind === phase) app.world.update(entity, Interactable, data => { data.enabled = false; });
      });
    }
    input.noteMouseDown(0); input.noteMouseUp(0);
    await app.tick(1 / 60);
    const order = ['hover_enter', 'press', 'release'];
    expect(kinds).toEqual(order.slice(0, order.indexOf(phase) + 1));
    expect(app.world.get(entity, UIInteraction)).toMatchObject({ hovered: false, pressed: false, justPressed: false, justReleased: false });
    expect(input.pointerOverUI).toBe(false);
  });
  it('cancels a held press disabled by its press handler without restoring capture', async () => {
    const { app } = bootMockApp(); const input = new InputState();
    app.insertResource(Input, input);
    app.insertResource(UICameraInfo, { valid: false } as any);
    app.insertResource(ScreenOverlay, { active: true, surfaceH: 600 } as any);
    app.insertResource(UILayoutGeneration, { generation: 0 });
    uiInteractionPlugin.build(app); flushPendingRegistrations(app);
    const entity = app.world.spawn();
    app.world.insert(entity, Interactable, { enabled: true }); hit.entity = entity;
    app.getResource(UIEvents).on(entity, 'press', () => app.world.update(entity, Interactable, data => { data.enabled = false; }));
    const click = vi.fn(); app.getResource(UIEvents).on(entity, 'click', click);
    input.noteMouseDown(0); await app.tick(1 / 60);
    expect(app.world.get(entity, UIInteraction).pressed).toBe(false);
    input.clearFrameState();
    app.world.update(entity, Interactable, data => { data.enabled = true; });
    input.noteMouseUp(0); await app.tick(1 / 60);
    expect(click).not.toHaveBeenCalled();
  });
  it.each(['control', 'surface'])('clears capture when the %s is switched off', async (reason) => {
    const { app } = bootMockApp(); const input = new InputState();
    const overlay = { active: true, surfaceH: 600 } as any;
    app.insertResource(Input, input);
    app.insertResource(UICameraInfo, { valid: false } as any);
    app.insertResource(ScreenOverlay, overlay);
    app.insertResource(UILayoutGeneration, { generation: 0 });
    uiInteractionPlugin.build(app); flushPendingRegistrations(app);
    expect(getComponent('UIInteraction')).toBe(UIInteraction);
    const entity = app.world.spawn();
    app.world.insert(entity, Interactable, { enabled: true }); hit.entity = entity;
    input.noteMouseDown(0); await app.tick(1 / 60); input.clearFrameState();
    expect(app.world.get(entity, UIInteraction).pressed).toBe(true);
    expect(inspectableTypes(app.world, entity)).not.toContain('UIInteraction');
    expect(inspectableTypes(app.world, entity, true)).toContain('UIInteraction');
    if (reason === 'control') app.world.update(entity, Interactable, data => { data.enabled = false; });
    else overlay.active = false;
    await app.tick(1 / 60);
    expect(app.world.get(entity, UIInteraction)).toMatchObject({ hovered: false, pressed: false, justPressed: false, justReleased: false });
    expect(input.pointerOverUI).toBe(false);
    if (reason === 'control') app.world.update(entity, Interactable, data => { data.enabled = true; });
    else overlay.active = true;
    await app.tick(1 / 60);
    expect(app.world.get(entity, UIInteraction)).toMatchObject({ hovered: true, pressed: false });
  });
  it('cancels disabled parent capture and focus, and re-hits a stationary pointer on restore', async () => {
    const { app } = bootMockApp();
    const input = new InputState();
    app.insertResource(Input, input);
    app.insertResource(UICameraInfo, { valid: false } as any);
    app.insertResource(ScreenOverlay, { active: true, surfaceH: 600 } as any);
    app.insertResource(UILayoutGeneration, { generation: 0 });
    uiInteractionPlugin.build(app); focusPlugin.build(app); flushPendingRegistrations(app);
    const parent = app.world.spawn(), entity = app.world.spawn();
    app.world.setParent(entity, parent);
    app.world.insert(entity, Interactable, { enabled: true });
    app.world.insert(entity, Focusable, {});
    hit.entity = entity;
    const gesture = vi.fn(); onGestureClick(app.world, entity, gesture);
    const clicked = vi.fn(); app.getResource(UIEvents).on(entity, 'click', clicked);
    input.noteMouseDown(0); await app.tick(1 / 60); input.clearFrameState();
    expect(app.world.get(entity, UIInteraction)).toMatchObject({ hovered: true, pressed: true });
    expect(app.getResource(FocusManager).focusedEntity).toBe(entity);
    setEntityActive(app.world, parent, false);
    // The host's release can run before another frame observes the switch.
    inputRouter.dispatchPointerUp(0); expect(gesture).not.toHaveBeenCalled();
    await app.tick(1 / 60);
    expect(app.world.get(entity, UIInteraction)).toMatchObject({ hovered: false, pressed: false, justPressed: false, justReleased: false });
    expect(app.getResource(FocusManager).focusedEntity).toBeNull();
    expect(app.world.get(entity, Focusable).isFocused).toBe(false);
    expect(input.pointerOverUI).toBe(false);
    setEntityActive(app.world, parent, true);
    await app.tick(1 / 60);
    expect(app.world.get(entity, UIInteraction)).toMatchObject({ hovered: true, pressed: false });
    input.noteMouseUp(0); await app.tick(1 / 60);
    expect(clicked).not.toHaveBeenCalled();
    expect(gesture).not.toHaveBeenCalled();
  });
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
