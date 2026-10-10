// SPDX-License-Identifier: Apache-2.0
// Disposable browser game script: reactions are driven by real UI clicks.
import { addSystemToSchedule, defineSystem, Schedule, Res, GetWorld, UIEvents, Text, UINode, Transform, UIVisual, Interactable, Focusable, px, Input, FocusManager, UIDialog, UIDisplay, createTextInput, Name, TextInput, type TextInputHandle, type InputState, type FocusManagerState, type Entity, type UIEventQueue, type World } from 'esengine';
import { Localization, type LocalizationAPI, type TextData } from 'esengine';
import { applyTextLocalization } from '../sdk/src/ui/text/localize';
const installed = new WeakMap<World, () => void>();
addSystemToSchedule(Schedule.Update, defineSystem([Res(UIEvents), GetWorld(), Res(Input), Res(FocusManager), Res(Localization)], (events: UIEventQueue, world: World, input: InputState, focus: FocusManagerState, locale: LocalizationAPI) => {
  const update = installed.get(world);
  if (update) { update(); return; }
  const inside = world.findEntityByName('Inside');
  if (inside === null) return;
  const partial = world.findEntityByName('Partial')!;
  const inner = world.findEntityByName('InnerMask')!;
  let count = 0, dynamic: Entity | null = null, dialogHost: Entity | null = null, nested: Entity | null = null;
  let textField: TextInputHandle | null = null;
  const restore = new Set<Entity>();
  locale.addCatalog('en', { caption: 'Settings', hint: 'Your name' });
  locale.addCatalog('zh', { caption: '设置', hint: '请输入姓名' });
  let localized = false, preview = false;
  const boundText = { getEntitiesWithComponents: () => [inside],
    get: (entity: Entity) => world.get(entity, Text),
    insert: (entity: Entity, _component: unknown, data: unknown) => world.insert(entity, Text, data as TextData) };
  installed.set(world, () => {
    if (localized) applyTextLocalization(boundText, locale);
    // Fixture shortcuts must not react to letters typed into an engine field.
    if (focus.focusedEntity !== null && world.has(focus.focusedEntity, TextInput)) return;
    if (input.isKeyPressed('KeyL')) {
      localized = true;
      world.insert(inside, Text, { ...world.get(inside, Text), i18nKey: 'caption' });
      locale.setLocale(locale.locale === 'en' ? 'zh' : 'en');
    }
    if (input.isKeyPressed('KeyP') && localized) {
      preview = !preview; locale.setPseudoLocalization(preview ? { expansion: 1 } : null);
    }
    if (input.isKeyPressed('KeyU') && localized) locale.addCatalog(locale.locale, { caption: 'Updated 更新', hint: 'Updated hint 更新提示' });
    if (input.isKeyPressed('KeyK')) {
      const text = world.get(inside, Text);
      const first = text.content !== 'A|B';
      world.insert(inside, Text, { ...text, content: first ? 'A|B' : 'A',
        fontFamily: first ? 'Arial' : 'B|Arial' });
    }
    if (input.isKeyPressed('KeyO')) {
      const text = world.get(inside, Text);
      world.insert(inside, Text, { ...text, content: 'Overflow mode changes cached text',
        wordWrap: false, overflow: (text.overflow + 1) % 3 });
    }
    if (input.isKeyPressed('KeyT')) {
      if (textField) { textField.dispose(); textField = null; }
      else {
        textField = createTextInput({ world, events, parent: world.findEntityByName('Canvas')!,
          node: { position: 1, width: px(260), height: px(34), insetLeft: px(40), insetTop: px(420) },
          placeholder: 'Type English / 中文', placeholderI18nKey: 'hint', fontFamily: 'Arial', fontSize: 18, tabIndex: 3,
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
    if (input.isKeyPressed('KeyN') && dynamic !== null && dialogHost !== null && world.valid(dynamic)) {
      // Real hierarchy: an outer modal contains a page button and a nested modal.
      world.remove(dynamic, UIDialog);
      world.insert(dialogHost, UIDialog, { closeOnEscape: false, closeOnBackdrop: false });
      if (nested === null) {
        nested = world.spawn('Nested confirm');
        world.insert(nested, Transform, {});
        world.insert(nested, UINode, { position: 1, width: px(150), height: px(32), insetLeft: px(20), insetTop: px(75) });
        world.insert(nested, UIVisual, { visualType: 1, color: { r: 0.55, g: 0.3, b: 0.15, a: 1 } });
        world.insert(nested, Text, { content: 'Nested confirm', fontFamily: 'Arial', fontSize: 16 });
        world.insert(nested, Interactable, { enabled: true, raycastTarget: true, blockRaycast: true });
        world.insert(nested, Focusable, { tabIndex: 4 });
        world.insert(nested, UIDialog, { closeOnEscape: false, closeOnBackdrop: false });
        world.setParent(nested, dialogHost);
        events.on(nested, 'click', () => {
          if (nested !== null) world.despawn(nested);
          nested = null;
        });
      }
    }
    if (input.isKeyPressed('KeyR') && dynamic !== null && world.valid(dynamic)) {
      world.remove(dynamic, UIDialog);
      if (dialogHost !== null) world.remove(dialogHost, UIDialog);
      if (nested !== null) world.despawn(nested);
      nested = null;
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
    if (dynamic !== null) { if (nested !== null) world.despawn(nested); nested = null; world.despawn(dynamic); dynamic = null; if (dialogHost !== null) world.despawn(dialogHost); dialogHost = null; }
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
