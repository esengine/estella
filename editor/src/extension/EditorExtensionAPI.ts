import type { EditorContainer } from '../container/EditorContainer';
import {
    PANEL, MENU, MENU_ITEM, STATUSBAR_ITEM,
    SETTINGS_SECTION, SETTINGS_ITEM,
    CONTEXT_MENU_ITEM, INSPECTOR_SECTION,
    COMPONENT_INSPECTOR, COMPONENT_SCHEMA,
    PROPERTY_EDITOR, GIZMO, EDITOR_STORE,
} from '../container/tokens';
import type { PanelInstance, PanelPosition } from '../panels/PanelRegistry';
import type { PropertyEditorFactory } from '../property/PropertyEditor';
import type { ComponentInspectorContext, ComponentInspectorInstance } from '../panels/inspector/InspectorRegistry';
import type { GizmoDescriptor } from '../gizmos/GizmoRegistry';
import type { ContextMenuLocation, ContextMenuContribution, ContextMenuContext } from '../ui/ContextMenuRegistry';
import type { SettingsItemDescriptor } from '../settings/SettingsRegistry';
import type { StatusbarItemDescriptor } from '../menus/MenuRegistry';
import type { ComponentSchema } from '../schemas/ComponentSchemas';
import type { EditorStore } from '../store/EditorStore';
import { BaseCommand } from '../commands/Command';
import { getSettingsValue, setSettingsValue, onSettingsChange } from '../settings/SettingsRegistry';
import { showToast } from '../ui/Toast';
import { showConfirmDialog, showInputDialog } from '../ui/dialog';

// =============================================================================
// Types
// =============================================================================

export interface Disposable {
    dispose(): void;
}

const NO_OP_DISPOSABLE: Disposable = { dispose() {} };

// =============================================================================
// ExtensionCommand
// =============================================================================

class ExtensionCommand extends BaseCommand {
    readonly type = 'extension';
    readonly description: string;
    readonly structural: boolean;
    private executeFn_: () => void;
    private undoFn_: () => void;

    constructor(opts: { label: string; execute: () => void; undo: () => void; structural?: boolean }) {
        super();
        this.description = opts.label;
        this.structural = opts.structural ?? false;
        this.executeFn_ = opts.execute;
        this.undoFn_ = opts.undo;
    }

    execute() { this.executeFn_(); }
    undo() { this.undoFn_(); }
}

// =============================================================================
// EditorExtensionAPI
// =============================================================================

export class EditorExtensionAPI {
    private subscriptions_: (() => void)[] = [];
    private container_: EditorContainer;
    private nextId_ = 0;

    constructor(container: EditorContainer) {
        this.container_ = container;
    }

    private generateId_(prefix: string): string {
        return `ext-${prefix}-${++this.nextId_}`;
    }

    private validate_(method: string, checks: [unknown, string][]): boolean {
        for (const [value, msg] of checks) {
            if (!value) {
                console.warn(`[Extension API] ${method}: ${msg}`);
                return false;
            }
        }
        return true;
    }

    private getStore_(): EditorStore {
        return this.container_.get(EDITOR_STORE, 'default')!;
    }

    // =========================================================================
    // Panel
    // =========================================================================

    addPanel(opts: {
        id: string;
        title: string;
        icon?: string;
        position?: PanelPosition;
        order?: number;
        render: (container: HTMLElement) => PanelInstance;
    }): Disposable {
        if (!this.validate_('addPanel', [
            [opts.id, 'opts.id is required'],
            [opts.title, 'opts.title is required'],
            [typeof opts.render === 'function', 'opts.render must be a function'],
        ])) return NO_OP_DISPOSABLE;
        if (this.container_.isBuiltin(PANEL, opts.id)) {
            console.warn(`[Extension] Cannot override builtin panel "${opts.id}"`);
            return NO_OP_DISPOSABLE;
        }
        this.container_.provide(PANEL, opts.id, {
            id: opts.id,
            title: opts.title,
            icon: opts.icon,
            position: opts.position ?? 'bottom',
            order: opts.order,
            factory: (c) => ({ instance: opts.render(c) }),
        });
        return NO_OP_DISPOSABLE;
    }

    // =========================================================================
    // Menu
    // =========================================================================

    addMenu(opts: { id: string; label: string; order?: number }): Disposable {
        if (this.container_.isBuiltin(MENU, opts.id)) {
            console.warn(`[Extension] Cannot override builtin menu "${opts.id}"`);
            return NO_OP_DISPOSABLE;
        }
        this.container_.provide(MENU, opts.id, opts);
        return NO_OP_DISPOSABLE;
    }

