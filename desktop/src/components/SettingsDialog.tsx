// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  SettingsDialog.tsx — the settings window (the design's `.set-*`), driven
 *        entirely by the settings registry + store. The dialog knows nothing about
 *        individual settings: it renders nav from registered sections and rows from
 *        registered descriptors (SettingsRow.tsx). Search filters across sections.
 *
 *        A setting belonging to a packaging target is edited on that target's page
 *        in Package Project instead; `settingsForSection` leaves those out, so this
 *        file needs no list of which ones they are.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Settings as SettingsIcon, X, ExternalLink } from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { settingsRegistry } from '@/settings/registry';
import { platformLabel } from '@/project/platformLabels';
import { useDialogFocus } from '@/components/dialogFocus';
import { IconButton } from '@/components/IconButton';
import { SearchField } from '@/components/SearchField';
import { Group, groupByGroup } from '@/components/SettingsRow';
import type { Setting } from '@/settings/types';
import { t } from '@/i18n';

const CATEGORY_LABEL: Record<string, string> = {
  editor: t('set.cat.editor'),
  project: t('set.cat.project'),
  plugin: t('set.cat.plugin'),
};

export function SettingsDialog() {
  const close = () => useEditorStore.getState().setSettingsOpen(false);
  const winRef = useRef<HTMLDivElement>(null);
  useDialogFocus(winRef);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const sections = settingsRegistry.allSections();
  // Open on the requested section (e.g. Help → Keyboard Shortcuts), else the first.
  const [active, setActive] = useState(() => {
    const want = useEditorStore.getState().settingsSection;
    return (want && sections.some((s) => s.id === want) ? want : sections[0]?.id) ?? '';
  });

  // Subscribe so rows reflect live changes of bound (editorStore) settings too.
  useEditorStore((s) => `${s.showGrid}|${s.showGizmos}|${s.snapping}|${s.snapStep}`);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpen(true));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const q = query.trim().toLowerCase();
  const matches = (s: Setting) =>
    !q ||
    s.label.toLowerCase().includes(q) ||
    (s.description?.toLowerCase().includes(q) ?? false) ||
    s.id.toLowerCase().includes(q);

  // When searching, show matching rows across all sections (grouped by section);
  // otherwise show the active section grouped by each setting's `group`.
  const content = q
    ? sections
        .map((sec) => ({ label: sec.label, settings: settingsRegistry.settingsForSection(sec.id).filter(matches) }))
        .filter((g) => g.settings.length > 0)
    : groupByGroup(settingsRegistry.settingsForSection(active));

  // Search must still find a row this window does not edit. It reports WHERE that
  // row is rather than repeating its control, which would put the value back to
  // having two editors.
  const elsewhere = q
    ? settingsRegistry.all().filter((s) => s.platform && matches(s))
    : [];
  const activeSection = sections.find((s) => s.id === active);

  return createPortal(
    <div className={`set-scrim${open ? ' open' : ''}`} onMouseDown={close}>
      <div
        ref={winRef}
        className="set-win"
        role="dialog"
        aria-modal="true"
        aria-label={t('set.title')}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="set-head">
          <span className="set-title">
            <span className="ic"><SettingsIcon size={16} strokeWidth={1.8} /></span>
            {t('set.title')}
          </span>
          <span className="set-head-sp" />
          <SearchField className="set-search" iconSize={12} autoFocus placeholder={t('set.search')} value={query} onChange={setQuery} />
          <IconButton size="lg" title={t('set.closeEsc')} onClick={close}>
            <X size={14} strokeWidth={2} />
          </IconButton>
        </div>

        <div className="set-body">
          <nav className="set-nav">
            {settingsRegistry.sectionsByCategory().map((cat) => (
              <div key={cat.category}>
                <div className="set-nav-sec">{CATEGORY_LABEL[cat.category] ?? cat.category}</div>
                {cat.sections.map((sec) => (
                  <button
                    key={sec.id}
                    type="button"
                    className={`set-nav-item${!q && sec.id === active ? ' active' : ''}`}
                    onClick={() => {
                      setQuery('');
                      setActive(sec.id);
                    }}
                  >
                    {sec.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <div className="set-content">
            {!q && activeSection?.hint && <div className="set-hint">{activeSection.hint}</div>}
            {content.length === 0 && elsewhere.length === 0 ? (
              <div className="empty-line">{t('set.noMatch', { query })}</div>
            ) : (
              content.map((g) => <Group key={g.label} label={g.label} settings={g.settings} />)
            )}
            {elsewhere.length > 0 && (
              <>
                <div className="set-group">{t('set.inBuildDialog')}</div>
                {elsewhere.map((s) => (
                  <div key={s.id} className="set-row">
                    <div>
                      <div className="sn">{s.label}</div>
                      <div className="sd">{t('set.inBuildDialog.where', { platform: platformLabel(s.platform!) })}</div>
                    </div>
                    <div className="set-ctrl">
                      <button
                        type="button"
                        className="set-goto"
                        onClick={() => {
                          close();
                          useEditorStore.getState().openBuild(s.platform!);
                        }}
                      >
                        <ExternalLink size={12} /> {t('set.openBuildDialog')}
                      </button>
                    </div>
                    <span className="set-reset" />
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
