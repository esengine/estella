// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App } from '../../app/app';
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { Name, registerComponent } from '../../ecs/component';
import { Schedule, defineSystem } from '../../ecs/system';
import { Input } from '../../input/input';
import { primaryPointerCancellationVersion } from '../../input/pointerCancellation';
import { playModeOnly } from '../../ecs/env';
import { worldEngineApi } from '../../ecs/bridge/engineApi';
import { UITreeView, type UITreeViewData, type TreeViewNode } from '../behavior/tree-view';
import { TreeViewModel, type TreeDataSource, type TreeItemId, type TreeRow, type TreeDropRequest } from '../collection/tree-data-source';
import { createListView, type ListViewHandle, type ListViewHost, type ListItemTemplate } from './list-view';
import { spawnUIEntity, type UINodeInit } from '../core/compose';
import { UINode, UIDisplay, UIPointerEvents } from '../core/ui-node';
import { UIVisual } from '../core/ui-visual';
import { Text, TextAlign, TextVerticalAlign, TextOverflow } from '../core/text';
import { px, auto } from '../core/dimension';
import { UIEvents, UIEventType, type UIEventQueue } from '../core/events';
import { makeWidgetInteractable, Interactable, UIInteraction } from '../input/interactable';
import { FocusManager } from '../input/focusable';
import { Focusable } from '../input/focusable';
import { moveUIFocus } from '../input/focus-transition';
import { createLocalTransformReader } from '../util/local-transform';
import { isScreenEntity } from '../util/ui-pick';
import { UIConsumesDrag } from '../input/drag-consumption';
import { isFocusEligible } from '../input/focus-inspection';
import { UIControlPointers, type ControlPointer } from '../input/control-pointers';
import { themeColors } from '../theme/tokens';
import { markThemed } from '../theme/theme-style';
import { log } from '../../util/logger';
import type { PrefabServer } from '../../prefab/prefabServer';

/** Generic data, optional custom row template, and host-owned drop policy. @beta */
export interface TreeViewOptions<T = TreeViewNode> {
    world: World;
    events: UIEventQueue;
    parent?: Entity;
    node?: UINodeInit;
    data?: TreeDataSource<T>;
    nodes?: TreeViewNode[];
    settings?: Partial<Omit<UITreeViewData, 'nodes'>>;
    item?: ListItemTemplate<TreeRow<T>>;
    /** A custom template can nominate its drag grip; the rest of the row scrolls. */
    dragHandle?: (rowEntity: Entity) => Entity;
    canDrop?: (request: TreeDropRequest<T>) => boolean;
    onDrop?: (request: TreeDropRequest<T>) => void;
    onChange?: (ids: readonly TreeItemId[]) => void;
}
/** Stable identity and explicit refresh keep application data authoritative. @beta */
export interface TreeViewHandle<T = TreeViewNode> {
    readonly entity: Entity;
    getModel(): TreeViewModel<T> | undefined;
    refresh(): void;
    reveal(id: TreeItemId): void;
    dispose(): void;
}

interface Binding {
    options: Omit<TreeViewOptions<unknown>, 'events'>;
    model?: TreeViewModel<unknown>;
    list?: ListViewHandle<TreeRow<unknown>>;
}
const bindings = new WeakMap<World, Map<Entity, Binding>>();
function bindingsFor(world: World): Map<Entity, Binding> {
    let map = bindings.get(world); if (!map) bindings.set(world, map = new Map()); return map;
}

/** Bind project data to an authored TreeView; disposal restores the previous adapter. @beta */
export function setTreeViewData<T>(world: World, entity: Entity, data: TreeDataSource<T>,
    options: Pick<TreeViewOptions<T>, 'item' | 'dragHandle' | 'canDrop' | 'onDrop'> = {}): () => void {
    if (!world.valid(entity) || !world.has(entity, UITreeView)) throw new Error('Expected an entity with UITreeView');
    const map = bindingsFor(world), binding = map.get(entity) ?? { options: { world } };
    const previous = binding.options;
    const next = { ...previous, ...options, data } as Omit<TreeViewOptions<unknown>, 'events'>;
    binding.options = next; map.set(entity, binding);
    if (binding.model?.source === data) binding.model.refresh();
    return () => { if (map.get(entity) === binding && binding.options === next) binding.options = previous; };
}

