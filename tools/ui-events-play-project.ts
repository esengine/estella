// SPDX-License-Identifier: Apache-2.0
// Disposable browser game script: reactions are driven by real UI clicks.
import { addSystemToSchedule, defineSystem, Schedule, Res, GetWorld, UIEvents, Text, UINode, px, type UIEventQueue, type World } from 'esengine';
const installed = new WeakSet<World>();
addSystemToSchedule(Schedule.Update, defineSystem([Res(UIEvents), GetWorld()], (events: UIEventQueue, world: World) => {
  if (installed.has(world)) return;
  const inside = world.findEntityByName('Inside');
  if (inside === null) return;
  installed.add(world);
  const partial = world.findEntityByName('Partial')!;
  const inner = world.findEntityByName('InnerMask')!;
  let count = 0;
  events.on(inside, 'click', () => {
    count++;
    world.insert(inside, Text, { ...world.get(inside, Text), content: `Clicks ${count}` });
    world.insert(inside, UINode, { ...world.get(inside, UINode), width: px(count % 2 ? 160 : 120) });
  });
  events.on(inner, 'click', event => {
    if (event.target === partial) { event.stopPropagation(); event.preventDefault(); }
  });
}, { name: 'UIEventPlayVerification' }));