    addMenuItem(menu: string, opts: {
        id?: string;
        label: string;
        icon?: string;
        shortcut?: string;
        order?: number;
        enabled?: () => boolean;
        action: () => void;
    }): Disposable {
        if (!this.validate_('addMenuItem', [
            [opts.label, 'opts.label is required'],
        ])) return NO_OP_DISPOSABLE;
        const id = opts.id ?? this.generateId_(`${menu}-menuitem`);
        this.container_.provide(MENU_ITEM, id, {
            id,
            menu,
            label: opts.label,
            icon: opts.icon,
            shortcut: opts.shortcut,
            order: opts.order,
            enabled: opts.enabled,
            action: opts.action,
        });
        return NO_OP_DISPOSABLE;
    }

    // =========================================================================
    // Context Menu
    // =========================================================================

    addContextMenuItem(location: ContextMenuLocation, opts: {
        id?: string;
        label: string;
        icon?: string;
        group?: string;
        order?: number;
        visible?: (ctx: ContextMenuContext) => boolean;
        enabled?: (ctx: ContextMenuContext) => boolean;
        action: (ctx: ContextMenuContext) => void;
        children?: ContextMenuContribution[];
    }): Disposable {
        if (!this.validate_('addContextMenuItem', [
            [opts.label, 'opts.label is required'],
            [location, 'location is required'],
        ])) return NO_OP_DISPOSABLE;
        const id = opts.id ?? this.generateId_('ctxmenu');
        this.container_.provide(CONTEXT_MENU_ITEM, id, {
            id,
            location,
            label: opts.label,
            icon: opts.icon,
            group: opts.group,
            order: opts.order,
            visible: opts.visible,
            enabled: opts.enabled,
            action: opts.action,
            children: opts.children,
        });
        return NO_OP_DISPOSABLE;
    }

    // =========================================================================
    // Property Editor
    // =========================================================================

    addPropertyEditor(typeName: string, factory: PropertyEditorFactory): Disposable {
        this.container_.provide(PROPERTY_EDITOR, typeName, factory);
        return NO_OP_DISPOSABLE;
    }

    // =========================================================================
    // Component Inspector
    // =========================================================================

    addComponentInspector(
        componentType: string,
        render: (container: HTMLElement, ctx: ComponentInspectorContext) => ComponentInspectorInstance,
    ): Disposable {
        if (!this.validate_('addComponentInspector', [
            [componentType, 'componentType is required'],
            [typeof render === 'function', 'render must be a function'],
        ])) return NO_OP_DISPOSABLE;
        const id = this.generateId_('inspector');
        this.container_.provide(COMPONENT_INSPECTOR, componentType, {
            id,
            componentType,
            render,
        });
        return NO_OP_DISPOSABLE;
    }

    // =========================================================================
    // Inspector Section
    // =========================================================================

    addInspectorSection(opts: {
        id: string;
        title: string;
        icon?: string;
        order?: number;
        target: 'entity' | 'asset' | 'both';
        visible?: (ctx: any) => boolean;
        render: (container: HTMLElement, ctx: any) => { dispose(): void; update?(): void };
    }): Disposable {
        if (!this.validate_('addInspectorSection', [
            [opts.id, 'opts.id is required'],
            [typeof opts.render === 'function', 'opts.render must be a function'],
        ])) return NO_OP_DISPOSABLE;
        this.container_.provide(INSPECTOR_SECTION, opts.id, {
            id: opts.id,
            title: opts.title,
            icon: opts.icon,
            order: opts.order,
            target: opts.target,
            visible: opts.visible,
            render: opts.render,
        });
        return NO_OP_DISPOSABLE;
    }

    // =========================================================================
    // Component Schema
    // =========================================================================

    addComponentSchema(schema: ComponentSchema): Disposable {
        if (!this.validate_('addComponentSchema', [
            [schema?.name, 'schema.name is required'],
        ])) return NO_OP_DISPOSABLE;
        this.container_.provide(COMPONENT_SCHEMA, schema.name, schema);
        return NO_OP_DISPOSABLE;
    }

    // =========================================================================
    // Gizmo
    // =========================================================================

    addGizmo(descriptor: GizmoDescriptor): Disposable {
        if (!this.validate_('addGizmo', [
            [descriptor?.id, 'descriptor.id is required'],
        ])) return NO_OP_DISPOSABLE;
        if (this.container_.isBuiltin(GIZMO, descriptor.id)) {
            console.warn(`[Extension] Cannot override builtin gizmo "${descriptor.id}"`);
            return NO_OP_DISPOSABLE;
        }
        this.container_.provide(GIZMO, descriptor.id, descriptor);
        return NO_OP_DISPOSABLE;
    }

    // =========================================================================
    // Settings
    // =========================================================================

    addSettingsSection(opts: {
        id: string;
        title: string;
        icon?: string;
        order?: number;
    }): Disposable {
        if (!this.validate_('addSettingsSection', [
            [opts.id, 'opts.id is required'],
            [opts.title, 'opts.title is required'],
        ])) return NO_OP_DISPOSABLE;
        if (this.container_.isBuiltin(SETTINGS_SECTION, opts.id)) {
            console.warn(`[Extension] Cannot override builtin settings section "${opts.id}"`);
            return NO_OP_DISPOSABLE;
        }
        this.container_.provide(SETTINGS_SECTION, opts.id, opts);
        return NO_OP_DISPOSABLE;
    }

