import { PTR_LAYOUTS, writePtrField } from 'esengine';
import type { PtrLayout } from 'esengine';
import type { Entity, ESEngineModule, BuiltinBridge } from 'esengine';

interface PtrFieldDesc {
    readonly name: string;
    readonly type: string;
    readonly offset: number;
}

interface ResolvedLayout {
    layout: PtrLayout;
    getPtrFn: (entity: Entity) => number;
    fieldMap: Map<string, PtrFieldDesc>;
}

export class IncrementalSync {
    private builtin_: BuiltinBridge;
    private module_: ESEngineModule;
    private layoutCache_ = new Map<string, ResolvedLayout | null>();

    constructor(builtin: BuiltinBridge, module: ESEngineModule) {
        this.builtin_ = builtin;
        this.module_ = module;
    }

    syncProperty(
        entity: Entity,
        componentType: string,
        propertyName: string,
        value: unknown,
    ): boolean {
        const resolved = this.resolveLayout_(componentType);
        if (!resolved) return false;

        const field = resolved.fieldMap.get(propertyName);
        if (!field) return false;

        const ptr = resolved.getPtrFn(entity);
        if (!ptr) return false;

        const converted = this.convertValue_(field, value);
        writePtrField(
            this.module_.HEAPF32,
            this.module_.HEAPU32,
            this.module_.HEAPU8,
            ptr,
            field as any,
            converted,
        );
        return true;
    }

    private resolveLayout_(componentType: string): ResolvedLayout | null {
        const cached = this.layoutCache_.get(componentType);
        if (cached !== undefined) return cached;

        const layout = PTR_LAYOUTS[componentType];
        if (!layout) {
            this.layoutCache_.set(componentType, null);
            return null;
        }

        const getPtrFn = this.builtin_.resolvePtrFn(componentType);
        if (!getPtrFn) {
            this.layoutCache_.set(componentType, null);
            return null;
        }

        const fieldMap = new Map<string, PtrFieldDesc>();
        for (const f of layout.fields) {
            fieldMap.set(f.name, f);
        }

        const resolved: ResolvedLayout = { layout, getPtrFn, fieldMap };
        this.layoutCache_.set(componentType, resolved);
        return resolved;
    }

    private convertValue_(field: PtrFieldDesc, value: unknown): unknown {
        if (field.type === 'color' && value && typeof value === 'object') {
            const c = value as Record<string, number>;
            if ('r' in c) {
                return { r: c.r, g: c.g, b: c.b, a: c.a };
            }
        }
        return value;
    }
}
