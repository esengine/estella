import type { Entity } from '../types';
import type { World } from '../world';

export class ItemPool {
    private pools_ = new Map<string, Entity[]>();

    acquire(type: string = 'default'): Entity | undefined {
        const pool = this.pools_.get(type);
        return pool && pool.length > 0 ? pool.pop()! : undefined;
    }

    release(entity: Entity, type: string = 'default'): void {
        let pool = this.pools_.get(type);
        if (!pool) {
            pool = [];
            this.pools_.set(type, pool);
        }
        pool.push(entity);
    }

    clear(world: World): void {
        for (const pool of this.pools_.values()) {
            for (const entity of pool) {
                if (world.valid(entity)) {
                    world.despawn(entity);
                }
            }
        }
        this.pools_.clear();
    }

    get size(): number {
        let total = 0;
        for (const pool of this.pools_.values()) {
            total += pool.length;
        }
        return total;
    }
}
