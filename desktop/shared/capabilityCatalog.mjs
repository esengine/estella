// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  capabilityCatalog.mjs
 *        Semantic capabilities — the layer above the tool catalog.
 *
 *        A tool is an atom: set_field, add_component, create_entity. A model
 *        reasoning in atoms spends its reasoning on assembly. A CAPABILITY is
 *        the thing a person would ask for — "make this a physics body", "wire
 *        this button" — named once, so the model reasons about the game instead.
 *
 *        THE CONSTRAINT THAT MAKES THIS SAFE: a capability is a program over
 *        DECLARED TOOLS and nothing else. Its `run` receives one argument it can
 *        act through — `call(tool, input)` — and no editor surface, no imports,
 *        no store. So a capability cannot add editing truth, cannot skip
 *        validation, and cannot behave differently from the UI doing the same
 *        thing; it can only sequence what already exists.
 *
 *        That is not a style rule. The last time two doors reached the same
 *        operation by different routes, one of them silently created prefab
 *        COPIES while reporting success (see sceneOps.ts). A capability layer
 *        implemented as "helper functions that call the surface" would be that
 *        bug with a bigger surface area; `check-capabilities.mjs` holds the line
 *        by refusing a step that names a tool the catalog does not have.
 *
 *        UI, Agent and MCP therefore stay one path:
 *
 *            Capabilities  →  Tools  →  EditorControlSurface
 *                 ↑             ↑
 *              UI/Agent/MCP   UI/Agent/MCP
 */

const obj = (properties, required = []) => ({ type: 'object', properties, required });

/**
 * Every capability, in the order a model should meet them.
 *
 * `effect` follows the same tiers as tools and must be the WORST of the steps it
 * runs: a capability that writes a file is `journaled` however undoable its
 * other steps are, because that is the one the undo stack does not reach.
 */
/** Where on the screen a HUD element sits, as insets from the edges it hugs. */
const HUD_ANCHORS = {
  'top-left': { insetTop: 1, insetLeft: 1, align: 'Left', verticalAlign: 'Top' },
  top: { insetTop: 1, insetLeft: 0, insetRight: 0, align: 'Center', verticalAlign: 'Top' },
  'top-right': { insetTop: 1, insetRight: 1, align: 'Right', verticalAlign: 'Top' },
  left: { insetLeft: 1, insetTop: 0, insetBottom: 0, align: 'Left', verticalAlign: 'Middle' },
  center: { insetLeft: 0, insetRight: 0, insetTop: 0, insetBottom: 0, align: 'Center', verticalAlign: 'Middle' },
  right: { insetRight: 1, insetTop: 0, insetBottom: 0, align: 'Right', verticalAlign: 'Middle' },
  'bottom-left': { insetBottom: 1, insetLeft: 1, align: 'Left', verticalAlign: 'Bottom' },
  bottom: { insetBottom: 1, insetLeft: 0, insetRight: 0, align: 'Center', verticalAlign: 'Bottom' },
  'bottom-right': { insetBottom: 1, insetRight: 1, align: 'Right', verticalAlign: 'Bottom' },
};

