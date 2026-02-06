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

export function registerMenu(descriptor: MenuDescriptor): void {
    menus.set(descriptor.id, descriptor);
    if (!menuItems.has(descriptor.id)) {
        menuItems.set(descriptor.id, []);
    }
}

export function registerMenuItem(item: MenuItemDescriptor): void {
    const items = menuItems.get(item.menu);
    if (items) {
        items.push(item);
    } else {
        menuItems.set(item.menu, [item]);
    }
}

export function registerStatusbarItem(item: StatusbarItemDescriptor): void {
    statusbarItems.set(item.id, item);
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
