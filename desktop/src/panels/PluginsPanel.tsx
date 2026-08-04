// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  PluginsPanel — what's installed, what's running, and what went wrong.
 *
 * Every plugin the editor found appears here, INCLUDING the broken ones: a plugin
 * whose manifest failed to parse, whose build failed, or whose id a project plugin
 * shadowed is listed with the reason. Silently dropping a folder the user wrote is
 * the one behaviour this panel must never have.
 *
 * It is also where the trust gate lives. A renderer plugin runs in the editor's own
 * realm, so nothing loads until the user has approved it — the row states that
 * plainly rather than dressing it up as a formality.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  AlertTriangle, ChevronDown, ChevronRight, Download, FolderOpen, Plug, Plus, Power, RefreshCw,
  RotateCw, ShieldCheck, ShieldX, Upload,
} from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { NewPluginDialog } from '@/components/NewPluginDialog';
import { ImportPluginDialog } from '@/components/ImportPluginDialog';
import { Toasts } from '@/store/Toasts';
import { PluginHost, type PluginPhase, type PluginRecord } from '@/plugins/PluginHost';
import type { ContributionKind } from '@/plugins/context';
import { subscribePluginPanelActions } from '@/plugins/panelActions';
import { ProjectStore } from '@/project/ProjectStore';
import { t, type MsgKey } from '@/i18n';

const PHASE_LABEL: Record<PluginPhase, MsgKey> = {
  discovered: 'plug.phase.discovered',
  compiling: 'plug.phase.compiling',
  'needs-trust': 'plug.phase.needsTrust',
  activating: 'plug.phase.activating',
  active: 'plug.phase.active',
  failed: 'plug.phase.failed',
  disabled: 'plug.phase.disabled',
  incompatible: 'plug.phase.incompatible',
  shadowed: 'plug.phase.shadowed',
};

const CAPABILITY_LABEL: Record<string, MsgKey> = {
  'fs:project': 'plug.cap.fsProject',
  net: 'plug.cap.net',
  shell: 'plug.cap.shell',
  process: 'plug.cap.process',
};

const KIND_LABEL: Record<ContributionKind, MsgKey> = {
  command: 'plug.kind.command',
  panel: 'plug.kind.panel',
  setting: 'plug.kind.setting',
  tool: 'plug.kind.tool',
  overlay: 'plug.kind.overlay',
  inspector: 'plug.kind.inspector',
  assetType: 'plug.kind.assetType',
  entityTemplate: 'plug.kind.entityTemplate',
  contextMenu: 'plug.kind.contextMenu',
  agentTool: 'plug.kind.agentTool',
};

function PhaseChip({ phase }: { phase: PluginPhase }) {
  return <span className={`plug-chip is-${phase}`}>{t(PHASE_LABEL[phase])}</span>;
}

/**
 * What a plugin actually added. Read on expand rather than held on the record, so
 * it reflects the moment you asked — including registrations a plugin made long
 * after activating. This is the panel's answer to "why isn't my panel showing up?",
 * so an ACTIVE plugin that contributed nothing says so explicitly rather than
 * rendering an empty box that reads like a loading state.
 */
