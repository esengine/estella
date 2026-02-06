export {
    type MenuDescriptor,
    type MenuItemDescriptor,
    type StatusbarItemDescriptor,
    registerMenu,
    registerMenuItem,
    registerStatusbarItem,
    getAllMenus,
    getMenuItems,
    getAllStatusbarItems,
    getMenuItem,
} from './MenuRegistry';

export { ShortcutManager } from './ShortcutManager';
export { registerBuiltinMenus } from './builtinMenus';
export { registerBuiltinStatusbarItems } from './builtinStatusbar';