export const CAPABILITIES = [
  {
    name: 'create_hud_text',
    effect: 'undoable',
    description:
      'Put a label on the SCREEN — score, lives, a wave counter — anchored to a corner or edge and staying there at '
      + 'any window size. This is not the same job as a label in the world, and doing it with world coordinates is the '
      + 'single most repeated way a HUD ends up invisible: the world origin is the middle of the view, so screen-style '
      + 'coordinates put a HUD hundreds of units above the top edge, and `Transform.position` on a UI node is OWNED BY '
      + 'THE LAYOUT — it is accepted, overwritten at the next relayout, and nothing reports it. '
      + '`at` is one of top-left, top, top-right, left, center, right, bottom-left, bottom, bottom-right. '
      + 'Reuses the scene\'s Canvas or makes one. For a label that belongs IN the world (a nameplate over a unit), use '
      + 'a Sprite-side Text instead — there Transform.position is exactly how it is placed.',
    schema: obj({
      text: { type: 'string' },
      at: { type: 'string', description: 'corner or edge (default top-left)' },
      margin: { type: 'number', description: 'px from the edges it hugs (default 24)' },
      fontSize: { type: 'number' },
      color: { type: 'string', description: '"#rrggbbaa"' },
      name: { type: 'string', description: 'entity name (defaults to the text)' },
      canvas: { type: 'number', description: 'an existing Canvas entity to put it under' },
    }, ['text']),
    async run(input, call) {
      const at = input.at ?? 'top-left';
      const anchor = HUD_ANCHORS[at];
      if (!anchor) {
        throw new Error(`create_hud_text: \`at\` must be one of ${Object.keys(HUD_ANCHORS).join(', ')}`);
      }
      const margin = input.margin ?? 24;

      let canvas = input.canvas;
      if (canvas == null) {
        // A Canvas is a root in every scene that has one, and `kind` cannot tell
        // one from any other UI node — so the roots get asked, and only the roots.
        const tree = await call('get_scene_tree', {});
        const roots = Array.isArray(tree) ? tree : tree?.nodes ?? tree?.children ?? [];
        for (const node of roots) {
          const entity = await call('get_entity', { id: node.id });
          if ((entity?.components ?? []).some((c) => (c.type ?? c) === 'Canvas')) { canvas = node.id; break; }
        }
      }

      const fields = {
        'UINode.position': 'Absolute',
        'Text.content': input.text,
        'Text.align': anchor.align,
        'Text.verticalAlign': anchor.verticalAlign,
      };
      // Writing a dimension's `value` gives it a px unit; a dimension left Auto
      // IGNORES the number, which is how three labels end up stacked at one point.
      for (const side of ['insetTop', 'insetRight', 'insetBottom', 'insetLeft']) {
        if (anchor[side] === undefined) continue;
        fields[`UINode.${side}.value`] = anchor[side] * margin;
      }
      if (input.fontSize !== undefined) fields['Text.fontSize'] = input.fontSize;
      if (input.color !== undefined) fields['Text.color'] = input.color;

      const ops = [];
      if (canvas == null) ops.push({ op: 'create', ref: 'canvas', template: 'canvas', name: 'Canvas' });
      ops.push({
        op: 'create',
        ref: 'label',
        template: 'ui-text',
        name: input.name ?? input.text,
        parent: canvas == null ? '$canvas' : canvas,
        fields,
      });

      const built = await call('apply_scene_ops', { ops, label: 'Create HUD text' });
      return {
        entity: built.refs.label,
        canvas: canvas ?? built.refs.canvas,
        at,
        createdCanvas: canvas == null,
        ...(built.warnings ? { warnings: built.warnings } : {}),
      };
    },
  },

  {
    name: 'playtest',
    effect: 'irreversible',
    description:
      'Run the game and LOOK at it: enters Play if it is not already running, sends the input you name, steps a fixed '
      + 'number of frames, then reads the world and returns a text picture of the screen. '
      + 'This is the loop that tells you whether what you built works, and skipping the looking half is how a run ends '
      + 'with every call reporting success against an empty screen. The picture comes back as TEXT (a coarse colour '
      + 'grid), so it is readable whether or not you can see images. '
      + '`probe` is an expression evaluated in the running game — `find`, `get`, `set`, `resource` are in scope. '
      + '`input` is a list of { kind, x, y, button, code } as play_input takes them.',
    schema: obj({
      frames: { type: 'number', description: 'frames to step after the input (default 30)' },
      input: { type: 'array', description: 'play_input specs, sent in order before stepping' },
      probe: { type: 'string', description: 'an expression to evaluate in the running game afterwards' },
      cols: { type: 'number', description: 'text-picture width in cells (default 48)' },
      rows: { type: 'number', description: 'text-picture height in cells' },
    }),
    async run(input, call) {
      const before = await call('get_play_state', {});
      const wasPlaying = before?.playing === true;
      if (!wasPlaying) await call('set_play', { state: 'playing' });

      for (const one of input.input ?? []) await call('play_input', one);

      const stepped = await call('step', { frames: input.frames ?? 30 });
      const probe = input.probe === undefined ? undefined : await call('play_probe', { code: input.probe });
      const picture = await call('screenshot', {
        format: 'grid',
        ...(input.cols !== undefined ? { cols: input.cols } : {}),
        ...(input.rows !== undefined ? { rows: input.rows } : {}),
      });

      return {
        enteredPlay: !wasPlaying,
        stepped,
        ...(probe !== undefined ? { probe } : {}),
        picture,
      };
    },
  },

  {
    name: 'create_prefab',
    effect: 'journaled',
    description:
      'Build an entity subtree and extract it as a reusable `.esprefab` in one step — the whole point being that '
      + 'what you build once becomes an INSTANCE everywhere else (the scene stores a delta, not a copy). '
      + '`ops` is an apply_scene_ops program; name its root with `ref: "root"` (or pass `rootRef`). '
      + 'Returns the prefab ref and the template id to create instances with.',
    schema: obj({
      name: { type: 'string', description: 'the prefab asset name — also the root entity name' },
      ops: { type: 'object', description: 'apply_scene_ops program building the subtree' },
      rootRef: { type: 'string', description: 'which ref is the subtree root (default "root")' },
      replace: { type: 'boolean', description: 'overwrite an existing prefab of this name, keeping its uuid' },
    }, ['name', 'ops']),
    async run(input, call) {
      const rootRef = input.rootRef ?? 'root';
      const built = await call('apply_scene_ops', { ops: input.ops });
      const root = built?.refs?.[rootRef];
      if (root == null) {
        throw new Error(
          `create_prefab: the program defined no ref "${rootRef}" — give the root op \`ref: "${rootRef}"\``
          + `${built?.refs ? ` (it defined: ${Object.keys(built.refs).join(', ') || 'none'})` : ''}`,
        );
      }
      await call('rename_entity', { id: root, name: input.name });
      const prefab = await call('create_prefab_from_entity', { entity: root, replace: input.replace === true });
      return { entity: root, prefab, template: `prefab:assets/prefabs/${input.name}.esprefab`, refs: built.refs };
    },
  },

  {
    name: 'configure_physics_body',
    effect: 'undoable',
    description:
      'Make an entity a physics body with a collider, in the terms physics is discussed in rather than in component '
      + 'fields: `body` is "dynamic" | "kinematic" | "static", `shape` is "box" | "circle". Adds RigidBody and the '
      + 'collider if absent and sets them together, so an entity is never left half-configured — a body with no '
      + 'collider falls through the world, which looks like a physics bug and is a missing second component.',
    schema: obj({
      entity: { type: 'number' },
      body: { type: 'string', description: 'dynamic | kinematic | static (default dynamic)' },
      shape: { type: 'string', description: 'box | circle (default box)' },
      size: { type: ['number', 'array'], description: 'box half-extents [w, h], or a circle radius' },
      sensor: { type: 'boolean', description: 'a trigger: reports contacts, blocks nothing' },
      gravityScale: { type: 'number' },
      fixedRotation: { type: 'boolean' },
    }, ['entity']),
    async run(input, call) {
      // The body type goes over as its NAME. set_field resolves an enum by label
      // already, so an ordinal table here would be a second copy of the enum —
      // right until someone inserts a member and only this file still says 2.
      const BODIES = ['static', 'kinematic', 'dynamic'];
      const body = input.body ?? 'dynamic';
      if (!BODIES.includes(body)) throw new Error(`configure_physics_body: body must be one of ${BODIES.join(', ')}`);
      const shape = input.shape ?? 'box';
      const collider = shape === 'circle' ? 'CircleCollider' : shape === 'box' ? 'BoxCollider' : null;
      if (!collider) throw new Error('configure_physics_body: shape must be "box" or "circle"');

      const before = await call('get_entity', { id: input.entity });
      const has = (type) => Array.isArray(before?.components) && before.components.some((c) => (c.type ?? c) === type);

      const ops = [];
      if (!has('RigidBody')) ops.push({ op: 'add_component', entity: input.entity, component: 'RigidBody' });
      if (!has(collider)) ops.push({ op: 'add_component', entity: input.entity, component: collider });

      const fields = { 'RigidBody.bodyType': body };
      if (input.gravityScale !== undefined) fields['RigidBody.gravityScale'] = input.gravityScale;
      if (input.fixedRotation !== undefined) fields['RigidBody.fixedRotation'] = input.fixedRotation;
      if (input.sensor !== undefined) fields[`${collider}.isSensor`] = input.sensor;
      if (input.size !== undefined) {
        if (shape === 'circle') fields['CircleCollider.radius'] = input.size;
        else fields['BoxCollider.halfExtents'] = input.size;
      }
      ops.push({ op: 'set', entity: input.entity, fields });

      await call('apply_scene_ops', { ops });
      return { entity: input.entity, body, collider };
    },
  },

  {
    name: 'wire_ui_event',
    effect: 'undoable',
    description:
      'Give an entity behaviour without code by wiring one event to one action, ADDING to what it already has rather '
      + 'than replacing it — which is the difference from set_event_bindings, whose whole-list semantics silently drop '
      + 'the wires you did not resend. `event` is "click", "pointerEnter", … and `action` is any name in the action '
      + 'registry (property.set, ui.setVisible, fsm.fire, or one the project registered). Pass `replace` to mean the '
      + 'old behaviour deliberately.',
    schema: obj({
      entity: { type: 'number' },
      event: { type: 'string' },
      action: { type: 'string' },
      params: { type: 'object' },
      target: { type: 'string', description: 'another entity by name to run the action on' },
      replace: { type: 'boolean', description: 'drop the existing wires instead of adding to them' },
    }, ['entity', 'event', 'action']),
    async run(input, call) {
      const existing = input.replace === true ? [] : (await call('get_event_bindings', { entity: input.entity })) ?? [];
      const rows = Array.isArray(existing) ? [...existing] : [];
      rows.push({
        event: input.event,
        action: input.action,
        ...(input.params ? { params: input.params } : {}),
        ...(input.target ? { target: input.target } : {}),
      });
      await call('set_event_bindings', { entity: input.entity, rows });
      return { entity: input.entity, rows: rows.length };
    },
  },

  {
    name: 'create_behavior',
    effect: 'journaled',
    description:
      'Author a gameplay behaviour and attach it. A behaviour is a component plus its update loop, and getting one into '
      + 'a project is three steps that each look complete on their own: create_script makes the file AND wires it into '
      + "the project's declaration entry (a .ts file nothing imports is a file the editor never sees), write_project_file "
      + 'puts your logic in it, and the component still has to be ADDED to something. Doing one or two of those is how a '
      + 'behaviour ends up existing and doing nothing. Returns the path and the TypeScript errors in it.',
    schema: obj({
      name: { type: 'string', description: 'behaviour name, e.g. "EnemyChase" — also the component name' },
      state: { type: 'object', description: 'per-entity tunable state, as a default-valued object literal' },
      update: { type: 'string', description: 'the body of update(ctx, dt) — TypeScript source' },
      attachTo: { type: 'object', description: 'entity ids to put the behaviour on' },
    }, ['name', 'update']),
    async run(input, call) {
      const state = JSON.stringify(input.state ?? {}, null, 4).replace(/\n/g, '\n    ');
      const source = [
        `import { defineBehavior } from 'esengine';`,
        '',
        `export const ${input.name} = defineBehavior('${input.name}', {`,
        `    state: ${state},`,
        '    update(ctx, dt) {',
        ...String(input.update).split('\n').map((line) => `        ${line}`),
        '    },',
        '});',
        '',
      ].join('\n');

      // create_script FIRST, for its wiring: it registers the module in the
      // project's declaration entry, which is what makes the component addable
      // at all. write_project_file then replaces the scaffold it wrote.
      const made = await call('create_script', { kind: 'component', name: input.name });
      if (!made?.ok || !made.path) {
        throw new Error(`create_behavior: ${made?.error ?? 'create_script did not report a path'}`);
      }
      const written = await call('write_project_file', { path: made.path, content: source });

      const attach = Array.isArray(input.attachTo) ? input.attachTo : [];
      if (attach.length > 0) {
        await call('apply_scene_ops', {
          ops: attach.map((entity) => ({ op: 'add_component', entity, component: input.name })),
        });
      }
      return {
        name: input.name,
        path: made.path,
        wiredInto: made.wiredInto,
        errors: written?.errors ?? [],
        attached: attach.length,
      };
    },
  },
];

export const capabilityByName = (name) => CAPABILITIES.find((c) => c.name === name);

/** Same shape `listTools` produces, so a front serves both from one list. */
export function listCapabilities(allowWrites = false) {
  return CAPABILITIES.filter((c) => allowWrites || (c.effect ?? 'read') === 'read')
    .map((c) => ({ name: c.name, description: c.description, inputSchema: c.schema }));
}

/**
 * The tools each capability calls, read off its own source rather than declared
 * beside it — a declaration is a second thing to keep in sync. The gate proves
 * each name exists and that `effect` is no gentler than the steps.
 */
export function capabilityStepNames() {
  return CAPABILITIES.map((cap) => ({
    name: cap.name,
    effect: cap.effect ?? 'read',
    steps: [...new Set([...String(cap.run).matchAll(/call\(\s*'([a-z_]+)'/g)].map((m) => m[1]))].sort(),
  }));
}