/** Factories and authored prefabs enter the same composed UI runtime. @beta */
export function createTreeView<T = TreeViewNode>(opts: TreeViewOptions<T>): TreeViewHandle<T> {
    const { world, events } = opts;
    const entity = spawnUIEntity({ world, parent: opts.parent,
        node: opts.node ?? { width: px(320), height: px(320) }, visual: { color: themeColors().surface } });
    markThemed(world, entity, { visual: 'surface' }); makeWidgetInteractable(world, entity);
    world.insert(entity, UITreeView, { ...structuredClone(UITreeView._default), ...opts.settings, nodes: opts.nodes ?? [] });
    const binding: Binding = { options: opts as unknown as TreeViewOptions<unknown> }; bindingsFor(world).set(entity, binding);
    const off = opts.onChange ? events.on(entity, UIEventType.Change, event => opts.onChange!((event.data as { ids: TreeItemId[] }).ids)) : undefined;
    return { entity, getModel: () => binding.model as TreeViewModel<T> | undefined,
        refresh() { binding.model?.refresh(); },
        reveal(id) { binding.model?.reveal(id); const index = binding.model?.indexOf(id) ?? -1; if (index >= 0) binding.list?.scrollToIndex(index); },
        dispose() { off?.(); binding.list?.dispose(); binding.model?.dispose(); bindingsFor(world).delete(entity); if (world.valid(entity)) world.despawn(entity); } };
}

interface Runtime {
    binding: Binding;
    model: TreeViewModel<unknown>;
    list: ListViewHandle<TreeRow<unknown>>;
    rowIds: Map<Entity, TreeItemId>;
    grips: Map<Entity, Entity>;
    targets: Map<Entity, Entity>;
    cues: Map<Entity, Entity>;
    cueRow: Entity | null;
    unsubs: Array<() => void>;
    config: string;
    nodes: TreeViewNode[];
    snapshot: string;
    empty: Entity;
    disposed: boolean;
    drag: { id: TreeItemId; pointer: number; x: number; y: number; moved: boolean } | null;
    activeId: TreeItemId | null;
    externalSource?: TreeDataSource<unknown>;
    itemTemplate?: ListItemTemplate<TreeRow<unknown>>;
    dragHandle?: (row: Entity) => Entity;
    selectionSnapshot: string;
}

