// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { Fragment, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Clock, FolderOpen, LayoutGrid, Plus, Rows3, X } from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { ProjectStore } from '@/project/ProjectStore';
import { WindowControls } from '@/layout/WindowControls';
import { SearchField } from '@/components/SearchField';
import { Segmented } from '@/components/Segmented';
import { t } from '@/i18n';
import type { RecentEntry, TemplateEntry } from '@/project/format';
import { version } from '../../package.json';

// Project browser shown before a project is open. A hub layout — persistent top
// actions, a build-aware project list with grid/list views, and a template
// gallery + create panel — worn in Estella's "stellar instrument" identity.
// Recent / Open / New-from-template are wired to ProjectStore + the recents /
// template IPC.

type View = 'recent' | 'new';
type Layout = 'grid' | 'list';

function relTime(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return t('launcher.justNow');
  const m = Math.floor(s / 60);
  if (m < 60) return t('launcher.minutesAgo', { m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('launcher.hoursAgo', { h });
  const d = Math.floor(h / 24);
  if (d < 7) return t('launcher.daysAgo', { d });
  return t('launcher.weeksAgo', { w: Math.floor(d / 7) });
}

/** A static SVG constellation — the launcher's quiet signature mark. */
function Constellation() {
  return (
    <svg className="lc-constellation" viewBox="0 0 120 64" aria-hidden="true">
      <polyline points="8,40 34,22 58,34 86,14 110,30" fill="none" />
      <circle cx="8" cy="40" r="1.6" />
      <circle cx="34" cy="22" r="1.6" />
      <circle cx="58" cy="34" r="1.6" />
      <circle cx="86" cy="14" r="2.4" className="lc-constellation__star" />
      <circle cx="110" cy="30" r="1.6" />
    </svg>
  );
}

/** Project tile — the real thumbnail if present, else a star-chart placeholder. */
function Thumb({ label, src }: { label: string; src?: string }) {
  return (
    <div className="proj-card__thumb" aria-hidden="true">
      {src ? (
        <img className="proj-card__img" src={src} alt="" />
      ) : (
        <span className="proj-card__glyph">{label.charAt(0).toUpperCase()}</span>
      )}
    </div>
  );
}

function RecentView({
  onOpen,
  onOpenFolder,
}: {
  onOpen: (root: string) => void;
  onOpenFolder: () => void;
}) {
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [layout, setLayout] = useState<Layout>('grid');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let live = true;
    const req = window.estella?.recents?.list();
    if (!req) {
      setLoading(false);
      return;
    }
    req
      .then((r) => { if (live) setRecents(r); })
      .catch(() => {})
      .finally(() => { if (live) setLoading(false); });
    return () => {
      live = false;
    };
  }, []);

  const items = useMemo(
    () => recents.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())),
    [recents, query],
  );

  // Forget a project in the launcher only — the project on disk is untouched.
  const onRemove = (root: string) => {
    void window.estella?.recents?.remove?.(root).catch(() => {});
    setRecents((rs) => rs.filter((r) => r.root !== root));
  };

  return (
    <>
      <header className="lc-head">
        <h1>{t('launcher.recent')}</h1>
        <div className="lc-head__tools">
          <SearchField className="lc-search" placeholder={t('launcher.searchProjects')} value={query} onChange={setQuery} />
          <Segmented
            value={layout}
            onChange={setLayout}
            ariaLabel={t('launcher.viewLabel')}
            options={[
              { value: 'grid', icon: <LayoutGrid size={14} strokeWidth={1.9} />, title: t('launcher.viewGrid') },
              { value: 'list', icon: <Rows3 size={14} strokeWidth={1.9} />, title: t('launcher.viewList') },
            ]}
          />
        </div>
      </header>

      {loading ? (
        // Recents arrive async — skeleton cards instead of flashing the empty state.
        <div className="proj-grid" aria-hidden="true">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="proj-card is-skel">
              <div className="proj-card__thumb skel" />
              <div className="proj-card__body">
                <span className="skel" />
                <span className="skel" />
              </div>
            </div>
          ))}
        </div>
      ) : recents.length === 0 ? (
        <div className="lc-empty">
          <p>{t('launcher.noRecent')}</p>
          <button type="button" className="lc-btn lc-btn--primary" onClick={onOpenFolder}>
            <FolderOpen size={14} strokeWidth={2} /> {t('launcher.openProjectFolder')}
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="lc-empty">
          <p>{t('launcher.noMatch', { query })}</p>
        </div>
      ) : layout === 'grid' ? (
        <div className="proj-grid">
          {items.map((p) => (
            <div
              key={p.root}
              className="proj-card"
              role="button"
              tabIndex={0}
              onClick={() => onOpen(p.root)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(p.root); } }}
            >
              <Thumb label={p.name} src={p.thumbnail} />
              <div className="proj-card__body">
                <span className="proj-card__name">{p.name}</span>
                <span className="proj-card__meta mono">{relTime(p.openedAt)}</span>
                <span className="proj-card__path mono">{p.root}</span>
              </div>
              {p.build && <span className="proj-card__build mono">{p.build}</span>}
              <button
                type="button"
                className="proj-card__remove"
                title={t('launcher.removeFromRecents')}
                aria-label={t('launcher.removeFromRecents')}
                onClick={(e) => { e.stopPropagation(); onRemove(p.root); }}
              >
                <X size={13} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="proj-list">
          <div className="proj-list__head mono">
            <span>{t('launcher.colProject')}</span>
            <span>{t('launcher.colLastOpened')}</span>
            <span>{t('launcher.colBuild')}</span>
          </div>
          {items.map((p) => (
            <div
              key={p.root}
              className="proj-row"
              role="button"
              tabIndex={0}
              onClick={() => onOpen(p.root)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(p.root); } }}
            >
              <span className="proj-row__main">
                <span className="proj-row__name">{p.name}</span>
                <span className="proj-row__path mono">{p.root}</span>
              </span>
              <span className="proj-row__col mono">{relTime(p.openedAt)}</span>
              <span className="proj-row__col">{p.build && <span className="lc-badge mono">{p.build}</span>}</span>
              <button
                type="button"
                className="proj-row__remove"
                title={t('launcher.removeFromRecents')}
                aria-label={t('launcher.removeFromRecents')}
                onClick={(e) => { e.stopPropagation(); onRemove(p.root); }}
              >
                <X size={13} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function NewView({ onCreated }: { onCreated: () => void }) {
  const [templates, setTemplates] = useState<TemplateEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void window.estella?.templates
      ?.list()
      .then((t) => { if (live) setTemplates(t); })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const tpl = selected != null ? templates.find((t) => t.dir === selected) ?? null : null;

  // The gallery's group order (starters, then examples) is the list order —
  // group labels only earn their space when both groups are present.
  const starters = templates.filter((t) => t.kind === 'starter');
  const examples = templates.filter((t) => t.kind !== 'starter');
  const grouped = starters.length > 0 && examples.length > 0;

  const pick = (t: TemplateEntry) => {
    setSelected(t.dir);
    // Suggest a folder name: a starter is a blank slate ("my-project"), a
    // sample keeps its own name so the copy stays recognizable.
    setName((n) => n || (t.kind === 'starter' ? 'my-project' : t.name.toLowerCase().replace(/\s+/g, '-')));
  };

  const browse = () => {
    void window.estella?.project?.chooseDirectory().then((dir) => {
      if (dir) setLocation(dir);
    });
  };

  const create = async () => {
    if (!tpl || busy) return;
    let loc = location;
    if (!loc) {
      loc = (await window.estella?.project?.chooseDirectory()) ?? '';
      if (!loc) return;
      setLocation(loc);
    }
    setBusy(true);
    const ok = await ProjectStore.createAndOpen(tpl.dir, loc, name || tpl.name);
    setBusy(false);
    if (ok) onCreated();
  };

  return (
    <div className="lc-new">
      <div className="lc-new__gallery">
        <header className="lc-head">
          <h1>{t('launcher.newProject')}</h1>
          <p className="lc-head__sub">{t('launcher.newProjectSub')}</p>
        </header>
        {templates.length === 0 ? (
          <div className="lc-empty">
            <p>{t('launcher.templatesMissing')}</p>
            <p className="lc-empty__hint">{t('launcher.templatesMissingHint')}</p>
          </div>
        ) : (
          <div className="proj-grid">
            {[
              { label: t('launcher.groupStarters'), items: starters },
              { label: t('launcher.groupExamples'), items: examples },
            ].map(({ label, items }) =>
              items.length === 0 ? null : (
                <Fragment key={label}>
                  {grouped && <h2 className="lc-group">{label}</h2>}
                  {items.map((t) => (
                    <button
                      key={t.dir}
                      type="button"
                      className={`proj-card proj-card--template${selected === t.dir ? ' is-selected' : ''}`}
                      onClick={() => pick(t)}
                    >
                      <Thumb label={t.name} src={t.thumbnail} />
                      <div className="proj-card__body">
                        <span className="proj-card__name">{t.name}</span>
                        {t.description && <span className="proj-card__desc">{t.description}</span>}
                      </div>
                      {t.tag && <span className="proj-card__tag mono">{t.tag}</span>}
                    </button>
                  ))}
                </Fragment>
              ),
            )}
          </div>
        )}
      </div>

      <aside className="lc-create">
        {tpl ? (
          <>
            <div className="lc-create__preview">
              <Thumb label={tpl.name} src={tpl.thumbnail} />
            </div>
            <span className="lc-create__tpl">{tpl.name}</span>
            {tpl.description && <p className="lc-create__desc">{tpl.description}</p>}

            <label className="lc-field">
              <span>{t('launcher.projectName')}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
            </label>
            <label className="lc-field">
              <span>{t('launcher.location')}</span>
              <span className="lc-field__path">
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder={t('launcher.chooseFolderPlaceholder')}
                  spellCheck={false}
                />
                <button type="button" className="lc-field__browse" title={t('launcher.chooseFolder')} onClick={browse}>
                  <FolderOpen size={13} strokeWidth={1.9} />
                </button>
              </span>
            </label>

            <button
              type="button"
              className="lc-btn lc-btn--primary lc-create__go"
              onClick={() => void create()}
              disabled={busy || !name}
            >
              {busy ? (
                t('launcher.creating')
              ) : (
                <>
                  {t('launcher.createProject')} <ArrowRight size={15} strokeWidth={2} />
                </>
              )}
            </button>
          </>
        ) : (
          <div className="lc-create__hint">
            <p>{t('launcher.pickTemplate')}</p>
          </div>
        )}
      </aside>
    </div>
  );
}

export function Launcher() {
  const [view, setView] = useState<View>('recent');
  const enter = useEditorStore((s) => s.enterEditor);

  const openProject = (root: string) => {
    void ProjectStore.open(root).then((ok) => {
      if (ok) enter();
    });
  };
  const openFolder = () => {
    void ProjectStore.openViaDialog().then((ok) => {
      if (ok) enter();
    });
  };

  return (
    <div className="launcher">
      <header className="launcher__bar">
        <div className="lc-brand">
          <svg className="lc-brand__mark" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z" />
          </svg>
          <div className="lc-brand__text">
            <strong>Estella</strong>
            <span>{t('launcher.brandEditor')}</span>
          </div>
        </div>
        <div className="launcher__bar-actions">
          <button type="button" className="lc-btn" onClick={() => setView('new')}>
            <Plus size={14} strokeWidth={2} /> {t('launcher.newProject')}
          </button>
          <button type="button" className="lc-btn lc-btn--primary" onClick={openFolder}>
            <FolderOpen size={14} strokeWidth={2} /> {t('launcher.openFolder')}
          </button>
        </div>
        <WindowControls />
      </header>

      <div className="launcher__body">
        <aside className="launcher__rail">
          <nav className="lc-nav">
            <button
              type="button"
              className={`lc-nav__item${view === 'recent' ? ' is-active' : ''}`}
              onClick={() => setView('recent')}
            >
              <Clock size={15} strokeWidth={1.85} /> {t('launcher.recent')}
            </button>
            <button
              type="button"
              className={`lc-nav__item${view === 'new' ? ' is-active' : ''}`}
              onClick={() => setView('new')}
            >
              <Plus size={15} strokeWidth={1.85} /> {t('launcher.newProject')}
            </button>
          </nav>
          <div className="lc-rail__foot">
            <Constellation />
            <span className="mono">v{version}</span>
          </div>
        </aside>

        <main className="launcher__main">
          {view === 'recent' ? (
            <RecentView onOpen={openProject} onOpenFolder={openFolder} />
          ) : (
            <NewView onCreated={enter} />
          )}
        </main>
      </div>
    </div>
  );
}
