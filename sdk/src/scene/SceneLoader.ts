/**
 * @file    SceneLoader.ts
 * @brief   Scene loading utilities for .esscene JSON files
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

import { Entity } from '../core/Types';
import { Registry } from '../ecs/Registry';
import {
  Transform,
  Sprite,
  Name,
  Parent,
  Children,
  createTransform,
  createSprite,
  createName,
  createParent,
  createChildren,
  TransformType,
  SpriteType,
  NameType,
  ActiveType,
  VisibleType,
  StaticType,
  ParentType,
  ChildrenType,
  createActive,
  createVisible,
  createStatic,
} from '../ecs/Components';
import { ComponentDef } from '../framework/component';
import { Schema } from '../framework/types';

// =============================================================================
// Constants
// =============================================================================

export const SCENE_FORMAT_VERSION = 1;

// =============================================================================
// Types
// =============================================================================

export interface SceneData {
  version: number;
  name: string;
  entities: EntityData[];
  scripts?: ScriptComponentData[];
}

/**
 * Script component definition in scene file
 */
export interface ScriptComponentData {
  name: string;
  schema: Record<string, string>;
}

/**
 * Entity data in scene file
 */
export interface EntityData {
  uuid: number;
  name: string;
  components: ComponentsData;
}

/**
 * Components data structure
 */
export interface ComponentsData {
  LocalTransform?: {
    position: [number, number, number];
    rotation: [number, number, number, number]; // quaternion [w, x, y, z]
    scale: [number, number, number];
  };
  Parent?: {
    uuid: number;
  };
  Sprite?: {
    texture: number;
    texturePath?: string;
    color: [number, number, number, number];
    size: [number, number];
    uvOffset: [number, number];
    uvScale: [number, number];
    layer: number;
    flipX: boolean;
    flipY: boolean;
  };
  Camera?: {
    projectionType: number;
    fov: number;
    orthoSize: number;
    nearPlane: number;
    farPlane: number;
    aspectRatio: number;
    isActive: boolean;
    priority: number;
  };
  Canvas?: {
    designResolution: [number, number];
    pixelsPerUnit: number;
    scaleMode: number;
    matchWidthOrHeight: number;
    backgroundColor: [number, number, number, number];
  };
  tags?: string[];
  scripts?: Array<{
    name: string;
    fields: Record<string, unknown>;
  }>;
}

export type TextureLoader = (path: string) => Promise<number>;

/**
 * Component registry for custom script components
 */
export type ComponentRegistry = Map<string, ComponentDef<Schema>>;

export interface SceneLoaderOptions {
  textureLoader?: TextureLoader;
  componentRegistry?: ComponentRegistry;
}

export interface SceneLoadResult {
  success: boolean;
  sceneName: string;
  entityCount: number;
  entities: Entity[];
  error?: string;
}

// =============================================================================
// Functions
// =============================================================================

export async function loadScene(
  registry: Registry,
  url: string,
  options: SceneLoaderOptions = {}
): Promise<SceneLoadResult> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return {
        success: false,
        sceneName: '',
        entityCount: 0,
        entities: [],
        error: `Failed to fetch scene: ${response.status} ${response.statusText}`,
      };
    }

    const sceneData: SceneData = await response.json();
    return await loadSceneFromData(registry, sceneData, options);
  } catch (error) {
    return {
      success: false,
      sceneName: '',
      entityCount: 0,
      entities: [],
      error: `Failed to load scene: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function loadSceneFromData(
  registry: Registry,
  sceneData: SceneData,
  options: SceneLoaderOptions = {}
): Promise<SceneLoadResult> {
  const { textureLoader, componentRegistry } = options;

  // Check version
  if (sceneData.version > SCENE_FORMAT_VERSION) {
    return {
      success: false,
      sceneName: sceneData.name,
      entityCount: 0,
      entities: [],
      error: `Scene version ${sceneData.version} is newer than supported version ${SCENE_FORMAT_VERSION}`,
    };
  }

  // Clear existing entities
  registry.clear();

  // Maps for resolving references
  const uuidToEntity = new Map<number, Entity>();
  const entities: Entity[] = [];

  // First pass: create all entities
  for (const entityData of sceneData.entities) {
    const entity = registry.create();
    uuidToEntity.set(entityData.uuid, entity);
    entities.push(entity);

    // Add Name component
    registry.emplace(entity, NameType, createName(entityData.name));

    // Add components
    const components = entityData.components;

    // LocalTransform
    if (components.LocalTransform) {
      const t = components.LocalTransform;
      registry.emplace(
        entity,
        TransformType,
        createTransform(
          { x: t.position[0], y: t.position[1], z: t.position[2] },
          { x: 0, y: 0, z: 0 }, // Convert quaternion to euler if needed
          { x: t.scale[0], y: t.scale[1], z: t.scale[2] }
        )
      );
    }

    // Sprite
    if (components.Sprite) {
      const s = components.Sprite;
      let textureId = 0;

      // Try to load texture if path is provided
      if (s.texturePath && textureLoader) {
        try {
          textureId = await textureLoader(s.texturePath);
        } catch (e) {
          console.warn(`Failed to load texture: ${s.texturePath}`, e);
        }
      }

      registry.emplace(
        entity,
        SpriteType,
        createSprite(textureId, {
          color: { r: s.color[0], g: s.color[1], b: s.color[2], a: s.color[3] },
          size: { x: s.size[0], y: s.size[1] },
          uvOffset: { x: s.uvOffset[0], y: s.uvOffset[1] },
          uvScale: { x: s.uvScale[0], y: s.uvScale[1] },
          layer: s.layer,
        })
      );
    }

    // Tags
    if (components.tags) {
      for (const tag of components.tags) {
        switch (tag) {
          case 'Active':
            registry.emplace(entity, ActiveType, createActive());
            break;
          case 'Visible':
            registry.emplace(entity, VisibleType, createVisible());
            break;
          case 'Static':
            registry.emplace(entity, StaticType, createStatic());
            break;
        }
      }
    }

    // Custom script components
    if (components.scripts && componentRegistry) {
      for (const scriptData of components.scripts) {
        const componentDef = componentRegistry.get(scriptData.name);
        if (componentDef) {
          const instance = componentDef.create(scriptData.fields as never);
          const key = Symbol.for(`Script_${scriptData.name}`);
          registry.emplace(entity, key, instance);
        } else {
          console.warn(`Unknown script component: ${scriptData.name}`);
        }
      }
    }
  }

  // Second pass: resolve parent/children relationships
  for (const entityData of sceneData.entities) {
    const entity = uuidToEntity.get(entityData.uuid);
    if (!entity) continue;

    const parentData = entityData.components.Parent;
    if (parentData && parentData.uuid !== 0) {
      const parentEntity = uuidToEntity.get(parentData.uuid);
      if (parentEntity !== undefined) {
        // Add Parent component to child
        registry.emplace(entity, ParentType, createParent(parentEntity));

        // Add/update Children component on parent
        const existingChildren = registry.tryGet<Children>(parentEntity, ChildrenType);
        if (existingChildren) {
          existingChildren.entities.push(entity);
        } else {
          registry.emplace(parentEntity, ChildrenType, createChildren([entity]));
        }
      }
    }
  }

  return {
    success: true,
    sceneName: sceneData.name,
    entityCount: entities.length,
    entities,
  };
}
