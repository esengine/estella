export interface MenuDescriptor {
    id: string;
    label: string;
    order?: number;
}

export interface MenuItemDescriptor {
    id: string;
    menu: string;
    label: string;
    icon?: string;
    shortcut?: string;
    separator?: boolean;
    order?: number;
    enabled?: () => boolean;
    action: () => void;
    hidden?: boolean;
}

export interface StatusbarItemDescriptor {
    id: string;
    position: 'left' | 'right';
    order?: number;
    render: (container: HTMLElement) => { dispose(): void; update?(): void };
}

const menus = new Map<string, MenuDescriptor>();
const menuItems = new Map<string, MenuItemDescriptor[]>();
const statusbarItems = new Map<string, StatusbarItemDescriptor>();
const builtinMenuIds = new Set<string>();
const builtinMenuItemIds = new Set<string>();
const builtinStatusbarIds = new Set<string>();

export function registerMenu(descriptor: MenuDescriptor): void {
    menus.set(descriptor.id, descriptor);
    if (!menuItems.has(descriptor.id)) {
        menuItems.set(descriptor.id, []);
    }
}

export function registerMenuItem(item: MenuItemDescriptor): void {
    const items = menuItems.get(item.menu);
    if (items) {
        if (items.some(i => i.id === item.id)) return;
        items.push(item);
    } else {
        menuItems.set(item.menu, [item]);
    }
}

export function registerStatusbarItem(item: StatusbarItemDescriptor): void {
    statusbarItems.set(item.id, item);
}

export function lockBuiltinMenus(): void {
    for (const id of menus.keys()) builtinMenuIds.add(id);
    for (const items of menuItems.values()) {
        for (const item of items) builtinMenuItemIds.add(item.id);
    }
    for (const id of statusbarItems.keys()) builtinStatusbarIds.add(id);
}

export function clearExtensionMenus(): void {
    for (const id of menus.keys()) {
        if (!builtinMenuIds.has(id)) menus.delete(id);
    }
    for (const [menuId, items] of menuItems.entries()) {
        menuItems.set(menuId, items.filter(i => builtinMenuItemIds.has(i.id)));
    }
    for (const id of statusbarItems.keys()) {
        if (!builtinStatusbarIds.has(id)) statusbarItems.delete(id);
    }
}

export function getAllMenus(): MenuDescriptor[] {
    return Array.from(menus.values()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function getMenuItems(menuId: string): MenuItemDescriptor[] {
    return (menuItems.get(menuId) ?? []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function getAllStatusbarItems(): StatusbarItemDescriptor[] {
    return Array.from(statusbarItems.values()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function getMenuItem(id: string): MenuItemDescriptor | undefined {
    for (const items of menuItems.values()) {
        const found = items.find(i => i.id === id);
        if (found) return found;
    }
    return undefined;
}