/** @internal Installed by UIPlugin after the behavior/collection host exists. */
export function installTreeViews(app: App, host: ListViewHost): () => void {
    registerComponent('UITreeView', UITreeView);
    const playing = (): boolean => playModeOnly() && !app.isPaused() && !app.isExecutionHeld();
    const world = app.world, events = app.getResource(UIEvents), live = new Map<Entity, Runtime>();
    const engine = worldEngineApi(world), registry = world.getCppRegistry();
    const local = createLocalTransformReader(world);
    let cancellation = primaryPointerCancellationVersion(app.getResource(Input));
    const available = (e: Entity): boolean => world.valid(e) && world.isEntityActive(e) && !world.isDestructionPending(e)
        && (!world.has(e, Interactable) || world.get(e, Interactable).enabled)
        && !engine?.getUINodeHiddenInTree?.(registry!, e);
    const destroy = (root: Entity, runtime: Runtime): void => {
        runtime.disposed = true; runtime.unsubs.forEach(off => off()); runtime.list.dispose(); runtime.model.dispose();
        runtime.binding.model = undefined; runtime.binding.list = undefined;
        if (world.valid(runtime.list.entity)) world.despawn(runtime.list.entity);
        if (world.valid(runtime.empty)) world.despawn(runtime.empty);
        live.delete(root);
    };
    const writeState = (root: Entity, runtime: Runtime): void => {
        if (!world.valid(root) || !world.has(root, UITreeView)) return;
        const data = world.get(root, UITreeView);
        const selectedIds = [...runtime.model.selectedIds], expandedIds = [...runtime.model.expandedIds];
        runtime.snapshot = JSON.stringify([expandedIds, selectedIds]);
        if (runtime.snapshot === JSON.stringify([data.expandedIds, data.selectedIds])) return;
        world.insert(root, UITreeView, { ...data, selectedIds, expandedIds });
    };
    const style = (ref: string, parent: Entity, runtime: Runtime, ready?: (entities: Entity[], styleRoot: Entity) => void): void => {
        if (!ref) return;
        const prefabs = app.getResourceByName('Prefabs') as PrefabServer | undefined;
        if (!prefabs) return;
        void prefabs.instantiate(ref, { parent, scene: false }).then(result => {
            if (runtime.disposed || !world.valid(parent)) { if (world.valid(result.root)) world.despawn(result.root); return; }
            if (!world.has(result.root, UINode)) { world.despawn(result.root); throw new Error('TreeView style prefabs require a UINode root'); }
            const node = world.get(result.root, UINode);
            world.insert(result.root, UINode, { ...node, position: 1, insetLeft: px(0), insetTop: px(0), insetRight: px(0), insetBottom: px(0), width: auto(), height: auto(), pointerEvents: UIPointerEvents.None });
            for (const entity of result.entities.values()) {
                if (world.has(entity, Focusable)) world.remove(entity, Focusable);
                if (world.has(entity, Interactable)) world.remove(entity, Interactable);
            }
            ready?.([...result.entities.values()], result.root);
            runtime.list.refresh();
        }).catch(error => log.error('ui', 'TreeView style prefab failed', error));
    };
    const dropAt = (runtime: Runtime, pointer: ControlPointer): { row: Entity; request: TreeDropRequest<unknown> } | null => {
        const source = runtime.drag ? runtime.model.getNode(runtime.drag.id) : undefined;
        if (!source) return null;
        for (const [targetEntity, row] of runtime.targets) {
            if (!world.valid(targetEntity) || !world.has(targetEntity, UIInteraction) || !world.get(targetEntity, UIInteraction).hovered) continue;
            const id = runtime.rowIds.get(row), target = id === undefined ? undefined : runtime.model.getNode(id);
            if (!target) continue;
            const screen = isScreenEntity(world, row), point = local.point(row, screen ? pointer.layoutX : pointer.worldX, screen ? pointer.layoutY : pointer.worldY);
            const height = engine?.getUINodeComputedHeight?.(registry!, row) ?? 0;
            const position = point && height > 0 ? point.y > height / 6 ? 'before' : point.y < -height / 6 ? 'after' : 'inside' : 'after';
            const request: TreeDropRequest<unknown> = { source, target, position };
            if (runtime.model.canDrop(request) && runtime.binding.options.canDrop?.(request) !== false) return { row, request };
        }
        return null;
    };
    const showDrop = (runtime: Runtime, candidate: ReturnType<typeof dropAt>): void => {
        if (runtime.cueRow !== null && runtime.cueRow !== candidate?.row) {
            const previous = runtime.cues.get(runtime.cueRow);
            if (previous && world.valid(previous)) world.update(previous, UINode, node => { node.display = UIDisplay.None; });
        }
        runtime.cueRow = candidate?.row ?? null;
        const cue = candidate ? runtime.cues.get(candidate.row) : undefined;
        if (!cue || !world.valid(cue)) return;
        const height = engine?.getUINodeComputedHeight?.(registry!, candidate!.row) ?? 32;
        const position = candidate!.request.position;
        world.update(cue, UINode, node => {
            node.display = UIDisplay.Flex; node.height = px(position === 'inside' ? height : 2);
            node.insetTop = px(position === 'after' ? height - 2 : 0); node.opacity = position === 'inside' ? .2 : 1;
        });
    };
    app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
        const version = primaryPointerCancellationVersion(app.getResource(Input)), cancelled = version !== cancellation;
        if (cancelled) { cancellation = version; for (const runtime of live.values()) runtime.drag = null; }
        const roots = new Set(world.getEntitiesWithComponents([UITreeView]));
        for (const [root, runtime] of live) if (!roots.has(root) || !world.valid(root)) destroy(root, runtime);
        for (const root of roots) {
            if (!world.valid(root) || !world.has(root, UINode)) continue;
            if (!world.has(root, Interactable)) makeWidgetInteractable(world, root);
            const data = world.get(root, UITreeView);
            const config = JSON.stringify([data.rowHeight, data.indent, data.rowPrefab, data.emptyPrefab, data.dragEnabled]);
            let runtime = live.get(root);
            const priorSelection = runtime?.model.selectedIds;
            const bindingOptions = bindingsFor(world).get(root)?.options;
            if (runtime && (runtime.config !== config || runtime.externalSource !== bindingOptions?.data
                || runtime.itemTemplate !== bindingOptions?.item || runtime.dragHandle !== bindingOptions?.dragHandle)) { destroy(root, runtime); runtime = undefined; }
            if (!runtime) {
                const binding: Binding = bindingsFor(world).get(root) ?? { options: { world } };
                const source: TreeDataSource<unknown> = binding.options.data ?? {
                    getRoots: () => world.get(root, UITreeView).nodes,
                    getChildren: item => (item as TreeViewNode).children ?? [], getId: item => (item as TreeViewNode).id,
                    getLabel: item => (item as TreeViewNode).label, isSelectable: item => (item as TreeViewNode).selectable !== false,
                };
                const model = new TreeViewModel(source, data.expandedIds); model.select(data.selectedIds, data.selectionMode);
                const rowIds = new Map<Entity, TreeItemId>(), grips = new Map<Entity, Entity>(), targets = new Map<Entity, Entity>(), cues = new Map<Entity, Entity>(), unsubs: Array<() => void> = [];
                const height = Math.max(12, Number.isFinite(data.rowHeight) ? data.rowHeight : 32);
                const item = binding.options.item;
                const labels = new Map<Entity, Entity>(), arrows = new Map<Entity, Entity>();
                const measuredWidth = engine?.getUINodeComputedWidth?.(registry!, root) ?? 0;
                const measuredHeight = engine?.getUINodeComputedHeight?.(registry!, root) ?? 0;
                const viewportSize = { x: Number.isFinite(measuredWidth) && measuredWidth > 0 ? measuredWidth : 320,
                    y: Number.isFinite(measuredHeight) && measuredHeight > 0 ? measuredHeight : 320 };
                const list = createListView({ world, host, parent: root, node: { fill: true }, viewportSize,
                    data: model, layout: { itemHeight: height }, dragScroll: true,
                    item: { create(w, parent) {
                        const rowEntity = item ? item.create(w, parent) : spawnUIEntity({ world: w, parent, node: { height: px(height) }, visual: { color: themeColors().surface } });
                        makeWidgetInteractable(w, rowEntity, { focusable: false });
                        targets.set(rowEntity, rowEntity);
                        if (!item) {
                            const label = spawnUIEntity({ world: w, parent: rowEntity, node: { fill: true, insetLeft: px(28), insetRight: px(data.dragEnabled ? 28 : 4) }, text: { content: '', fontSize: 14, color: themeColors().text, align: TextAlign.Left, verticalAlign: TextVerticalAlign.Middle, wordWrap: false, overflow: TextOverflow.Ellipsis } });
                            const arrow = spawnUIEntity({ world: w, parent: rowEntity, node: { position: 1, width: px(24), height: px(height), insetLeft: px(0), insetTop: px(0) }, text: { content: '', fontSize: 14, color: themeColors().text, align: TextAlign.Center, verticalAlign: TextVerticalAlign.Middle } });
                            labels.set(rowEntity, label); arrows.set(rowEntity, arrow);
                            markThemed(w, label, { text: 'text' }); markThemed(w, arrow, { text: 'text' });
                            makeWidgetInteractable(w, arrow, { focusable: false });
                            targets.set(arrow, rowEntity);
                            unsubs.push(events.on(arrow, UIEventType.Click, event => {
                                event.stopPropagation();
                                if (!playing() || !available(root)) return;
                                const id = rowIds.get(rowEntity); if (id === undefined) return;
                                live.get(root)!.activeId = id;
                                model.toggle(id); moveUIFocus(world, events, app.getResource(FocusManager), root, false);
                                writeState(root, live.get(root)!);
                            }));
                            if (data.rowPrefab) style(data.rowPrefab, rowEntity, live.get(root)!, (entities, styleRoot) => {
                                const styledLabel = entities.find(entity => world.has(entity, Text) && world.has(entity, UINode));
                                if (styledLabel) { if (world.valid(label)) world.despawn(label); labels.set(rowEntity, styledLabel); }
                                // Keep behavior affordances above a style's opaque background.
                                const controls = [arrow, ...[...grips].filter(([, owner]) => owner === rowEntity).map(([grip]) => grip), cues.get(rowEntity)];
                                for (const control of controls) if (control && world.valid(control)) { world.setParent(control, styleRoot); world.setParent(control, rowEntity); }
                            });
                        }
                        if (data.dragEnabled) {
                            const grip = item ? binding.options.dragHandle?.(rowEntity) ?? rowEntity : spawnUIEntity({ world: w, parent: rowEntity,
                                node: { position: 1, insetRight: px(0), insetTop: px(0), width: px(24), height: px(height) },
                                text: { content: '⠿', fontSize: 14, color: themeColors().text, align: TextAlign.Center, verticalAlign: TextVerticalAlign.Middle } });
                            if (w.valid(grip)) { makeWidgetInteractable(w, grip, { focusable: false }); w.insert(grip, UIConsumesDrag); grips.set(grip, rowEntity); targets.set(grip, rowEntity); }
                            const cue = spawnUIEntity({ world: w, parent: rowEntity, node: { position: 1, insetLeft: px(0), insetRight: px(0), insetTop: px(0), height: px(2), pointerEvents: UIPointerEvents.None }, visual: { color: themeColors().primary } });
                            w.update(cue, UINode, node => { node.display = UIDisplay.None; }); cues.set(rowEntity, cue); markThemed(w, cue, { visual: 'primary' });
                        }
                        unsubs.push(events.on(rowEntity, UIEventType.Click, () => {
                            if (!playing() || !available(root)) return;
                            const id = rowIds.get(rowEntity); if (id === undefined) return;
                            if (live.get(root)?.drag?.moved) return;
                            const row = model.getNode(id); if (!row) return;
                            const current = world.get(root, UITreeView), input = app.getResource(Input);
                            moveUIFocus(world, events, app.getResource(FocusManager), root, false);
                            live.get(root)!.activeId = id;
                            const multi = current.selectionMode === 2 && (input.isKeyDown('ControlLeft') || input.isKeyDown('ControlRight') || input.isKeyDown('MetaLeft') || input.isKeyDown('MetaRight'));
                            model.select(multi ? model.isSelected(id) ? model.selectedIds.filter(value => value !== id) : [...model.selectedIds, id] : [id], current.selectionMode);
                            writeState(root, live.get(root)!);
                        }));
                        return rowEntity;
                    }, bind(rowEntity, row, index) {
                        rowIds.set(rowEntity, row.id);
                        if (!item) {
                            world.insert(rowEntity, Name, { value: `TreeRow:${row.id}` });
                            const arrow = arrows.get(rowEntity); if (arrow) world.insert(arrow, Name, { value: `TreeDisclosure:${row.id}` });
                            for (const [grip, owner] of grips) if (owner === rowEntity) world.insert(grip, Name, { value: `TreeDrag:${row.id}` });
                        }
                        if (item) { item.bind(rowEntity, row, index); return; }
                        const label = labels.get(rowEntity)!, arrow = arrows.get(rowEntity)!;
                        const indent = row.depth * (Number.isFinite(data.indent) ? Math.max(0, data.indent) : 20);
                        world.update(label, Text, text => { text.content = source.getLabel(row.item); });
                        world.update(label, UINode, node => { node.insetLeft = px(indent + 28); });
                        world.update(arrow, Text, text => { text.content = row.hasChildren ? row.expanded ? '⌄' : '›' : ''; });
                        world.update(arrow, UINode, node => { node.insetLeft = px(indent); });
                        const role = model.isSelected(row.id) ? 'controlFocus' : 'surface';
                        world.update(rowEntity, UIVisual, visual => { visual.color = themeColors()[role]; }); markThemed(world, rowEntity, { visual: role });
                    } } });
                const empty = spawnUIEntity({ world, parent: root, node: { fill: true }, text: { content: 'No items', fontSize: 14, color: themeColors().text } });
                markThemed(world, empty, { text: 'text' });
                runtime = { binding, model, list, rowIds, grips, targets, cues, cueRow: null, unsubs, config, nodes: data.nodes, snapshot: '', empty, disposed: false, drag: null,
                    activeId: model.selectedIds[model.selectedIds.length - 1] ?? null,
                    externalSource: binding.options.data, itemTemplate: binding.options.item, dragHandle: binding.options.dragHandle,
                    selectionSnapshot: JSON.stringify(priorSelection ?? model.selectedIds) };
                live.set(root, runtime); binding.model = model; binding.list = list;
                unsubs.push(events.on(root, UIEventType.Click, event => {
                    if (event.target !== root || !playing() || !available(root)) return;
                    const current = live.get(root), id = current?.activeId;
                    if (id == null) return;
                    const mode = world.get(root, UITreeView).selectionMode;
                    model.select(mode === 2 ? model.isSelected(id) ? model.selectedIds.filter(value => value !== id) : [...model.selectedIds, id] : [id], mode);
                    writeState(root, current!);
                }));
                const syncState = (): void => {
                    const current = live.get(root); if (!current || current.disposed) return;
                    list.refresh();
                    if (playing()) writeState(root, current);
                    const selection = JSON.stringify(model.selectedIds);
                    if (current.selectionSnapshot !== selection) { current.selectionSnapshot = selection; if (playing()) events.emit(root, UIEventType.Change, { ids: model.selectedIds }); }
                };
                runtime.unsubs.push(model.subscribe(syncState)); syncState();
                if (data.emptyPrefab) {
                    world.update(empty, Text, text => {
                        text.content = '';
                    });
                    style(data.emptyPrefab, empty, runtime);
                }
            }
            if (!runtime.binding.options.data && runtime.nodes !== data.nodes) { runtime.nodes = data.nodes; runtime.model.refresh(); }
            const snapshot = JSON.stringify([data.expandedIds, data.selectedIds]);
            if (runtime.snapshot !== snapshot) { runtime.snapshot = snapshot; runtime.model.setExpanded(data.expandedIds); runtime.model.select(data.selectedIds, data.selectionMode); runtime.activeId = runtime.model.selectedIds[runtime.model.selectedIds.length - 1] ?? runtime.activeId; }
            const emptyDisplay = runtime.model.getCount() ? 1 : 0;
            if (world.get(runtime.empty, UINode).display !== emptyDisplay) world.update(runtime.empty, UINode, node => { node.display = emptyDisplay; });
            if (!playing() || !available(root)) { runtime.drag = null; showDrop(runtime, null); continue; }
            const input = app.getResource(Input), focus = app.getResource(FocusManager);
            if (focus.focusedEntity === root && isFocusEligible(world, root)) {
                const model = runtime.model, current = runtime.activeId, index = current == null ? -1 : model.indexOf(current);
                let next = index;
                if (input.isKeyPressed('ArrowDown')) next = Math.min(model.getCount() - 1, index + 1);
                if (input.isKeyPressed('ArrowUp')) next = Math.max(0, index - 1);
                if (input.isKeyPressed('Home')) next = 0; if (input.isKeyPressed('End')) next = model.getCount() - 1;
                const node = current == null ? undefined : model.getNode(current);
                if (node && input.isKeyPressed('ArrowRight')) { if (!node.expanded) model.setExpanded([...model.expandedIds, node.id]); else next = Math.min(model.getCount() - 1, index + 1); }
                if (node && input.isKeyPressed('ArrowLeft')) { if (node.expanded) model.setExpanded(model.expandedIds.filter(id => id !== node.id)); else next = node.parentId == null ? index : model.indexOf(node.parentId); }
                if (next >= 0 && next < model.getCount() && next !== index) {
                    const direction = next >= index ? 1 : -1;
                    while (next >= 0 && next < model.getCount() && !model.getItem(next).selectable) next += direction;
                    if (next >= 0 && next < model.getCount()) {
                        runtime.activeId = model.getItem(next).id;
                        model.select([runtime.activeId], data.selectionMode); runtime.list.scrollToIndex(next);
                    }
                }
                writeState(root, runtime);
            }
            if (data.dragEnabled && !cancelled) {
                const pointers = app.getResource(UIControlPointers).pointers;
                for (const pointer of pointers.values()) if (pointer.pressedEntity != null && runtime.grips.has(pointer.pressedEntity)) {
                    const row = runtime.grips.get(pointer.pressedEntity)!;
                    runtime.drag = { id: runtime.rowIds.get(row)!, pointer: pointer.id, x: pointer.layoutX, y: pointer.layoutY, moved: false };
                }
                const drag = runtime.drag, pointer = drag ? pointers.get(drag.pointer) : undefined;
                if (drag && pointer) {
                    drag.moved ||= Math.hypot(pointer.layoutX - drag.x, pointer.layoutY - drag.y) > 5;
                    const candidate = drag.moved ? dropAt(runtime, pointer) : null;
                    showDrop(runtime, candidate);
                    if (!pointer.down) {
                        runtime.drag = null;
                        showDrop(runtime, null);
                        if (candidate) {
                            runtime.binding.options.onDrop?.(candidate.request); events.emit(root, 'drop_request', candidate.request);
                        }
                    }
                } else { if (drag) runtime.drag = null; showDrop(runtime, null); }
            } else showDrop(runtime, null);
        }
    }, { name: 'UITreeViewSystem', runAfter: ['FocusSystem'], runBefore: ['ListViewSystem'] }));
    const offDespawn = world.onDespawn(root => { const runtime = live.get(root); if (runtime) destroy(root, runtime); bindingsFor(world).delete(root); });
    return () => { offDespawn(); for (const [root, runtime] of [...live]) destroy(root, runtime); local.dispose(); };
}
