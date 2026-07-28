// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  skeletalSync.ts
 * @brief Keeps the viewport's skeletal bindings a live projection of the model,
 *        the same way the Reconciler keeps the World one. Skeleton instances live
 *        OUTSIDE the World (per-entity bindings in a runtime's manager, loaded
 *        through the shared runtime loader), so World projection alone can't
 *        keep them true. This module subscribes to the SceneModel and:
 *
 *        - on `reset` (scene open / play-stop rebuild) re-binds every skeletal
 *          entity — the rebuild despawned the old runtime entities, which
 *          dropped their instances;
 *        - on a skeleton/atlas ref edit reloads that entity's binding through
 *          the SAME shared loader the scene load uses;
 *        - on animation/props edits applies them in place (live preview
 *          without restarting the animation on unrelated field scrubs).
 *
 *        Two runtimes reach the viewport this way, and every step above means the
 *        same thing for both — so the subscription is written once and the three
 *        places they differ (which manager holds the binding, which loader fills
 *        it, and what counts as a change) are an adapter picked per component.
 *        A component names its runtime in its skeletal descriptor.
 *
 *        ProjectStore installs it with the project's ref→URL transport; without
 *        an install every event is a no-op (dev/automation scene loads bind
 *        skeletons themselves, once).
 */
import { getComponentSkeletalFieldDescriptor } from 'esengine';
import { spineEntityProps } from 'esengine/spine';
import { dragonBonesEntityProps } from 'esengine/dragonbones';
import type { SceneData } from 'esengine';
import { SceneModel, type ModelEvent } from './SceneModel';
import { SceneStore } from './SceneStore';
import { EngineHost } from './EngineHost';

type SceneEntity = SceneData['entities'][number];

/** What an entity's binding was loaded/applied from, for change detection. */
interface BoundState {
  runtime: string;
  skel: string;
  atlas: string;
  /** Spine's skin, or DragonBones' armature — the field that selects WHICH
   *  figure inside the file, and so forces a rebind when it changes. */
  variant: string;
  animation: string;
  loop: boolean;
}

/**
 * The three things that differ between runtimes. Everything else in this file is
 * shared, which is the point of the split.
 */
interface RuntimeAdapter {
  /** Drop this entity's binding; a rebind will make a new one. */
  remove(runtimeId: number): void;
  /** Load these entities' bindings through the shared scene loader. */
  load(sceneData: SceneData, entityMap: Map<number, number>,
    toUrl: (ref: string) => string, resolvePath: (ref: string) => string): Promise<void>;
  /** Apply an in-place edit that did not change which file is bound. */
  apply(runtimeId: number, data: Record<string, unknown>, prev: BoundState, next: BoundState): void;
  /** The field selecting which figure inside the file this entity uses. */
  variantField: string;
}

const spineAdapter: RuntimeAdapter = {
  variantField: 'skin',
  remove: (rt) => EngineHost.spineManager?.removeEntity(rt as never),
  load: (sceneData, entityMap, toUrl, resolvePath) =>
    EngineHost.loadSpine(sceneData, entityMap, toUrl, resolvePath),
  apply: (rt, d, prev, next) => {
    const spine = EngineHost.spineManager;
    if (!spine) return;
    spine.setEntityProps(rt as never, spineEntityProps(d));
    if (prev.variant !== next.variant && next.variant) spine.setSkin(rt as never, next.variant);
    if (prev.animation !== next.animation || prev.loop !== next.loop) {
      if (next.animation) spine.setAnimation(rt as never, next.animation, next.loop);
    }
  },
};

const dragonBonesAdapter: RuntimeAdapter = {
  // Not a skin: a DragonBones file holds several armatures, and picking a
  // different one is a different figure — so it reloads rather than applies.
  variantField: 'armature',
  remove: (rt) => EngineHost.dragonBonesManager?.removeEntity(rt as never),
  load: (sceneData, entityMap, toUrl, resolvePath) =>
    EngineHost.loadDragonBones(sceneData, entityMap, toUrl, resolvePath),
  apply: (rt, d, prev, next) => {
    const db = EngineHost.dragonBonesManager;
    if (!db) return;
    db.setEntityProps(rt as never, dragonBonesEntityProps(d));
    if (prev.animation !== next.animation || prev.loop !== next.loop) {
      if (next.animation) {
        const fade = typeof d.fadeInTime === 'number' ? d.fadeInTime : 0;
        if (fade > 0) db.fadeIn(rt as never, next.animation, fade, next.loop);
        else db.play(rt as never, next.animation, next.loop);
      }
    }
  },
};

function adapterFor(runtime: string): RuntimeAdapter {
  return runtime === 'dragonbones' ? dragonBonesAdapter : spineAdapter;
}

/** The project transport skeletal assets load over: ref → fetchable URL, and
 *  `@uuid:` ref → project path (atlas image paths derive from the atlas dir). */
export interface SkeletalTransport {
  toUrl: (ref: string) => string;
  resolvePath: (ref: string) => string;
}

let transport: SkeletalTransport | null = null;
let subscribed = false;
const bound = new Map<number, BoundState>();
// Loads are async (fetch + decode + side-module init); serialize them so two
// rapid ref edits can't finish out of order and leave the older skeleton.
let chain: Promise<void> = Promise.resolve();

