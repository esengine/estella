import { describe, it, expect } from 'vitest';
import { App, type Plugin } from '../src/app';

function makePlugin(name: string, opts?: { dependencies?: string[]; before?: string[]; after?: string[] }): Plugin {
    return {
        name,
        dependencies: opts?.dependencies,
        before: opts?.before,
        after: opts?.after,
        build() {},
    };
}

describe('Plugin dependency sorting', () => {
    it('should sort by dependencies', () => {
        const app = App.new();
        const order: string[] = [];
        const a: Plugin = { name: 'a', build() { order.push('a'); } };
        const b: Plugin = { name: 'b', dependencies: ['a'], build() { order.push('b'); } };
        const c: Plugin = { name: 'c', dependencies: ['b'], build() { order.push('c'); } };

        app.addPlugins([c, a, b]);
        expect(order).toEqual(['a', 'b', 'c']);
    });

    it('should sort by after constraints', () => {
        const app = App.new();
        const order: string[] = [];
        const a: Plugin = { name: 'a', build() { order.push('a'); } };
        const b: Plugin = { name: 'b', after: ['a'], build() { order.push('b'); } };

        app.addPlugins([b, a]);
        expect(order).toEqual(['a', 'b']);
    });

    it('should sort by before constraints', () => {
        const app = App.new();
        const order: string[] = [];
        const a: Plugin = { name: 'a', before: ['b'], build() { order.push('a'); } };
        const b: Plugin = { name: 'b', build() { order.push('b'); } };

        app.addPlugins([b, a]);
        expect(order).toEqual(['a', 'b']);
    });

    it('should combine dependencies, before, and after', () => {
        const app = App.new();
        const order: string[] = [];
        const a: Plugin = { name: 'a', build() { order.push('a'); } };
        const b: Plugin = { name: 'b', dependencies: ['a'], build() { order.push('b'); } };
        const c: Plugin = { name: 'c', after: ['b'], build() { order.push('c'); } };
        const d: Plugin = { name: 'd', before: ['c'], build() { order.push('d'); } };

        app.addPlugins([d, c, b, a]);
        expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
        expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
        expect(order.indexOf('d')).toBeLessThan(order.indexOf('c'));
    });

    it('should detect circular dependencies', () => {
        const app = App.new();
        const a = makePlugin('a', { dependencies: ['b'] });
        const b = makePlugin('b', { dependencies: ['a'] });

        expect(() => app.addPlugins([a, b])).toThrow(/Circular plugin dependency/);
    });

    it('should include cycle path in error message', () => {
        const app = App.new();
        const a = makePlugin('a', { dependencies: ['c'] });
        const b = makePlugin('b', { dependencies: ['a'] });
        const c = makePlugin('c', { dependencies: ['b'] });

        expect(() => app.addPlugins([a, b, c])).toThrow(/a -> c -> b -> a/);
    });

    it('should detect cycles involving before/after', () => {
        const app = App.new();
        const a = makePlugin('a', { before: ['b'] });
        const b = makePlugin('b', { before: ['a'] });

        expect(() => app.addPlugins([a, b])).toThrow(/Circular plugin dependency/);
    });

    it('should warn on duplicate plugin names', () => {
        const app = App.new();
        const warnings: string[] = [];
        const origWarn = console.warn;
        console.warn = (msg: string) => { warnings.push(msg); };

        try {
            const a1 = makePlugin('a');
            const a2 = makePlugin('a');
            app.addPlugins([a1, a2]);
            expect(warnings.some(w => w.includes('Duplicate plugin name "a"'))).toBe(true);
        } finally {
            console.warn = origWarn;
        }
    });

    it('should ignore before/after referencing unknown plugins', () => {
        const app = App.new();
        const order: string[] = [];
        const a: Plugin = { name: 'a', before: ['nonexistent'], build() { order.push('a'); } };
        const b: Plugin = { name: 'b', after: ['nonexistent'], build() { order.push('b'); } };

        app.addPlugins([a, b]);
        expect(order).toHaveLength(2);
    });
});
