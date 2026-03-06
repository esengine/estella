import { getEditorContainer } from '../container';
import { MENU, MENU_ITEM, STATUSBAR_ITEM } from '../container/tokens';

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

export function registerMenu(descriptor: MenuDescriptor): void {
    getEditorContainer().provide(MENU, descriptor.id, descriptor);
}

export function registerMenuItem(item: MenuItemDescriptor): void {
    const c = getEditorContainer();
    if (c.has(MENU_ITEM, item.id)) return;
    c.provide(MENU_ITEM, item.id, item);
}

export function registerStatusbarItem(item: StatusbarItemDescriptor): void {
    getEditorContainer().provide(STATUSBAR_ITEM, item.id, item);
}

export function getAllMenus(): MenuDescriptor[] {
    return getEditorContainer().getOrdered(MENU);
}

export function getMenuItems(menuId: string): MenuItemDescriptor[] {
    return getEditorContainer().getOrdered(MENU_ITEM)
        .filter(item => item.menu === menuId);
}

export function getAllStatusbarItems(): StatusbarItemDescriptor[] {
    return getEditorContainer().getOrdered(STATUSBAR_ITEM);
}

export function getMenuItem(id: string): MenuItemDescriptor | undefined {
    return getEditorContainer().get(MENU_ITEM, id);
}