function Contributes({ record }: { record: PluginRecord }) {
  const [open, setOpen] = useState(false);
  if (record.phase !== 'active' || record.kind !== 'plugin') return null;
  const items = open ? PluginHost.contributionsOf(record.id) : [];
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="plug-contrib">
      <button type="button" className="plug-contrib__toggle" onClick={() => setOpen((v) => !v)}>
        <Chevron size={12} strokeWidth={2} />
        {t('plug.contributes')}
      </button>
      {open && (
        items.length === 0 ? (
          <div className="plug-muted plug-contrib__empty">{t('plug.contributesNone')}</div>
        ) : (
          <ul className="plug-contrib__list">
            {items.map((c) => (
              <li key={`${c.kind}:${c.id}`} className="plug-contrib__item">
                <span className="plug-contrib__kind">{t(KIND_LABEL[c.kind])}</span>
                {c.label && <span className="plug-contrib__label">{c.label}</span>}
                <span className="plug-contrib__id selectable">{c.id}</span>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

/** The trust gate: what loading means, what the plugin declared, and one decision. */
function TrustGate({ record }: { record: PluginRecord }) {
  return (
    <div className="plug-trust">
      <div className="plug-trust__title">
        <ShieldCheck size={14} strokeWidth={2} />
        {t('plug.trustTitle')}
      </div>
      <p className="plug-trust__body">{t('plug.trustBody')}</p>
      <div className="plug-trust__caps">
        <span className="plug-trust__capsLabel">{t('plug.capabilities')}:</span>
        {record.capabilities.length === 0 ? (
          <span className="plug-muted">{t('plug.noCapabilities')}</span>
        ) : (
          record.capabilities.map((c) => (
            <span key={c} className="plug-cap">
              {CAPABILITY_LABEL[c] ? t(CAPABILITY_LABEL[c]) : c}
            </span>
          ))
        )}
      </div>
      <p className="plug-muted">{t('plug.capsAdvisory')}</p>
      <p className="plug-muted">{t('plug.trustRechecked')}</p>
      <button type="button" className="btn-soft is-primary" onClick={() => void PluginHost.trust(record.id)}>
        {t('plug.trust')}
      </button>
    </div>
  );
}

/** Pack one plugin into a file. Cancelling the save dialog is not a failure and
 *  must not toast — the user changed their mind, which is not news. */
async function exportPlugin(id: string): Promise<void> {
  const result = await window.estella.plugins.exportPackage(id);
  if (result.canceled) return;
  if (!result.ok) {
    Toasts.push(result.error ?? 'export failed', 'error');
    return;
  }
  Toasts.push(t('plug.exported', { file: result.file ?? '' }), 'success');
}

function PluginRow({ record }: { record: PluginRecord }) {
  const canToggle = record.phase !== 'shadowed';
  const isDisabled = record.phase === 'disabled';
  return (
    <div className="plug-row">
      <div className="plug-row__head">
        <span className="plug-row__name">{record.name}</span>
        {record.version && <span className="plug-row__version">{record.version}</span>}
        <span className="plug-row__scope">{t(record.scope === 'project' ? 'plug.scope.project' : 'plug.scope.user')}</span>
        <span className="plug-row__spacer" />
        <PhaseChip phase={record.phase} />
      </div>
      {record.description && <div className="plug-row__desc">{record.description}</div>}
      {record.detail && (
        <div className="plug-row__detail">
          <AlertTriangle size={12} strokeWidth={2} />
          <span>{record.detail}</span>
        </div>
      )}
      {record.warnings.map((w) => (
        <div key={w} className="plug-row__detail is-warn">
          <AlertTriangle size={12} strokeWidth={2} />
          <span>{w}</span>
        </div>
      ))}
      {record.errorCount > 0 && (
        <div className="plug-row__detail">{t('plug.errorCount', { n: record.errorCount })}</div>
      )}
      {record.phase === 'needs-trust' && <TrustGate record={record} />}
      <Contributes record={record} />
      <div className="plug-row__actions">
        <button type="button" className="btn-soft" title={t('plug.reloadTip')} onClick={() => void PluginHost.reload(record.id)}>
          <RotateCw size={12} strokeWidth={2} />
          {t('plug.reload')}
        </button>
        {canToggle && (
          <button
            type="button"
            className="btn-soft"
            onClick={() => void (isDisabled ? PluginHost.enable(record.id) : PluginHost.disable(record.id))}
          >
            <Power size={12} strokeWidth={2} />
            {t(isDisabled ? 'plug.enable' : 'plug.disable')}
          </button>
        )}
        {record.phase === 'active' && (
          <button type="button" className="btn-soft" onClick={() => void PluginHost.revokeTrust(record.id)}>
            <ShieldX size={12} strokeWidth={2} />
            {t('plug.revokeTrust')}
          </button>
        )}
        {record.kind === 'plugin' && (
          <button type="button" className="btn-soft" title={t('plug.exportTip')} onClick={() => void exportPlugin(record.id)}>
            <Upload size={12} strokeWidth={2} />
            {t('plug.export')}
          </button>
        )}
        <button type="button" className="btn-soft" onClick={() => void window.estella.plugins.reveal(record.id)}>
          <FolderOpen size={12} strokeWidth={2} />
          {t('plug.reveal')}
        </button>
      </div>
    </div>
  );
}

export function PluginsPanel() {
  const records = useSyncExternalStore(PluginHost.subscribe, PluginHost.getSnapshot);
  const project = useSyncExternalStore(ProjectStore.subscribe, ProjectStore.getSnapshot);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  // The panel may be opened before anything scanned (a fresh layout), so make
  // opening it a scan — the list is never mysteriously empty.
  useEffect(() => {
    void PluginHost.refresh();
  }, []);

  // The New / Import commands open this panel and then ask it for the dialog.
  useEffect(() => subscribePluginPanelActions((action) => {
    if (action === 'new') setCreating(true);
    else setImporting(true);
  }), []);

  // ONE root, and the dialogs always mount at the SAME position in it. An earlier
  // version returned a separate tree for the empty state, which meant installing the
  // first plugin (0 → 1 rows) swapped branches and REMOUNTED the open dialog — and a
  // dialog whose mount effect opens a native file picker opened a second one.
  const empty = records.length === 0;
  return (
    <div className="plug-panel">
      {/* In the empty state the buttons live in the EmptyState itself, where the
          eye already is; a toolbar above an empty box is a second place to look. */}
      {!empty && (
        <div className="plug-toolbar">
          <button type="button" className="btn-soft" onClick={() => setCreating(true)}>
            <Plus size={12} strokeWidth={2} />
            {t('plug.new')}
          </button>
          <button type="button" className="btn-soft" onClick={() => setImporting(true)}>
            <Download size={12} strokeWidth={2} />
            {t('plug.import')}
          </button>
          <button type="button" className="btn-soft" onClick={() => void PluginHost.refresh()}>
            <RefreshCw size={12} strokeWidth={2} />
            {t('plug.refresh')}
          </button>
        </div>
      )}

      {empty ? (
        <EmptyState
          icon={Plug}
          title={t('plug.emptyTitle')}
          hint={project ? t('plug.emptyHint') : t('plug.noProjectHint')}
        >
          <button type="button" className="btn-soft is-primary" onClick={() => setCreating(true)}>
            <Plus size={12} strokeWidth={2} />
            {t('plug.new')}
          </button>
          <button type="button" className="btn-soft" onClick={() => setImporting(true)}>
            <Download size={12} strokeWidth={2} />
            {t('plug.import')}
          </button>
          <button type="button" className="btn-soft" onClick={() => void PluginHost.refresh()}>
            <RefreshCw size={12} strokeWidth={2} />
            {t('plug.refresh')}
          </button>
        </EmptyState>
      ) : (
        <div className="plug-list">
          {records.map((r) => (
            <PluginRow key={r.id} record={r} />
          ))}
        </div>
      )}

      {creating && <NewPluginDialog onClose={() => setCreating(false)} />}
      {importing && <ImportPluginDialog onClose={() => setImporting(false)} />}
    </div>
  );
}
