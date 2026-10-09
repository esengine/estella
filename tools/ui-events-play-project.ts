// SPDX-License-Identifier: Apache-2.0
// Disposable browser game script: reactions are driven by real UI clicks.
import { addSystemToSchedule, defineSystem, Schedule, Res, GetWorld, UIEvents, Text, UINode, Transform, UIVisual, Interactable, Focusable, px, type Entity, type UIEventQueue, type World } from 'esengine';
const installed = new WeakSet<World>();
addSystemToSchedule(Schedule.Update, defineSystem([Res(UIEvents), GetWorld()], (events: UIEventQueue, world: World) => {
  if (installed.has(world)) return;
  const inside = world.findEntityByName('Inside');
  if (inside === null) return;
  installed.add(world);
  const partial = world.findEntityByName('Partial')!;
  const inner = world.findEntityByName('InnerMask')!;
  let count = 0, dynamic: Entity | null = null;
  events.on(inside, 'click', () => {
    count++;
    world.insert(inside, Text, { ...world.get(inside, Text), content: `Clicks ${count}` });
    world.insert(inside, UINode, { ...world.get(inside, UINode), width: px(count % 2 ? 160 : 120) });
    if (dynamic !== null) { world.despawn(dynamic); dynamic = null; }
    else {
      dynamic = world.spawn('Runtime button');
      world.insert(dynamic, Transform, {});
      world.insert(dynamic, UINode, { position: 1, width: px(150), height: px(32), insetLeft: px(20), insetTop: px(125) });
      world.insert(dynamic, UIVisual, { visualType: 1, color: { r: 0.2, g: 0.55, b: 0.3, a: 1 } });
      world.insert(dynamic, Text, { content: 'Runtime button', fontFamily: 'Arial', fontSize: 16 });
      world.insert(dynamic, Interactable, { enabled: true, raycastTarget: true, blockRaycast: true });
      world.insert(dynamic, Focusable, { tabIndex: 2 });
      world.setParent(dynamic, inner);
    }
  });
  events.on(inner, 'click', event => {
    if (event.target === partial) { event.stopPropagation(); event.preventDefault(); }
  });
}, { name: 'UIEventPlayVerification' }));
