// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  ControllersPanel — author UIController "pages" for the selected UI entity.
 *
 * Controllers resolve self → ancestors (resolveControllers), so selecting a geared
 * leaf still shows — and can switch — the root's controllers, matching the runtime
 * rule; inherited rows carry the owner's name and edits target the owner entity.
 * Page chips select on click, rename on double-click, delete on the hover ×, and
 * reorder by drag; renames cascade into resolving gear bindings (SceneCommands).
 * Clicking a controller makes it "active" — the Details gear dots bind fields to
 * it, and record mode captures edits into its current page. Data lives on the
 * entities (UIController); this panel is just the authoring surface.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Circle, CornerLeftUp, MousePointerClick, Plus, Trash2, X } from 'lucide-react';
import { INTERACTION_CONTROLLER, INTERACTION_PAGES } from 'esengine';
import { useSelection } from '@/store/selectionStore';
import { useControllerStore } from '@/store/controllerStore';
import { SceneStore } from '@/engine/SceneStore';
import { SceneModel } from '@/engine/SceneModel';
import { SceneCommands } from '@/engine/SceneCommands';
import { resolveControllers, readGearBindings, type ResolvedController } from '@/controller/controllerModel';
import { t } from '@/i18n';
import type { EntityId } from '@/types';

export function ControllersPanel() {
  const selectedId = useSelection((s) => s.selectedId);
  useSyncExternalStore(SceneStore.subscribe, SceneStore.getRevision);
  const activeController = useControllerStore((s) => s.activeController);
  const setActiveController = useControllerStore((s) => s.setActiveController);
  const recording = useControllerStore((s) => s.recording);
  const toggleRecording = useControllerStore((s) => s.toggleRecording);
  const [newCtrl, setNewCtrl] = useState('');

  const entity = selectedId != null ? SceneModel.entityBySource(selectedId) : null;
  const controllers = selectedId != null ? resolveControllers(selectedId) : [];
  const gears = selectedId != null ? readGearBindings(selectedId) : [];
  const isUi = !!entity?.components.some((c) => c.type === 'Canvas' || c.type === 'UINode' || c.type === 'UIController');

  // Default the active controller to the first one resolvable from this entity.
  useEffect(() => {
    if (controllers.length === 0) return;
    if (!activeController || !controllers.some((c) => c.ctrl.name === activeController)) {
      setActiveController(controllers[0]!.ctrl.name);
    }
  }, [controllers, activeController, setActiveController]);

  if (selectedId == null || !entity) {
    return <div className="ctrl-empty">{t('ctrl.emptyNoSelection')}</div>;
  }
  if (!isUi) {
    return <div className="ctrl-empty">{t('ctrl.emptyNotUi')}</div>;
  }

  const addController = () => {
    const name = newCtrl.trim();
    if (!name) return;
    SceneCommands.addController(selectedId, name);
    setActiveController(name);
    setNewCtrl('');
  };

  const hasInteraction = controllers.some((c) => c.ctrl.name === INTERACTION_CONTROLLER);
  const addInteraction = () => {
    SceneCommands.addController(selectedId, INTERACTION_CONTROLLER, [...INTERACTION_PAGES]);
    setActiveController(INTERACTION_CONTROLLER);
  };

  return (
    <div className="ctrl-panel">
      <div className="ctrl-head">
        <span className="ctrl-title">{t('ctrl.title')}</span>
        <button
          type="button"
          className={`ctrl-rec${recording ? ' on' : ''}`}
          title={t('ctrl.recordTitle')}
          onClick={toggleRecording}
        >
          <Circle size={10} fill="currentColor" />
          {t('ctrl.record')}
        </button>
      </div>

      {controllers.length === 0 && <div className="ctrl-hint">{t('ctrl.hintAdd')}</div>}

      <div className="ctrl-list">
        {controllers.map((rc) => (
          <ControllerRow
            key={`${rc.owner}:${rc.ctrl.name}`}
            resolved={rc}
            active={rc.ctrl.name === activeController}
            onActivate={() => setActiveController(rc.ctrl.name)}
          />
        ))}
      </div>

      {gears.length > 0 && (
        <div className="ctrl-gears">
          <div className="ctrl-gears-title">{t('ctrl.gearsTitle')}</div>
          {gears.map((b) => (
            <div key={`${b.controller}:${b.component}.${b.property}`} className="ctrl-gear-row">
              <span className="ctrl-gear-field">{b.component}.{b.property}</span>
              <span className="ctrl-gear-meta">
                ← {b.controller} · {Object.keys(b.pages).length}{t('ctrl.gearPagesSuffix')}
                {b.tween ? ` · ${b.tween.duration}s` : ''}
              </span>
              <button
                type="button"
                className="ctrl-del"
                title={t('ctrl.gearUnbind')}
                onClick={() => SceneCommands.removeGearBinding(selectedId, b.controller, b.component, b.property)}
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="ctrl-add">
        <input
          className="ctrl-input"
          placeholder={t('ctrl.newController')}
          value={newCtrl}
          onChange={(e) => setNewCtrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addController(); }}
        />
        <button type="button" className="ctrl-btn" title={t('ctrl.addController')} onClick={addController}>
          <Plus size={13} />
        </button>
        <button
          type="button"
          className="ctrl-btn"
          title={t('ctrl.addInteraction')}
          disabled={hasInteraction}
          onClick={addInteraction}
        >
          <MousePointerClick size={13} />
        </button>
      </div>
    </div>
  );
}

/** Input that commits on Enter/blur and cancels on Escape — chip/name renames. */
function InlineEdit({ initial, className, onCommit, onCancel }: {
  initial: string;
  className?: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const committed = useRef(false);
  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    onCommit(text);
  };
  return (
    <input
      className={`ctrl-input sm${className ? ` ${className}` : ''}`}
      value={text}
      autoFocus
      onFocus={(e) => e.target.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { committed.current = true; onCancel(); }
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function ControllerRow({ resolved, active, onActivate }: {
  resolved: ResolvedController;
  active: boolean;
  onActivate: () => void;
}) {
  const { ctrl, owner, ownerName, inherited } = resolved;
  const [newPage, setNewPage] = useState('');
  const [renaming, setRenaming] = useState(false);
  const isInteraction = ctrl.name === INTERACTION_CONTROLLER;

  const addPage = () => {
    const p = newPage.trim();
    if (!p) return;
    SceneCommands.addControllerPage(owner, ctrl.name, p);
    setNewPage('');
  };

  return (
    <div className={`ctrl-row${active ? ' active' : ''}`} onClick={onActivate}>
      <div className="ctrl-row-head">
        {renaming ? (
          <InlineEdit
            initial={ctrl.name}
            onCommit={(v) => { setRenaming(false); SceneCommands.renameController(owner, ctrl.name, v); }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <span
            className="ctrl-name"
            title={isInteraction ? t('ctrl.interactionTitle') : t('ctrl.renameHint')}
            onDoubleClick={() => { if (!isInteraction) setRenaming(true); }}
          >
            {ctrl.name}
          </span>
        )}
        {inherited && (
          <span className="ctrl-owner" title={t('ctrl.inheritedFrom')}>
            <CornerLeftUp size={10} />
            {ownerName}
          </span>
        )}
        {active && <span className="ctrl-badge">{t('ctrl.active')}</span>}
        <button
          type="button"
          className="ctrl-del"
          title={t('ctrl.deleteController')}
          onClick={(e) => { e.stopPropagation(); SceneCommands.removeController(owner, ctrl.name); }}
        >
          <Trash2 size={12} />
        </button>
      </div>

      <PageChips ownerId={owner} ctrlName={ctrl.name} pages={ctrl.pages} current={ctrl.current} />

      <div className="ctrl-page-edit" onClick={(e) => e.stopPropagation()}>
        <input
          className="ctrl-input sm"
          placeholder={t('ctrl.newPage')}
          value={newPage}
          onChange={(e) => setNewPage(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addPage(); }}
        />
        <button type="button" className="ctrl-btn sm" title={t('ctrl.addPage')} onClick={addPage}>
          <Plus size={11} />
        </button>
      </div>
    </div>
  );
}

/**
 * The page selector: click selects (live-previews via the edit-mode gear-apply
 * pass), double-click renames in place, the hover × deletes (kept while >1 pages),
 * and dragging a chip reorders the controller's page list.
 */
function PageChips({ ownerId, ctrlName, pages, current }: {
  ownerId: EntityId;
  ctrlName: string;
  pages: string[];
  current: string;
}) {
  const [renameIdx, setRenameIdx] = useState<number | null>(null);
  const dragFrom = useRef<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  return (
    <div className="ctrl-chips" onClick={(e) => e.stopPropagation()}>
      {pages.map((page, i) => renameIdx === i ? (
        <InlineEdit
          key={`edit-${page}`}
          initial={page}
          className="chip-edit"
          onCommit={(v) => { setRenameIdx(null); SceneCommands.renameControllerPage(ownerId, ctrlName, page, v); }}
          onCancel={() => setRenameIdx(null)}
        />
      ) : (
        <span
          key={page}
          draggable
          className={
            `ctrl-chip${page === current ? ' on' : ''}${dropIdx === i ? ' drop' : ''}`
          }
          title={t('ctrl.chipHint')}
          onClick={() => SceneCommands.setControllerPage(ownerId, ctrlName, page)}
          onDoubleClick={() => setRenameIdx(i)}
          onDragStart={(e) => { dragFrom.current = i; e.dataTransfer.effectAllowed = 'move'; }}
          onDragOver={(e) => { e.preventDefault(); setDropIdx(i); }}
          onDragLeave={() => setDropIdx((d) => (d === i ? null : d))}
          onDrop={(e) => {
            e.preventDefault();
            setDropIdx(null);
            const from = dragFrom.current;
            dragFrom.current = null;
            if (from != null && from !== i) SceneCommands.moveControllerPage(ownerId, ctrlName, from, i);
          }}
          onDragEnd={() => { dragFrom.current = null; setDropIdx(null); }}
        >
          {page}
          {pages.length > 1 && (
            <button
              type="button"
              className="ctrl-chip-x"
              title={t('ctrl.removePage')}
              onClick={(e) => {
                e.stopPropagation();
                SceneCommands.removeControllerPage(ownerId, ctrlName, page);
              }}
            >
              <X size={9} />
            </button>
          )}
        </span>
      ))}
    </div>
  );
}
