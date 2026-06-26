// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Clock, FolderOpen, LayoutGrid, Plus, Rows3, Search } from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { ProjectStore } from '@/project/ProjectStore';
import type { RecentEntry, TemplateEntry } from '@/project/format';

// Project browser shown before a project is open. A hub layout — persistent top
// actions, a build-aware project list with grid/list views, and a template
// gallery + create panel — worn in Estella's "stellar instrument" identity.
// Recent / Open / New-from-template are wired to ProjectStore + the recents /
// template IPC.

type View = 'recent' | 'new';
type Layout = 'grid' | 'list';

function relTime(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
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
  const [layout, setLayout] = useState<Layout>('grid');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let live = true;
    void window.estella?.recents
      ?.list()
      .then((r) => { if (live) setRecents(r); })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const items = useMemo(
    () => recents.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())),
    [recents, query],
  );

  return (
    <>
      <header className="lc-head">
        <h1>Recent</h1>
        <div className="lc-head__tools">
          <label className="lc-search">
            <Search size={13} strokeWidth={1.85} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects"
              spellCheck={false}
            />
          </label>
          <div className="lc-seg" role="group" aria-label="View">
            <button
              type="button"
              className={`lc-seg__btn${layout === 'grid' ? ' is-active' : ''}`}
              onClick={() => setLayout('grid')}
              title="Grid"
            >
              <LayoutGrid size={14} strokeWidth={1.9} />
            </button>
            <button
              type="button"
              className={`lc-seg__btn${layout === 'list' ? ' is-active' : ''}`}
              onClick={() => setLayout('list')}
              title="List"
            >
              <Rows3 size={14} strokeWidth={1.9} />
            </button>
          </div>
        </div>
      </header>

      {recents.length === 0 ? (
        <div className="lc-empty">
          <p>No recent projects yet.</p>
          <button type="button" className="lc-btn lc-btn--primary" onClick={onOpenFolder}>
            <FolderOpen size={14} strokeWidth={2} /> Open a project folder
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="lc-empty">
          <p>No projects match “{query}”.</p>
        </div>
      ) : layout === 'grid' ? (
        <div className="proj-grid">
          {items.map((p) => (
            <button key={p.root} type="button" className="proj-card" onClick={() => onOpen(p.root)}>
              <Thumb label={p.name} src={p.thumbnail} />
              <div className="proj-card__body">
                <span className="proj-card__name">{p.name}</span>
                <span className="proj-card__meta mono">{relTime(p.openedAt)}</span>
                <span className="proj-card__path mono">{p.root}</span>
              </div>
              {p.build && <span className="proj-card__build mono">{p.build}</span>}
            </button>
          ))}
        </div>
      ) : (
        <div className="proj-list">
          <div className="proj-list__head mono">
            <span>Project</span>
            <span>Last opened</span>
            <span>Build</span>
          </div>
          {items.map((p) => (
            <button key={p.root} type="button" className="proj-row" onClick={() => onOpen(p.root)}>
              <span className="proj-row__main">
                <span className="proj-row__name">{p.name}</span>
                <span className="proj-row__path mono">{p.root}</span>
              </span>
              <span className="proj-row__col mono">{relTime(p.openedAt)}</span>
              <span className="proj-row__col">{p.build && <span className="lc-badge mono">{p.build}</span>}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function NewView({ onCreated }: { onCreated: () => void }) {
  const [templates, setTemplates] = useState<TemplateEntry[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
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

  const tpl = selected != null ? templates[selected] : null;

  const pick = (i: number) => {
    setSelected(i);
    setName((n) => n || templates[i].name.toLowerCase().replace(/\s+/g, '-'));
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
          <h1>New project</h1>
          <p className="lc-head__sub">Start from a template — you can change anything later.</p>
        </header>
        {templates.length === 0 ? (
          <div className="lc-empty">
            <p>No templates found.</p>
          </div>
        ) : (
          <div className="proj-grid">
            {templates.map((t, i) => (
              <button
                key={t.dir}
                type="button"
                className={`proj-card proj-card--template${selected === i ? ' is-selected' : ''}`}
                onClick={() => pick(i)}
              >
                <Thumb label={t.name} src={t.thumbnail} />
                <div className="proj-card__body">
                  <span className="proj-card__name">{t.name}</span>
                  {t.description && <span className="proj-card__desc">{t.description}</span>}
                </div>
                {t.tag && <span className="proj-card__tag mono">{t.tag}</span>}
              </button>
            ))}
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
              <span>Project name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
            </label>
            <label className="lc-field">
              <span>Location</span>
              <span className="lc-field__path">
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Choose a folder…"
                  spellCheck={false}
                />
                <button type="button" className="lc-field__browse" title="Choose folder" onClick={browse}>
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
                'Creating…'
              ) : (
                <>
                  Create project <ArrowRight size={15} strokeWidth={2} />
                </>
              )}
            </button>
          </>
        ) : (
          <div className="lc-create__hint">
            <p>Pick a template to begin.</p>
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
            <span>editor</span>
          </div>
        </div>
        <div className="launcher__bar-actions">
          <button type="button" className="lc-btn" onClick={() => setView('new')}>
            <Plus size={14} strokeWidth={2} /> New project
          </button>
          <button type="button" className="lc-btn lc-btn--primary" onClick={openFolder}>
            <FolderOpen size={14} strokeWidth={2} /> Open folder…
          </button>
        </div>
      </header>

      <div className="launcher__body">
        <aside className="launcher__rail">
          <nav className="lc-nav">
            <button
              type="button"
              className={`lc-nav__item${view === 'recent' ? ' is-active' : ''}`}
              onClick={() => setView('recent')}
            >
              <Clock size={15} strokeWidth={1.85} /> Recent
            </button>
            <button
              type="button"
              className={`lc-nav__item${view === 'new' ? ' is-active' : ''}`}
              onClick={() => setView('new')}
            >
              <Plus size={15} strokeWidth={1.85} /> New project
            </button>
          </nav>
          <div className="lc-rail__foot">
            <Constellation />
            <span className="mono">v0.4.0 · web</span>
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
