/**
 * ESEngine TypeScript SDK - ECS Registry
 *
 * Central registry for managing entities and components.
 * Uses sparse set storage for efficient component access.
 */

import { Entity, INVALID_ENTITY } from '../core/Types';
import { generateEntityId, recycleEntityId, isValidEntity } from './Entity';
import { View, View2, View3, View4 } from './View';

// Component pool type
type ComponentPool<T> = Map<Entity, T>;

// Component type identifier
type ComponentKey = symbol | string;

/**
 * Registry - Central manager for entities and components.
 */
export class Registry {
  private entities: Set<Entity> = new Set();
  private componentPools: Map<ComponentKey, ComponentPool<unknown>> = new Map();
  private entityComponents: Map<Entity, Set<ComponentKey>> = new Map();

  /**
   * Create a new entity.
   */
  create(): Entity {
    const entity = generateEntityId();
    this.entities.add(entity);
    this.entityComponents.set(entity, new Set());
    return entity;
  }

  /**
   * Create multiple entities at once.
   */
  createMany(count: number): Entity[] {
    const entities: Entity[] = [];
    for (let i = 0; i < count; i++) {
      entities.push(this.create());
    }
    return entities;
  }

  /**
   * Destroy an entity and all its components.
   */
  destroy(entity: Entity): void {
    if (!this.valid(entity)) return;

    // Remove all components
    const components = this.entityComponents.get(entity);
    if (components) {
      for (const key of components) {
        const pool = this.componentPools.get(key);
        if (pool) {
          pool.delete(entity);
        }
      }
    }

    // Remove entity
    this.entities.delete(entity);
    this.entityComponents.delete(entity);
    recycleEntityId(entity);
  }

  /**
   * Check if an entity is valid (exists in the registry).
   */
  valid(entity: Entity): boolean {
    return isValidEntity(entity) && this.entities.has(entity);
  }

  /**
   * Get the number of entities in the registry.
   */
  entityCount(): number {
    return this.entities.size;
  }

  /**
   * Add a component to an entity.
   *
   * @param entity The entity to add the component to
   * @param key The component type identifier (symbol or string)
   * @param component The component data
   * @returns The component that was added
   */
  emplace<T>(entity: Entity, key: ComponentKey, component: T): T {
    if (!this.valid(entity)) {
      throw new Error(`Cannot add component to invalid entity: ${entity}`);
    }

    let pool = this.componentPools.get(key) as ComponentPool<T> | undefined;
    if (!pool) {
      pool = new Map<Entity, T>();
      this.componentPools.set(key, pool as ComponentPool<unknown>);
    }

    pool.set(entity, component);
    this.entityComponents.get(entity)!.add(key);

    return component;
  }

  /**
   * Add or replace a component on an entity.
   */
  emplaceOrReplace<T>(entity: Entity, key: ComponentKey, component: T): T {
    return this.emplace(entity, key, component);
  }

  /**
   * Remove a component from an entity.
   */
  remove(entity: Entity, key: ComponentKey): void {
    if (!this.valid(entity)) return;

    const pool = this.componentPools.get(key);
    if (pool) {
      pool.delete(entity);
    }

    const components = this.entityComponents.get(entity);
    if (components) {
      components.delete(key);
    }
  }

  /**
   * Get a component from an entity.
   * Throws if the entity doesn't have the component.
   */
  get<T>(entity: Entity, key: ComponentKey): T {
    const component = this.tryGet<T>(entity, key);
    if (component === undefined) {
      throw new Error(
        `Entity ${entity} does not have component: ${String(key)}`
      );
    }
    return component;
  }

  /**
   * Try to get a component from an entity.
   * Returns undefined if the entity doesn't have the component.
   */
  tryGet<T>(entity: Entity, key: ComponentKey): T | undefined {
    if (!this.valid(entity)) return undefined;

    const pool = this.componentPools.get(key) as ComponentPool<T> | undefined;
    if (!pool) return undefined;

    return pool.get(entity);
  }