    addSettingsItem(opts: SettingsItemDescriptor): Disposable {
        if (!this.validate_('addSettingsItem', [
            [opts.id, 'opts.id is required'],
            [opts.section, 'opts.section is required'],
        ])) return NO_OP_DISPOSABLE;
        if (this.container_.isBuiltin(SETTINGS_ITEM, opts.id)) {
            console.warn(`[Extension] Cannot override builtin settings item "${opts.id}"`);
            return NO_OP_DISPOSABLE;
        }
        this.container_.provide(SETTINGS_ITEM, opts.id, opts);
        return NO_OP_DISPOSABLE;
    }

    // =========================================================================
    // Statusbar
    // =========================================================================

    addStatusbarItem(opts: StatusbarItemDescriptor): Disposable {
        if (this.container_.isBuiltin(STATUSBAR_ITEM, opts.id)) {
            console.warn(`[Extension] Cannot override builtin statusbar item "${opts.id}"`);
            return NO_OP_DISPOSABLE;
        }
        this.container_.provide(STATUSBAR_ITEM, opts.id, opts);
        return NO_OP_DISPOSABLE;
    }

    // =========================================================================
    // Commands (Undo/Redo)
    // =========================================================================

    executeCommand(command: {
        label: string;
        execute: () => void;
        undo: () => void;
        structural?: boolean;
    }): void {
        if (!this.validate_('executeCommand', [
            [typeof command.execute === 'function', 'command.execute must be a function'],
            [typeof command.undo === 'function', 'command.undo must be a function'],
        ])) return;
        this.getStore_().executeCommand(new ExtensionCommand(command));
    }

    // =========================================================================
    // Events
    // =========================================================================

    onSelectionChange(callback: (selectedEntities: Set<number>) => void): Disposable {
        const store = this.getStore_();
        const unsub = store.subscribe((state, flags) => {
            if (flags?.has('selection')) callback(state.selectedEntities);
        });
        this.subscriptions_.push(unsub);
        return { dispose: unsub };
    }

    onSceneChange(callback: () => void): Disposable {
        const store = this.getStore_();
        const unsub = store.subscribe((_state, flags) => {
            if (flags?.has('scene') || flags?.has('hierarchy') || flags?.has('property')) {
                callback();
            }
        });
        this.subscriptions_.push(unsub);
        return { dispose: unsub };
    }

    onPropertyChange(callback: (event: {
        entity: number;
        componentType: string;
        propertyName: string;
        oldValue: unknown;
        newValue: unknown;
    }) => void): Disposable {
        const store = this.getStore_();
        const unsub = store.subscribeToPropertyChanges(callback);
        this.subscriptions_.push(unsub);
        return { dispose: unsub };
    }

    onEntityLifecycle(callback: (event: {
        entity: number;
        type: 'created' | 'deleted';
        parent: number | null;
    }) => void): Disposable {
        const store = this.getStore_();
        const unsub = store.subscribeToEntityLifecycle(callback);
        this.subscriptions_.push(unsub);
        return { dispose: unsub };
    }

    onComponentChange(callback: (event: {
        entity: number;
        componentType: string;
        action: 'added' | 'removed';
    }) => void): Disposable {
        const store = this.getStore_();
        const unsub = store.subscribeToComponentChanges(callback);
        this.subscriptions_.push(unsub);
        return { dispose: unsub };
    }

    onSettingsChange(callback: (id: string, value: unknown) => void): Disposable {
        const unsub = onSettingsChange(callback);
        this.subscriptions_.push(unsub);
        return { dispose: unsub };
    }

    // =========================================================================
    // Accessors
    // =========================================================================

    get store(): EditorStore {
        return this.getStore_();
    }

    getSettingsValue<T = unknown>(id: string): T {
        return getSettingsValue(id) as T;
    }

    setSettingsValue(id: string, value: unknown): void {
        setSettingsValue(id, value);
    }

    // =========================================================================
    // UI Utilities
    // =========================================================================

    showToast(title: string, type: 'info' | 'success' | 'error' = 'info'): void {
        showToast({ type, title });
    }

    showConfirmDialog(opts: { title: string; message: string }): Promise<boolean> {
        return showConfirmDialog(opts);
    }

    showInputDialog(opts: { title: string; placeholder?: string; defaultValue?: string }): Promise<string | null> {
        return showInputDialog(opts);
    }

    // =========================================================================
    // CSS
    // =========================================================================

    addStylesheet(css: string): Disposable {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
        this.subscriptions_.push(() => style.remove());
        return { dispose: () => style.remove() };
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    onDispose(callback: () => void): void {
        this.subscriptions_.push(callback);
    }

    dispose(): void {
        for (let i = this.subscriptions_.length - 1; i >= 0; i--) {
            try { this.subscriptions_[i](); } catch {}
        }
        this.subscriptions_ = [];
    }
}
