import type { PropertyMeta, VisibilityRule } from '../property/PropertyEditor';

class VisibilityResolver {
    isVisible(
        meta: PropertyMeta,
        componentData: Record<string, unknown>,
        entityComponents: string[],
    ): boolean {
        if (meta.hiddenWhen?.hasComponent &&
            entityComponents.includes(meta.hiddenWhen.hasComponent)) {
            return false;
        }

        const vw = meta.visibleWhen;
        if (!vw) return true;

        if (typeof vw === 'function') return vw(componentData);
        if (Array.isArray(vw)) return vw.every(rule => this.evalRule(rule, componentData));
        return this.evalRule(vw, componentData);
    }

    private evalRule(rule: VisibilityRule, data: Record<string, unknown>): boolean {
        const val = data[rule.field];
        if ('equals' in rule) return val === rule.equals;
        if ('notEquals' in rule) return val !== rule.notEquals;
        if ('oneOf' in rule) return rule.oneOf!.includes(val);
        return true;
    }
}

export const visibilityResolver = new VisibilityResolver();
