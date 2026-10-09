// SPDX-License-Identifier: Apache-2.0
// Disposable browser game script: reactions are driven by real UI clicks.
import { addSystemToSchedule, defineSystem, Schedule, Res, GetWorld, UIEvents, Text, UINode, Transform, UIVisual, Interactable, Focusable, px, Input, FocusManager, UIDialog, UIDisplay, createTextInput, Name, TextInput, type TextInputHandle, type InputState, type FocusManagerState, type Entity, type UIEventQueue, type World } from 'esengine';
const installed = new WeakMap<World, () => void>();
addSystemToSchedule(Schedule.Update, defineSystem([Res(UIEvents), GetWorld(), Res(Input), Res(FocusManager)], (events: UIEventQueue, world: World, input: InputState, focus: FocusManagerState) => {
  const update = installed.get(world);
  if (update) { update(); return; }
  const inside = world.findEntityByName('Inside');
  if (inside === null) return;
  const partial = world.findEntityByName('Partial')!;
  const inner = world.findEntityByName('InnerMask')!;
  let count = 0, dynamic: Entity | null = null, dialogHost: Entity | null = null;
  let textField: TextInputHandle | null = null;
  const restore = new Set<Entity>();
  installed.set(world, () => {
    // Fixture shortcuts must not react to letters typed into an engine field.
    if (focus.focusedEntity !== null && world.has(focus.focusedEntity, TextInput)) return;
    if (input.isKeyPressed('KeyT')) {
      if (textField) { textField.dispose(); textField = null; }
      else {
        textField = createTextInput({ world, events, parent: world.findEntityByName('Canvas')!,
          node: { position: 1, width: px(260), height: px(34), insetLeft: px(40), insetTop: px(420) },
          placeholder: 'Type English / 中文', fontFamily: 'Arial', fontSize: 18, tabIndex: 3,
          onChange: value => world.insert(inside, Text, { ...world.get(inside, Text), content: `Input ${value}` }),
          onSubmit: value => world.insert(inside, Text, { ...world.get(inside, Text), content: `Submit ${value}` }),
        });
        world.insert(textField.entity, Name, { value: 'Runtime input' });
      }
    }
    if (input.isKeyPressed('KeyM') && dynamic !== null && world.valid(dynamic)) {
      world.insert(dynamic, UIDialog, { closeOnEscape: false, closeOnBackdrop: false });
      world.insert(dynamic, Text, { ...world.get(dynamic, Text), content: 'Dialog confirm' });
    }
    if (input.isKeyPressed('KeyR') && dynamic !== null && world.valid(dynamic)) {
      world.remove(dynamic, UIDialog);
      world.insert(dynamic, Text, { ...world.get(dynamic, Text), content: 'Runtime button' });
    }
    if (dialogHost !== null && world.valid(dialogHost)) {
      if (input.isKeyPressed('KeyH')) world.insert(dialogHost, UINode, { ...world.get(dialogHost, UINode), display: UIDisplay.None });
      if (input.isKeyPressed('KeyV')) world.insert(dialogHost, UINode, { ...world.get(dialogHost, UINode), display: UIDisplay.Flex });
    }
    if (input.isKeyPressed('KeyD') && focus.focusedEntity !== null) {
      const entity = focus.focusedEntity;
      world.insert(entity, Interactable, { ...world.get(entity, Interactable), enabled: false });
      restore.add(entity);
    }
    if (input.isKeyPressed('KeyE')) {
      for (const entity of restore) if (world.valid(entity))
        world.insert(entity, Interactable, { ...world.get(entity, Interactable), enabled: true });
      restore.clear();
    }
  });
  events.on(inside, 'click', () => {
    count++;
    world.insert(inside, Text, { ...world.get(inside, Text), content: `Clicks ${count}` });
    world.insert(inside, UINode, { ...world.get(inside, UINode), width: px(count % 2 ? 160 : 120) });
    if (dynamic !== null) { world.despawn(dynamic); dynamic = null; if (dialogHost !== null) world.despawn(dialogHost); dialogHost = null; }
    else {
      dialogHost = world.spawn('Runtime dialog host');
      world.insert(dialogHost, Transform, {});
      world.insert(dialogHost, UINode, { position: 1, width: px(200), height: px(200), insetLeft: px(0), insetTop: px(0) });
      world.setParent(dialogHost, inner);
      dynamic = world.spawn('Runtime button');
      world.insert(dynamic, Transform, {});
      world.insert(dynamic, UINode, { position: 1, width: px(150), height: px(32), insetLeft: px(20), insetTop: px(125) });
      world.insert(dynamic, UIVisual, { visualType: 1, color: { r: 0.2, g: 0.55, b: 0.3, a: 1 } });
      world.insert(dynamic, Text, { content: 'Runtime button', fontFamily: 'Arial', fontSize: 16 });
      world.insert(dynamic, Interactable, { enabled: true, raycastTarget: true, blockRaycast: true });
      world.insert(dynamic, Focusable, { tabIndex: 2 });
      world.setParent(dynamic, dialogHost);
      const button = dynamic;
      events.on(button, 'click', () => {
        if (!world.valid(button) || !world.has(button, UIDialog)) return;
        world.remove(button, UIDialog);
        world.insert(button, Text, { ...world.get(button, Text), content: 'Dialog confirmed' });
      });
    }
  });
  events.on(inner, 'click', event => {
    if (event.target === partial) { event.stopPropagation(); event.preventDefault(); }
  });
}, { name: 'UIEventPlayVerification' }));
