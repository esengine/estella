import { Parent } from 'esengine';
import type { SceneNode, NodeKind, EntityId, InspectorComponent, InspectorFieldValue } from '@/types';
import { EngineHost } from './EngineHost';
import {
  inspectableComponents,
  componentFields,
  inferField,
  kindOf,
  nameOf,
  componentByName,
  type ReadonlyWorldT,
} from './schema';

// An entity reads as hidden if any of its components is explicitly disabled
// (`enabled: false`) — the editor's visibility toggle flips those.
function isVisible(world: ReadonlyWorldT, id: EntityId): boolean {
  for (const { def } of inspectableComponents(world, id)) {
    const data = world.get(id, def) as unknown as Record<string, unknown>;
    if ('enabled' in data && data.enabled === false) return false;
  }
  return true;
}

// Read-only reflection of the live engine World into editor view-models.
export const SceneQuery = {
  /** Monotonic counter; bump means the entity set / structure changed. */
  worldVersion(): number {
    return EngineHost.world?.getWorldVersion() ?? -1;
  },

  /** Build the outliner tree from the live World, nesting via the Parent component. */
  readSceneTree(): SceneNode[] {
    const world = EngineHost.world;
    if (!world) return [];

    const ids = world.getAllEntities();
    const idSet = new Set<EntityId>(ids);
    const childrenOf = new Map<EntityId, EntityId[]>();
    const roots: EntityId[] = [];

    for (const e of ids) {
      let parent: EntityId | null = null;
      if (world.has(e, Parent)) {
        const p = world.get(e, Parent).entity;
        if (p !== e && idSet.has(p)) parent = p;
      }
      if (parent === null) {
        roots.push(e);
      } else {
        const arr = childrenOf.get(parent);
        if (arr) arr.push(e);
        else childrenOf.set(parent, [e]);
      }
    }

    const build = (e: EntityId): SceneNode => {
      const kind = kindOf(world, e);
      const kids = childrenOf.get(e);
      return {
        id: e,
        name: nameOf(world, e, kind),
        kind,
        visible: isVisible(world, e),
        locked: false,
        children: kids?.map(build),
      };
    };

    return roots.map(build);
  },

  /** Inspect a single live entity (name, kind, which components it carries). */
  readEntity(id: EntityId): { name: string; kind: NodeKind; components: string[] } | null {
    const world = EngineHost.world;
    if (!world || !world.valid(id)) return null;
    const kind = kindOf(world, id);
    const components = inspectableComponents(world, id).map((c) => c.label);
    return { name: nameOf(world, id, kind), kind, components };
  },

  /** Full editable inspector model for an entity — components from the engine registry. */
  readInspector(entity: EntityId): InspectorComponent[] {
    const world = EngineHost.world;
    if (!world || !world.valid(entity)) return [];

    const out: InspectorComponent[] = [];
    for (const { def, label } of inspectableComponents(world, entity)) {
      const data = world.get(entity, def) as unknown as Record<string, unknown>;
      out.push({ name: def._name, label, fields: componentFields(def, data) });
    }
    return out;
  },

  /** Read one inspector field's current value (for undo before/after capture). */
  getFieldValue(entity: EntityId, compName: string, key: string): InspectorFieldValue | null {
    const world = EngineHost.world;
    if (!world || !world.valid(entity)) return null;
    const def = componentByName(compName);
    if (!def || !world.has(entity, def)) return null;
    const data = world.get(entity, def) as unknown as Record<string, unknown>;
    const f = inferField(key, data[key], new Set<string>(def.colorKeys).has(key));
    return f ? f.value : null;
  },
};