/**
 * Install (or re-target) the sync for the open project's transport. Call
 * BEFORE the scene adopt so the model's `reset` performs the initial bind.
 */
export function installSkeletalSync(t: SkeletalTransport): void {
  transport = t;
  bound.clear();
  if (!subscribed) {
    subscribed = true;
    SceneModel.subscribe(onEvent);
  }
}

function onEvent(ev: ModelEvent): void {
  if (!transport) return;
  switch (ev.kind) {
    case 'reset':
      rebindAll();
      return;
    case 'entityAdded': // duplicate / paste / undo-of-delete
      syncEntity(ev.sourceId);
      return;
    case 'componentAdded':
    case 'componentChanged':
      if (getComponentSkeletalFieldDescriptor(ev.type)) syncEntity(ev.sourceId);
      return;
    case 'componentRemoved':
      if (getComponentSkeletalFieldDescriptor(ev.type)) unbind(ev.sourceId);
      return;
    case 'entityRemoved':
      bound.delete(ev.sourceId); // the World despawn already dropped the instance
      return;
  }
}

/** The entity's skeletal component (any component with a skeletal descriptor). */
function skeletalComp(entity: SceneEntity): { type: string; d: Record<string, unknown> } | null {
  for (const c of entity.components ?? []) {
    if (getComponentSkeletalFieldDescriptor(c.type) && c.data) {
      return { type: c.type, d: c.data as Record<string, unknown> };
    }
  }
  return null;
}

function stateOf(type: string, d: Record<string, unknown>): BoundState {
  const desc = getComponentSkeletalFieldDescriptor(type)!;
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  return {
    runtime: desc.runtime,
    skel: str(d[desc.skeletonField]),
    atlas: str(d[desc.atlasField]),
    variant: str(d[adapterFor(desc.runtime).variantField]),
    animation: str(d.animation),
    loop: d.loop !== false,
  };
}

/** Re-bind every skeletal entity from the current model (scene open / play-stop). */
function rebindAll(): void {
  bound.clear();
  const data = SceneModel.current;
  if (!data) return;
  // Grouped by runtime: each loader discovers the pairs in the scene it is given,
  // so handing one a scene holding the other's entities would ask it to parse a
  // file it cannot read.
  const perRuntime = new Map<string, { entities: SceneEntity[]; entityMap: Map<number, number> }>();
  for (const e of data.entities) {
    const sc = skeletalComp(e);
    if (!sc) continue;
    const rt = SceneModel.runtimeFor(e.id);
    if (rt === undefined) continue;
    const next = stateOf(sc.type, sc.d);
    if (!next.skel || !next.atlas) continue;
    bound.set(e.id, next);
    let group = perRuntime.get(next.runtime);
    if (!group) {
      group = { entities: [], entityMap: new Map() };
      perRuntime.set(next.runtime, group);
    }
    group.entities.push(e);
    group.entityMap.set(e.id, rt as number);
  }
  for (const [runtime, group] of perRuntime) {
    load(runtime, { ...data, entities: group.entities }, group.entityMap);
  }
}

/** Project one entity's skeletal component: ref change → reload, else apply in place. */
function syncEntity(sourceId: number): void {
  const entity = SceneModel.entityBySource(sourceId);
  const rt = SceneModel.runtimeFor(sourceId);
  if (!entity || rt === undefined) return;
  const sc = skeletalComp(entity);
  if (!sc) return;

  const next = stateOf(sc.type, sc.d);
  const prev = bound.get(sourceId);
  const adapter = adapterFor(next.runtime);
  bound.set(sourceId, next);

  // A variant change is a rebind for DragonBones (a different armature is a
  // different instance) but not for Spine (a skin is swapped on the one it has).
  const variantForcesReload = next.runtime === 'dragonbones' && prev?.variant !== next.variant;
  if (!prev || prev.skel !== next.skel || prev.atlas !== next.atlas || variantForcesReload) {
    adapter.remove(rt as number);
    if (!next.skel || !next.atlas) return;
    const data = SceneModel.current;
    if (!data) return;
    load(next.runtime, { ...data, entities: [entity] }, new Map([[sourceId, rt as number]]));
    return;
  }

  // Same binding — apply the editable state in place. Props are idempotent;
  // variant/animation only on change so scrubbing an unrelated field never
  // restarts the animation.
  adapter.apply(rt as number, sc.d, prev, next);
}

function unbind(sourceId: number): void {
  const prev = bound.get(sourceId);
  bound.delete(sourceId);
  const rt = SceneModel.runtimeFor(sourceId);
  if (rt !== undefined) adapterFor(prev?.runtime ?? '').remove(rt as number);
}

/** Queue a load through the shared loader; poke panels when it lands so the
 *  animation/skin dropdowns pick up the fresh skeleton's options. */
function load(runtime: string, sceneData: SceneData, entityMap: Map<number, number>): void {
  const t = transport!;
  const adapter = adapterFor(runtime);
  chain = chain
    .then(() => adapter.load(sceneData, entityMap, t.toUrl, t.resolvePath))
    .then(() => SceneStore.poke())
    .catch((err) => console.warn(`[${runtime}] viewport binding load failed`, err));
}
