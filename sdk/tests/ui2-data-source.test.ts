import { describe, it, expect, vi } from 'vitest';
import { ArrayDataSource, arrayDataSource, type DataSourceChange } from '../src/ui2';

describe('ArrayDataSource', () => {
    it('reports count and items from initial array', () => {
        const ds = arrayDataSource([10, 20, 30]);
        expect(ds.getCount()).toBe(3);
        expect(ds.getItem(0)).toBe(10);
        expect(ds.getItem(2)).toBe(30);
    });

    it('copies the initial array (external mutation does not affect)', () => {
        const src = [1, 2, 3];
        const ds = new ArrayDataSource(src);
        src.push(4);
        expect(ds.getCount()).toBe(3);
    });

    it('throws when indexing out of range', () => {
        const ds = arrayDataSource([1, 2]);
        expect(() => ds.getItem(5)).toThrow(/out of range/);
    });

    describe('subscribe / notifications', () => {
        it('delivers setItems as a reset change', () => {
            const ds = arrayDataSource([1, 2, 3]);
            const listener = vi.fn<(c: DataSourceChange) => void>();
            ds.subscribe(listener);

            ds.setItems([10, 20]);

            expect(ds.getCount()).toBe(2);
            expect(listener).toHaveBeenCalledWith({ type: 'reset' });
        });

        it('delivers append as insert at end', () => {
            const ds = arrayDataSource([1]);
            const listener = vi.fn<(c: DataSourceChange) => void>();
            ds.subscribe(listener);

            ds.append([2, 3]);

            expect(ds.getCount()).toBe(3);
            expect(listener).toHaveBeenCalledWith({ type: 'insert', index: 1, count: 2 });
        });

        it('delivers insert with the clamped target index', () => {
            const ds = arrayDataSource([1, 2]);
            const listener = vi.fn<(c: DataSourceChange) => void>();
            ds.subscribe(listener);

            ds.insert(10, [99]);  // far past end, clamped to 2

            expect(ds.getCount()).toBe(3);
            expect(ds.getItem(2)).toBe(99);
            expect(listener).toHaveBeenCalledWith({ type: 'insert', index: 2, count: 1 });
        });

        it('delivers remove with the actual removed count', () => {
            const ds = arrayDataSource([1, 2, 3]);
            const listener = vi.fn<(c: DataSourceChange) => void>();
            ds.subscribe(listener);

            ds.remove(1, 10);  // tries to remove 10, only 2 remain

            expect(ds.getCount()).toBe(1);
            expect(listener).toHaveBeenCalledWith({ type: 'remove', index: 1, count: 2 });
        });

        it('remove with count <= 0 is a no-op (no emission)', () => {
            const ds = arrayDataSource([1, 2]);
            const listener = vi.fn<(c: DataSourceChange) => void>();
            ds.subscribe(listener);

            ds.remove(0, 0);

            expect(ds.getCount()).toBe(2);
            expect(listener).not.toHaveBeenCalled();
        });

        it('delivers update as a single-item update', () => {
            const ds = arrayDataSource(['a', 'b', 'c']);
            const listener = vi.fn<(c: DataSourceChange) => void>();
            ds.subscribe(listener);

            ds.update(1, 'B');

            expect(ds.getItem(1)).toBe('B');
            expect(listener).toHaveBeenCalledWith({ type: 'update', index: 1, count: 1 });
        });

        it('unsubscribe stops further notifications', () => {
            const ds = arrayDataSource([1]);
            const listener = vi.fn<(c: DataSourceChange) => void>();
            const off = ds.subscribe(listener);
            off();

            ds.append([2]);

            expect(listener).not.toHaveBeenCalled();
        });

        it('listener throw does not block peers', () => {
            const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const ds = arrayDataSource([1]);
            const good = vi.fn<(c: DataSourceChange) => void>();
            ds.subscribe(() => { throw new Error('boom'); });
            ds.subscribe(good);

            ds.append([2]);

            expect(good).toHaveBeenCalledOnce();
            expect(spy).toHaveBeenCalled();
            spy.mockRestore();
        });
    });
});
