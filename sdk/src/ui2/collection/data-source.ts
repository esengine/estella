/**
 * Change notification emitted by a DataSource.
 */
export type DataSourceChange =
    | { type: 'insert'; index: number; count: number }
    | { type: 'remove'; index: number; count: number }
    | { type: 'update'; index: number; count: number }
    | { type: 'reset' };

export type Unsubscribe = () => void;

/**
 * Abstract backing store for a virtualized list. Producers implement
 * `getCount` + `getItem` at minimum; optional methods provide
 * heterogeneous item types, stable identity for diffing, and change
 * notifications so consumers can mark themselves dirty.
 */
export interface DataSource<T = unknown> {
    getCount(): number;
    getItem(index: number): T;
    /** Defaults to `'default'`. Used to route items to the matching template. */
    getItemType?(index: number): string;
    /** Stable identity to support future reorder-aware diffing. */
    getItemId?(index: number, item: T): string | number;
    /** Subscribe to change notifications; returns an unsubscribe fn. */
    subscribe?(listener: (change: DataSourceChange) => void): Unsubscribe;
}

/**
 * DataSource backed by a mutable array, with helper methods that mutate
 * the array and notify subscribers in one call.
 */
export class ArrayDataSource<T> implements DataSource<T> {
    private readonly items_: T[];
    private readonly listeners_ = new Set<(c: DataSourceChange) => void>();

    constructor(items: readonly T[] = []) {
        this.items_ = items.slice();
    }

    getCount(): number {
        return this.items_.length;
    }

    getItem(index: number): T {
        const item = this.items_[index];
        if (item === undefined && index >= this.items_.length) {
            throw new Error(`[ArrayDataSource] index ${index} out of range (count=${this.items_.length})`);
        }
        return item as T;
    }

    subscribe(listener: (c: DataSourceChange) => void): Unsubscribe {
        this.listeners_.add(listener);
        return () => {
            this.listeners_.delete(listener);
        };
    }

    /** Replace all items. Emits a `reset`. */
    setItems(items: readonly T[]): void {
        this.items_.length = 0;
        this.items_.push(...items);
        this.emit_({ type: 'reset' });
    }

    /** Append items to the end. Emits `insert`. */
    append(items: readonly T[]): void {
        const at = this.items_.length;
        this.items_.push(...items);
        this.emit_({ type: 'insert', index: at, count: items.length });
    }

    /** Insert items at `index`. Emits `insert`. */
    insert(index: number, items: readonly T[]): void {
        const clamped = Math.max(0, Math.min(index, this.items_.length));
        this.items_.splice(clamped, 0, ...items);
        this.emit_({ type: 'insert', index: clamped, count: items.length });
    }

    /** Remove `count` items starting at `index`. Emits `remove`. */
    remove(index: number, count = 1): void {
        if (count <= 0) return;
        const actual = Math.min(count, this.items_.length - index);
        if (actual <= 0) return;
        this.items_.splice(index, actual);
        this.emit_({ type: 'remove', index, count: actual });
    }

    /** Replace item at `index`. Emits `update`. */
    update(index: number, item: T): void {
        this.items_[index] = item;
        this.emit_({ type: 'update', index, count: 1 });
    }

    private emit_(change: DataSourceChange): void {
        for (const listener of Array.from(this.listeners_)) {
            try {
                listener(change);
            } catch (err) {
                console.error('[ArrayDataSource] listener error:', err);
            }
        }
    }
}

/** Convenience factory for ad-hoc arrays. */
export function arrayDataSource<T>(items: readonly T[]): ArrayDataSource<T> {
    return new ArrayDataSource(items);
}