  /**
   * Get a component or add it if it doesn't exist.
   */
  getOrEmplace<T>(
    entity: Entity,
    key: ComponentKey,
    defaultComponent: T
  ): T {
    const existing = this.tryGet<T>(entity, key);
    if (existing !== undefined) {
      return existing;
    }
    return this.emplace(entity, key, defaultComponent);
  }

  /**
   * Check if an entity has a component.
   */
  has(entity: Entity, key: ComponentKey): boolean {
    if (!this.valid(entity)) return false;

    const pool = this.componentPools.get(key);
    return pool !== undefined && pool.has(entity);
  }

  /**
   * Check if an entity has all of the specified components.
   */
  hasAll(entity: Entity, ...keys: ComponentKey[]): boolean {
    return keys.every((key) => this.has(entity, key));
  }

  /**
   * Check if an entity has any of the specified components.
   */
  hasAny(entity: Entity, ...keys: ComponentKey[]): boolean {
    return keys.some((key) => this.has(entity, key));
  }

  /**
   * Create a view for entities with a single component.
   */
  view<T>(key: ComponentKey): View<T> {
    const pool = this.getOrCreatePool<T>(key);
    const entities = new Set<Entity>();

    for (const entity of this.entities) {
      if (pool.has(entity)) {
        entities.add(entity);
      }
    }

    return new View(pool, entities);
  }

  /**
   * Create a view for entities with two components.
   */
  view2<T1, T2>(key1: ComponentKey, key2: ComponentKey): View2<T1, T2> {
    const pool1 = this.getOrCreatePool<T1>(key1);
    const pool2 = this.getOrCreatePool<T2>(key2);
    const entities = new Set<Entity>();

    for (const entity of this.entities) {
      if (pool1.has(entity) && pool2.has(entity)) {
        entities.add(entity);
      }
    }

    return new View2(pool1, pool2, entities);
  }

  /**
   * Create a view for entities with three components.
   */
  view3<T1, T2, T3>(
    key1: ComponentKey,
    key2: ComponentKey,
    key3: ComponentKey
  ): View3<T1, T2, T3> {
    const pool1 = this.getOrCreatePool<T1>(key1);
    const pool2 = this.getOrCreatePool<T2>(key2);
    const pool3 = this.getOrCreatePool<T3>(key3);
    const entities = new Set<Entity>();

    for (const entity of this.entities) {
      if (pool1.has(entity) && pool2.has(entity) && pool3.has(entity)) {
        entities.add(entity);
      }
    }

    return new View3(pool1, pool2, pool3, entities);
  }

  /**
   * Create a view for entities with four components.
   */
  view4<T1, T2, T3, T4>(
    key1: ComponentKey,
    key2: ComponentKey,
    key3: ComponentKey,
    key4: ComponentKey
  ): View4<T1, T2, T3, T4> {
    const pool1 = this.getOrCreatePool<T1>(key1);
    const pool2 = this.getOrCreatePool<T2>(key2);
    const pool3 = this.getOrCreatePool<T3>(key3);
    const pool4 = this.getOrCreatePool<T4>(key4);
    const entities = new Set<Entity>();

    for (const entity of this.entities) {
      if (
        pool1.has(entity) &&
        pool2.has(entity) &&
        pool3.has(entity) &&
        pool4.has(entity)
      ) {
        entities.add(entity);
      }
    }

    return new View4(pool1, pool2, pool3, pool4, entities);
  }

  /**
   * Execute a callback for each entity with the specified component.
   */
  each<T>(key: ComponentKey, callback: (entity: Entity, component: T) => void): void {
    this.view<T>(key).each(callback);
  }

  /**
   * Clear all entities and components.
   */
  clear(): void {
    this.entities.clear();
    this.componentPools.clear();
    this.entityComponents.clear();
  }

  /**
   * Get all entities in the registry.
   */
  getAllEntities(): Entity[] {
    return Array.from(this.entities);
  }

  private getOrCreatePool<T>(key: ComponentKey): ComponentPool<T> {
    let pool = this.componentPools.get(key) as ComponentPool<T> | undefined;
    if (!pool) {
      pool = new Map<Entity, T>();
      this.componentPools.set(key, pool as ComponentPool<unknown>);
    }
    return pool;
  }
}
