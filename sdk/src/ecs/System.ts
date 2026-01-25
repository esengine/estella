/**
 * ESEngine TypeScript SDK - System Management
 *
 * Provides base classes for game systems and system groups.
 */

import { Registry } from './Registry';

/**
 * System base class - Override to create game systems.
 */
export abstract class System {
  private enabled: boolean = true;
  private priority: number = 0;

  /**
   * Called when the system is initialized.
   */
  init(registry: Registry): void {}

  /**
   * Called every frame to update game state.
   */
  abstract update(registry: Registry, deltaTime: number): void;

  /**
   * Called when the system is shut down.
   */
  shutdown(registry: Registry): void {}

  /**
   * Enable or disable the system.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if the system is enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Set the system priority (higher = runs first).
   */
  setPriority(priority: number): void {
    this.priority = priority;
  }

  /**
   * Get the system priority.
   */
  getPriority(): number {
    return this.priority;
  }
}

/**
 * SystemGroup - Manages a collection of systems.
 */
export class SystemGroup {
  private systems: System[] = [];
  private initialized: boolean = false;

  /**
   * Add a system to the group.
   */
  addSystem(system: System): void {
    this.systems.push(system);
    this.sortSystems();
  }

  /**
   * Create and add a system to the group.
   */
  createSystem<T extends System>(
    SystemClass: new (...args: unknown[]) => T,
    ...args: unknown[]
  ): T {
    const system = new SystemClass(...args);
    this.addSystem(system);
    return system;
  }

  /**
   * Remove a system from the group.
   */
  removeSystem(system: System): boolean {
    const index = this.systems.indexOf(system);
    if (index !== -1) {
      this.systems.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Initialize all systems in the group.
   */
  init(registry: Registry): void {
    if (this.initialized) return;

    for (const system of this.systems) {
      system.init(registry);
    }
    this.initialized = true;
  }

  /**
   * Update all enabled systems in the group.
   */
  update(registry: Registry, deltaTime: number): void {
    for (const system of this.systems) {
      if (system.isEnabled()) {
        system.update(registry, deltaTime);
      }
    }
  }

  /**
   * Shut down all systems in the group.
   */
  shutdown(registry: Registry): void {
    if (!this.initialized) return;

    // Shutdown in reverse order
    for (let i = this.systems.length - 1; i >= 0; i--) {
      this.systems[i].shutdown(registry);
    }
    this.initialized = false;
  }

  /**
   * Get all systems in the group.
   */
  getSystems(): readonly System[] {
    return this.systems;
  }

  /**
   * Get the number of systems in the group.
   */
  getSystemCount(): number {
    return this.systems.length;
  }

  private sortSystems(): void {
    this.systems.sort((a, b) => b.getPriority() - a.getPriority());
  }
}
