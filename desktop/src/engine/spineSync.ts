// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  spineSync.ts
 * @brief Keeps the viewport's spine bindings a live projection of the model,
 *        the same way the Reconciler keeps the World one. Spine instances live
 *        OUTSIDE the World (per-entity bindings in the SpineManager, loaded
 *        through the shared runtime loader), so World projection alone can't
 *        keep them true. This module subscribes to the SceneModel and:
 *
 *        - on `reset` (scene open / play-stop rebuild) re-binds every spine
 *          entity — the rebuild despawned the old runtime entities, which
 *          dropped their instances;
 *        - on a skeleton/atlas ref edit reloads that entity's binding through
 *          the SAME shared loader the scene load uses;
 *        - on skin/animation/props edits applies them in place (live preview
 *          without restarting the animation on unrelated field scrubs).
 *
 *        ProjectStore installs it with the project's ref→URL transport; without
 *        an install every event is a no-op (dev/automation scene loads bind
 *        spine themselves, once).
 */
import { getComponentSkeletalFieldDescriptor } from 'esengine';
import { spineEntityProps } from 'esengine/spine';
import type { SceneData } from 'esengine';
import { SceneModel, type ModelEvent } from './SceneModel';
import { SceneStore } from './SceneStore';
import { EngineHost } from './EngineHost';

type SceneEntity = SceneData['entities'][number];

/** What an entity's binding was loaded/applied from, for change detection. */
interface BoundState {
  skel: string;
  atlas: string;
  skin: string;
  animation: string;
  loop: boolean;
}

/** The project transport spine assets load over: ref → fetchable URL, and
 *  `@uuid:` ref → project path (page-texture paths derive from the atlas dir). */
export interface SpineTransport {
  toUrl: (ref: string) => string;
  resolvePath: (ref: string) => string;
}

let transport: SpineTransport | null = null;
let subscribed = false;
const bound = new Map<number, BoundState>();
// Spine (re)loads are async (fetch + decode + side-module init); serialize them
// so two rapid ref edits can't finish out of order and leave the older skeleton.
let chain: Promise<void> = Promise.resolve();

/**
 * Install (or re-target) the sync for the open project's transport. Call
 * BEFORE the scene adopt so the model's `reset` performs the initial bind.
 */
export function installSpineSync(t: SpineTransport): void {
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

/** The entity's spine component (any component with a spine field descriptor). */
function spineComp(entity: SceneEntity): { type: string; d: Record<string, unknown> } | null {
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
    skel: str(d[desc.skeletonField]),
    atlas: str(d[desc.atlasField]),
    skin: str(d.skin),
    animation: str(d.animation),
    loop: d.loop !== false,
  };
}

/** Re-bind every spine entity from the current model (scene open / play-stop). */
function rebindAll(): void {
  bound.clear();
  const data = SceneModel.current;
  if (!data) return;
  const entityMap = new Map<number, number>();
  const entities: SceneEntity[] = [];
  for (const e of data.entities) {
    const sc = spineComp(e);
    if (!sc) continue;
    const rt = SceneModel.runtimeFor(e.id);
    if (rt === undefined) continue;
    const next = stateOf(sc.type, sc.d);
    if (!next.skel || !next.atlas) continue;
    bound.set(e.id, next);
    entityMap.set(e.id, rt as number);
    entities.push(e);
  }
  if (entities.length === 0) return;
  load({ ...data, entities }, entityMap);
}

/** Project one entity's spine component: ref change → reload, else apply in place. */
function syncEntity(sourceId: number): void {
  const entity = SceneModel.entityBySource(sourceId);
  const rt = SceneModel.runtimeFor(sourceId);
  const spine = EngineHost.spineManager;
  if (!entity || rt === undefined || !spine) return;
  const sc = spineComp(entity);
  if (!sc) return;

  const next = stateOf(sc.type, sc.d);
  const prev = bound.get(sourceId);
  bound.set(sourceId, next);

  if (!prev || prev.skel !== next.skel || prev.atlas !== next.atlas) {
    spine.removeEntity(rt as never);
    if (!next.skel || !next.atlas) return;
    const data = SceneModel.current;
    if (!data) return;
    load({ ...data, entities: [entity] }, new Map([[sourceId, rt as number]]));
    return;
  }

  // Same binding — apply the editable spine state in place. Props are
  // idempotent; skin/animation only on change so scrubbing an unrelated
  // field never restarts the animation.
  spine.setEntityProps(rt as never, spineEntityProps(sc.d));
  if (prev.skin !== next.skin && next.skin) spine.setSkin(rt as never, next.skin);
  if (prev.animation !== next.animation || prev.loop !== next.loop) {
    if (next.animation) spine.setAnimation(rt as never, next.animation, next.loop);
  }
}

function unbind(sourceId: number): void {
  bound.delete(sourceId);
  const rt = SceneModel.runtimeFor(sourceId);
  if (rt !== undefined) EngineHost.spineManager?.removeEntity(rt as never);
}

/** Queue a load through the shared loader; poke panels when it lands so the
 *  animation/skin dropdowns pick up the fresh skeleton's options. */
function load(sceneData: SceneData, entityMap: Map<number, number>): void {
  const t = transport!;
  chain = chain
    .then(() => EngineHost.loadSpine(sceneData, entityMap, t.toUrl, t.resolvePath))
    .then(() => SceneStore.poke())
    .catch((err) => console.warn('[spine] viewport binding load failed', err));
}
