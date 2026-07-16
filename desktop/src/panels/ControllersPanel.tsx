// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  ControllersPanel — author UIController "pages" for the selected UI root.
 *
 * Lists the selected entity's controllers; each has a page selector that sets the
 * controller's `current` (the gear-apply system, which ticks in edit mode, then
 * reflows every geared element live). Clicking a controller makes it "active" — the
 * Details gear dots bind fields to it, and record mode captures edits into its
 * current page. Data lives on the entities (UIController); this panel is just the
 * authoring surface. Renames are out of scope (they'd dangle gear references).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Circle, Plus, Minus, Trash2 } from 'lucide-react';
import { useSelection } from '@/store/selectionStore';
import { useControllerStore } from '@/store/controllerStore';
import { SceneStore } from '@/engine/SceneStore';
import { SceneModel } from '@/engine/SceneModel';
import { SceneCommands } from '@/engine/SceneCommands';
import { readControllers } from '@/controller/controllerModel';
import { Segmented } from '@/components/Segmented';
import { t } from '@/i18n';
import type { EntityId } from '@/types';
import type { ControllerState } from 'esengine';

export function ControllersPanel() {
  const selectedId = useSelection((s) => s.selectedId);
  useSyncExternalStore(SceneStore.subscribe, SceneStore.getRevision);
  const activeController = useControllerStore((s) => s.activeController);
  const setActiveController = useControllerStore((s) => s.setActiveController);
  const recording = useControllerStore((s) => s.recording);
  const toggleRecording = useControllerStore((s) => s.toggleRecording);
  const [newCtrl, setNewCtrl] = useState('');

  const entity = selectedId != null ? SceneModel.entityBySource(selectedId) : null;
  const controllers = selectedId != null ? readControllers(selectedId) : [];
  const isUi = !!entity?.components.some((c) => c.type === 'Canvas' || c.type === 'UINode' || c.type === 'UIController');

  // Default the active controller to the first one available on this entity.
  useEffect(() => {
    if (controllers.length === 0) return;
    if (!activeController || !controllers.some((c) => c.name === activeController)) {
      setActiveController(controllers[0].name);
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
        {controllers.map((c) => (
          <ControllerRow
            key={c.name}
            entityId={selectedId}
            ctrl={c}
            active={c.name === activeController}
            onActivate={() => setActiveController(c.name)}
          />
        ))}
      </div>

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
      </div>
    </div>
  );
}

function ControllerRow({
  entityId, ctrl, active, onActivate,
}: {
  entityId: EntityId;
  ctrl: ControllerState;
  active: boolean;
  onActivate: () => void;
}) {
  const [newPage, setNewPage] = useState('');
  const addPage = () => {
    const p = newPage.trim();
    if (!p) return;
    SceneCommands.addControllerPage(entityId, ctrl.name, p);
    setNewPage('');
  };

  return (
    <div className={`ctrl-row${active ? ' active' : ''}`} onClick={onActivate}>
      <div className="ctrl-row-head">
        <span className="ctrl-name">{ctrl.name}</span>
        {active && <span className="ctrl-badge">{t('ctrl.active')}</span>}
        <button
          type="button"
          className="ctrl-del"
          title={t('ctrl.deleteController')}
          onClick={(e) => { e.stopPropagation(); SceneCommands.removeController(entityId, ctrl.name); }}
        >
          <Trash2 size={12} />
        </button>
      </div>

      <div className="ctrl-pages">
        <Segmented
          value={ctrl.current}
          options={ctrl.pages.map((p) => ({ value: p, label: p }))}
          onChange={(p) => SceneCommands.setControllerPage(entityId, ctrl.name, p)}
          ariaLabel={ctrl.name}
        />
      </div>

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
        <button
          type="button"
          className="ctrl-btn sm"
          title={t('ctrl.removeCurrentPage')}
          disabled={ctrl.pages.length <= 1}
          onClick={() => SceneCommands.removeControllerPage(entityId, ctrl.name, ctrl.current)}
        >
          <Minus size={11} />
        </button>
      </div>
    </div>
  );
}
