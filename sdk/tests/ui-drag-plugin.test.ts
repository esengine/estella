// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  DragPlugin's pointer-drag state machine, driven through the mock-wasm
 *        App harness. The drag lifecycle — hit test → arm on press → cross the
 *        threshold to begin → move the target → release to end — is all TS logic
 *        over the Input + UICameraInfo resources and the Draggable/UIInteraction
 *        components, so it runs without a native binary. Assertions are on the
 *        observable state (DragState.isDragging, Transform.position) rather than
 *        the emitted events.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { flushPendingRegistrations } from '../src/app/app';
import type { App } from '../src/app/app';
import { Transform } from '../src/ecs/component';
import { Input, InputState } from '../src/input/input';
import { UIEvents, UIEventQueue } from '../src/ui/core/events';
import { UICameraInfo } from '../src/ui/core/ui-camera-info';
import type { UICameraData } from '../src/ui/core/ui-camera-info';
import { Draggable, DragState } from '../src/ui/input/draggable';
import type { DragStateData } from '../src/ui/input/draggable';
import { UIInteraction } from '../src/ui/input/interactable';
import { dragPlugin } from '../src/ui/input/drag';
import { bootMockApp } from './helpers/mockApp';
import type { Entity } from '../src/types';

let app: App;

beforeEach(() => {
  app = bootMockApp().app;
  app.insertResource(Input, new InputState());
  app.insertResource(UIEvents, new UIEventQueue());
  // A 1:1 world↔screen camera (100 world units == 100 screen px) so the default
  // 5px drag threshold maps to 5 world units.
  app.insertResource(UICameraInfo, {
    vpX: 0, vpY: 0, vpW: 100, vpH: 100,
    worldLeft: 0, worldBottom: 0, worldRight: 100, worldTop: 100,
    worldMouseX: 0, worldMouseY: 0, valid: true,
  } as UICameraData);
  dragPlugin.build(app); // reads UIEvents; registers Draggable/DragState; adds DragSystem
  flushPendingRegistrations(app);
});

function draggable(opts: Partial<{ enabled: boolean; dragThreshold: number; lockX: boolean; lockY: boolean; hovered: boolean }> = {}): Entity {
  const e = app.world.spawn();
  app.world.insert(e, Draggable, {
    enabled: opts.enabled ?? true,
    dragThreshold: opts.dragThreshold ?? 5,
    lockX: opts.lockX ?? false,
    lockY: opts.lockY ?? false,
    constraintMin: null,
    constraintMax: null,
  });
  app.world.insert(e, UIInteraction, { hovered: opts.hovered ?? true });
  app.world.insert(e, Transform, { position: { x: 0, y: 0, z: 0 }, worldPosition: { x: 0, y: 0, z: 0 } });
  return e;
}

const input = (): InputState => app.getResource(Input) as InputState;
const cam = (): UICameraData => app.getResource(UICameraInfo) as UICameraData;
const dragOf = (e: Entity): DragStateData => app.world.get(e, DragState) as DragStateData;
const posX = (e: Entity): number => (app.world.get(e, Transform) as { position: { x: number } }).position.x;
const posY = (e: Entity): number => (app.world.get(e, Transform) as { position: { y: number } }).position.y;

// No inputPlugin runs here, so nothing auto-clears the per-frame press/release
// edges — we consume them ourselves after each tick, exactly as end-of-frame
// would. Without this the "pressed" edge sticks and re-arms the drag every tick.
async function step(): Promise<void> {
  await app.tick(1 / 60);
  const i = input();
  i.mouseButtonsPressed.clear();
  i.mouseButtonsReleased.clear();
}

async function press(x = 0, y = 0): Promise<void> {
  cam().worldMouseX = x; cam().worldMouseY = y;
  input().mouseButtons.add(0);
  input().mouseButtonsPressed.add(0);
  await step();
}
async function hold(x: number, y: number): Promise<void> {
  cam().worldMouseX = x; cam().worldMouseY = y;
  input().mouseButtons.add(0); // still held; the press edge was already consumed
  await step();
}
async function release(x: number, y: number): Promise<void> {
  cam().worldMouseX = x; cam().worldMouseY = y;
  input().mouseButtons.delete(0);
  input().mouseButtonsReleased.add(0);
  await step();
}

describe('DragPlugin lifecycle', () => {
  it('does not begin dragging while movement stays under the threshold', async () => {
    const e = draggable({ dragThreshold: 5 });
    await press(0, 0);
    await hold(3, 0); // 3px < 5px threshold
    expect(dragOf(e).isDragging).toBe(false);
    expect(posX(e)).toBe(0); // target unmoved
  });

  it('begins dragging past the threshold and moves the target with the pointer', async () => {
    const e = draggable({ dragThreshold: 5 });
    await press(0, 0);
    await hold(10, 0); // crosses threshold ⇒ drag starts and the move applies same frame
    expect(dragOf(e).isDragging).toBe(true);
    expect(posX(e)).toBeCloseTo(10, 5);
    await hold(25, 0);
    expect(posX(e)).toBeCloseTo(25, 5); // follows the pointer
  });

  it('releasing the button ends the drag', async () => {
    const e = draggable();
    await press(0, 0);
    await hold(20, 0);
    expect(dragOf(e).isDragging).toBe(true);
    await release(20, 0);
    expect(dragOf(e).isDragging).toBe(false);
  });

  it('lockX pins the X axis while Y still tracks', async () => {
    const e = draggable({ lockX: true });
    await press(0, 0);
    await hold(20, 15); // past threshold diagonally
    expect(dragOf(e).isDragging).toBe(true);
    expect(posX(e)).toBeCloseTo(0, 5);  // X locked to the start
    expect(posY(e)).toBeCloseTo(15, 5); // Y free
  });
});

describe('DragPlugin hit-test gating', () => {
  it('ignores a disabled Draggable', async () => {
    const e = draggable({ enabled: false });
    await press(0, 0);
    await hold(20, 0);
    expect(app.world.has(e, DragState)).toBe(false); // never armed
    expect(posX(e)).toBe(0);
  });

  it('ignores a Draggable that is not hovered', async () => {
    const e = draggable({ hovered: false });
    await press(0, 0);
    await hold(20, 0);
    expect(app.world.has(e, DragState)).toBe(false);
    expect(posX(e)).toBe(0);
  });
});
