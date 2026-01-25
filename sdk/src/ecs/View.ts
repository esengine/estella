/**
 * ESEngine TypeScript SDK - Component View
 *
 * Provides efficient querying and iteration over entities with specific components.
 */

import { Entity } from '../core/Types';

// Component storage type
type ComponentPool<T> = Map<Entity, T>;

/**
 * View for querying entities with a single component type.
 */
export class View<T> {
  private pool: ComponentPool<T>;
  private entities: Set<Entity>;

  constructor(pool: ComponentPool<T>, entities: Set<Entity>) {
    this.pool = pool;
    this.entities = entities;
  }

  /**
   * Iterate over all entities in the view.
   */
  *[Symbol.iterator](): Iterator<[Entity, T]> {
    for (const entity of this.entities) {
      const component = this.pool.get(entity);
      if (component !== undefined) {
        yield [entity, component];
      }
    }
  }

  /**
   * Execute a callback for each entity in the view.
   */
  each(callback: (entity: Entity, component: T) => void): void {
    for (const [entity, component] of this) {
      callback(entity, component);
    }
  }

  /**
   * Check if the view is empty.
   */
  empty(): boolean {
    return this.entities.size === 0;
  }

  /**
   * Get the number of entities in the view (hint, may be inaccurate).
   */
  sizeHint(): number {
    return this.entities.size;
  }

  /**
   * Get component for a specific entity.
   */
  get(entity: Entity): T | undefined {
    return this.pool.get(entity);
  }
}

/**
 * View for querying entities with two component types.
 */
export class View2<T1, T2> {
  private pool1: ComponentPool<T1>;
  private pool2: ComponentPool<T2>;
  private entities: Set<Entity>;

  constructor(
    pool1: ComponentPool<T1>,
    pool2: ComponentPool<T2>,
    entities: Set<Entity>
  ) {
    this.pool1 = pool1;
    this.pool2 = pool2;
    this.entities = entities;
  }

  /**
   * Iterate over all entities in the view.
   */
  *[Symbol.iterator](): Iterator<[Entity, T1, T2]> {
    for (const entity of this.entities) {
      const c1 = this.pool1.get(entity);
      const c2 = this.pool2.get(entity);
      if (c1 !== undefined && c2 !== undefined) {
        yield [entity, c1, c2];
      }
    }
  }

  /**
   * Execute a callback for each entity in the view.
   */
  each(callback: (entity: Entity, c1: T1, c2: T2) => void): void {
    for (const [entity, c1, c2] of this) {
      callback(entity, c1, c2);
    }
  }

  /**
   * Check if the view is empty.
   */
  empty(): boolean {
    return this.sizeHint() === 0;
  }

  /**
   * Get the number of entities in the view (hint, may be inaccurate).
   */
  sizeHint(): number {
    // Return the minimum of both pools
    let count = 0;
    for (const entity of this.entities) {
      if (this.pool1.has(entity) && this.pool2.has(entity)) {
        count++;
      }
    }
    return count;
  }
}

/**
 * View for querying entities with three component types.
 */
export class View3<T1, T2, T3> {
  private pool1: ComponentPool<T1>;
  private pool2: ComponentPool<T2>;
  private pool3: ComponentPool<T3>;
  private entities: Set<Entity>;

  constructor(
    pool1: ComponentPool<T1>,
    pool2: ComponentPool<T2>,
    pool3: ComponentPool<T3>,
    entities: Set<Entity>
  ) {
    this.pool1 = pool1;
    this.pool2 = pool2;
    this.pool3 = pool3;
    this.entities = entities;
  }

  /**
   * Iterate over all entities in the view.
   */
  *[Symbol.iterator](): Iterator<[Entity, T1, T2, T3]> {
    for (const entity of this.entities) {
      const c1 = this.pool1.get(entity);
      const c2 = this.pool2.get(entity);
      const c3 = this.pool3.get(entity);
      if (c1 !== undefined && c2 !== undefined && c3 !== undefined) {
        yield [entity, c1, c2, c3];
      }
    }
  }

  /**
   * Execute a callback for each entity in the view.
   */
  each(callback: (entity: Entity, c1: T1, c2: T2, c3: T3) => void): void {
    for (const [entity, c1, c2, c3] of this) {
      callback(entity, c1, c2, c3);
    }
  }

  /**
   * Check if the view is empty.
   */
  empty(): boolean {
    return this.sizeHint() === 0;
  }

  /**
   * Get the number of entities in the view (hint, may be inaccurate).
   */
  sizeHint(): number {
    let count = 0;
    for (const entity of this.entities) {
      if (
        this.pool1.has(entity) &&
        this.pool2.has(entity) &&
        this.pool3.has(entity)
      ) {
        count++;
      }
    }
    return count;
  }
}

/**
 * View for querying entities with four component types.
 */
export class View4<T1, T2, T3, T4> {
  private pool1: ComponentPool<T1>;
  private pool2: ComponentPool<T2>;
  private pool3: ComponentPool<T3>;
  private pool4: ComponentPool<T4>;
  private entities: Set<Entity>;

  constructor(
    pool1: ComponentPool<T1>,
    pool2: ComponentPool<T2>,
    pool3: ComponentPool<T3>,
    pool4: ComponentPool<T4>,
    entities: Set<Entity>
  ) {
    this.pool1 = pool1;
    this.pool2 = pool2;
    this.pool3 = pool3;
    this.pool4 = pool4;
    this.entities = entities;
  }

  /**
   * Iterate over all entities in the view.
   */
  *[Symbol.iterator](): Iterator<[Entity, T1, T2, T3, T4]> {
    for (const entity of this.entities) {
      const c1 = this.pool1.get(entity);
      const c2 = this.pool2.get(entity);
      const c3 = this.pool3.get(entity);
      const c4 = this.pool4.get(entity);
      if (
        c1 !== undefined &&
        c2 !== undefined &&
        c3 !== undefined &&
        c4 !== undefined
      ) {
        yield [entity, c1, c2, c3, c4];
      }
    }
  }

  /**
   * Execute a callback for each entity in the view.
   */
  each(callback: (entity: Entity, c1: T1, c2: T2, c3: T3, c4: T4) => void): void {
    for (const [entity, c1, c2, c3, c4] of this) {
      callback(entity, c1, c2, c3, c4);
    }
  }

  /**
   * Check if the view is empty.
   */
  empty(): boolean {
    return this.sizeHint() === 0;
  }

  /**
   * Get the number of entities in the view (hint, may be inaccurate).
   */
  sizeHint(): number {
    let count = 0;
    for (const entity of this.entities) {
      if (
        this.pool1.has(entity) &&
        this.pool2.has(entity) &&
        this.pool3.has(entity) &&
        this.pool4.has(entity)
      ) {
        count++;
      }
    }
    return count;
  }
}
