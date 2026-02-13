/**
 * @file    ContextMenuRegistry.ts
 * @brief   Context menu contribution registry for extension-provided menu items
 */

import type { Entity } from 'esengine';
import type { EntityData } from '../types/SceneTypes';
import type { ContextMenuItem } from './ContextMenu';

// =============================================================================
// Types
// =============================================================================

export type ContextMenuLocation =
    | 'hierarchy.entity'
    | 'hierarchy.background'
    | 'content-browser.asset'
    | 'content-browser.folder'
    | 'inspector.component'
    | string;

export interface ContextMenuContext {
    location: ContextMenuLocation;
    entity?: Entity;
    entityData?: EntityData;
    assetPath?: string;
    assetType?: string;
    componentType?: string;
    [key: string]: unknown;
}

export interface ContextMenuContribution {
    id: string;
    location: ContextMenuLocation;
    label: string;
    icon?: string;
    shortcut?: string;
    group?: string;
    order?: number;
    visible?: (ctx: ContextMenuContext) => boolean;
    enabled?: (ctx: ContextMenuContext) => boolean;
    action: (ctx: ContextMenuContext) => void;
    children?: ContextMenuContribution[];
}

// =============================================================================
// Registry
// =============================================================================

const registry: ContextMenuContribution[] = [];
const builtinIds = new Set<string>();

export function registerContextMenuItem(contribution: ContextMenuContribution): void {
    registry.push(contribution);
}

export function lockBuiltinContextMenuItems(): void {
    for (const item of registry) {
        builtinIds.add(item.id);
    }
}

export function clearExtensionContextMenuItems(): void {
    for (let i = registry.length - 1; i >= 0; i--) {
        if (!builtinIds.has(registry[i].id)) {
            registry.splice(i, 1);
        }
    }
}

export function getContextMenuItems(location: ContextMenuLocation, ctx: ContextMenuContext): ContextMenuItem[] {
    const contributions = registry.filter(c => {
        if (c.location !== location) return false;
        if (c.visible && !c.visible(ctx)) return false;
        return true;
    });

    if (contributions.length === 0) return [];

    contributions.sort((a, b) => {
        const groupCmp = (a.group ?? '').localeCompare(b.group ?? '');
        if (groupCmp !== 0) return groupCmp;
        return (a.order ?? 0) - (b.order ?? 0);
    });

    const items: ContextMenuItem[] = [];
    let lastGroup: string | undefined;

    for (const c of contributions) {
        if (lastGroup !== undefined && c.group !== lastGroup) {
            items.push({ label: '', separator: true });
        }
        lastGroup = c.group;
        items.push(contributionToMenuItem(c, ctx));
    }

    return items;
}

function contributionToMenuItem(c: ContextMenuContribution, ctx: ContextMenuContext): ContextMenuItem {
    const item: ContextMenuItem = {
        label: c.label,
        icon: c.icon,
        shortcut: c.shortcut,
        disabled: c.enabled ? !c.enabled(ctx) : false,
        onClick: () => c.action(ctx),
    };

    if (c.children && c.children.length > 0) {
        item.children = c.children
            .filter(child => !child.visible || child.visible(ctx))
            .map(child => contributionToMenuItem(child, ctx));
    }

    return item;
}
