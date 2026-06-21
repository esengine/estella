import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Search, LayoutGrid, List, Import, FolderOpen, FolderPlus, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';
import { AssetIcon, assetTint } from '@/components/icons';
import { ContextMenu, type MenuItem } from '@/components/Menu';
import { ProjectStore } from '@/project/ProjectStore';
import { EditorHistory } from '@/engine/EditorHistory';
import { Toasts } from '@/store/Toasts';
import { useSelection } from '@/store/selectionStore';
import { IMAGE_RE, assetTypeOf as assetType, TYPE_CODE } from '@/project/assetMeta';
import { fsRefresh } from '@/project/fsWatch';
import type { DirEntry } from '@/project/format';
import type { AssetType } from '@/types';

const TILE_MIN = 64;
const TILE_MAX = 152;
const TILE_KEY = 'estella.content.tileSize';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Lazily read a project-relative directory (or [] when null / no project / error),
// re-reading whenever the path changes or an fs mutation bumps fsRefresh.
function useDir(relPath: string | null): DirEntry[] {
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const version = useSyncExternalStore(fsRefresh.subscribe, fsRefresh.get);
  useEffect(() => {
    if (relPath == null || !window.estella?.fs) {
      setEntries([]);
      return;
    }
    let alive = true;
    window.estella.fs
      .readDir(relPath)
      .then((e) => alive && setEntries(e))
      .catch(() => alive && setEntries([]));
    return () => {
      alive = false;
    };
  }, [relPath, version]);
  return entries;
}

// Inline name editor for a tile / list row (UE5 rename + new-folder flow): commits
// on Enter or blur, cancels on Escape, and pre-selects the base name (sans
// extension). Stops pointer/key events so it doesn't trigger the tile's
// select/open/drag while editing.
function RenameInput({
  name,
  onCommit,
  onCancel,
}: {
  name: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const canceled = useRef(false);
  return (
    <input
      className="cb-rename"
      defaultValue={name}
      autoFocus
      spellCheck={false}
      onFocus={(e) => {
        const dot = name.lastIndexOf('.');
        e.target.setSelectionRange(0, dot > 0 ? dot : name.length);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') {
          canceled.current = true;
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => (canceled.current ? onCancel() : onCommit(e.target.value))}
    />
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n;
  let i = -1;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

function TipRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="cb-tip-row">
      <span className="k">{k}</span>
      <span className={`v${mono ? ' mono' : ''}`}>{v}</span>
    </div>
  );
}

// UE5-style hover card: the metadata you can't see at a glance (type / path /
// reference / image dimensions / disk size / modified). Anchored beside the tile,
// clamped on-screen, non-interactive. Fetches stat + dimensions lazily on show.
function AssetTooltip({ path, entry, rect }: { path: string; entry: DirEntry; rect: DOMRect }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: rect.right + 10, top: rect.top });
  const [stat, setStat] = useState<{ size: number; mtimeMs: number } | null>(null);
  const [dims, setDims] = useState<string | null>(null);

  const type: AssetType = entry.isDir ? 'folder' : assetType(entry.name);
  const isImg = !entry.isDir && IMAGE_RE.test(entry.name);
  const assetReference = entry.isDir ? null : ProjectStore.assetRef(path);

  useEffect(() => {
    let alive = true;
    window.estella?.fs
      ?.stat(path)
      .then((s) => alive && setStat(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [path]);

  useEffect(() => {
    if (!isImg) return;
    const img = new Image();
    img.onload = () => setDims(`${img.naturalWidth} × ${img.naturalHeight}`);
    img.src = `estella://project/${path}`;
    return () => {
      img.onload = null;
    };
  }, [isImg, path]);

  // Clamp beside the tile (flip to the left / lift up near an edge).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    let left = rect.right + 10;
    if (left + r.width > window.innerWidth - pad) left = Math.max(pad, rect.left - r.width - 10);
    let top = rect.top;
    if (top + r.height > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - r.height - pad);
    setPos({ left, top });
  }, [rect, stat, dims]);

  return createPortal(
    <div ref={ref} className="cb-tip" style={{ left: pos.left, top: pos.top }}>
      <div className="cb-tip-name">{entry.name}</div>
      <TipRow k="Type" v={entry.isDir ? 'Folder' : TYPE_CODE[type] || type} />
      {dims && <TipRow k="Dimensions" v={dims} />}
      {!entry.isDir && stat && <TipRow k="Size" v={formatBytes(stat.size)} />}
      {stat && <TipRow k="Modified" v={new Date(stat.mtimeMs).toLocaleString()} />}
      <TipRow k="Path" v={path} mono />
      {assetReference && <TipRow k="Reference" v={assetReference} mono />}
    </div>,
    document.body,
  );
}

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

// Folder navigation with a back/forward history (the breadcrumb nav arrows).
function useNav() {
  const [nav, setNav] = useState<{ hist: string[]; i: number }>({ hist: [''], i: 0 });
  const cwd = nav.hist[nav.i];
  const go = useCallback(
    (p: string) => setNav((n) => (p === n.hist[n.i] ? n : { hist: [...n.hist.slice(0, n.i + 1), p], i: n.i + 1 })),
    [],
  );
  const back = useCallback(() => setNav((n) => ({ ...n, i: Math.max(0, n.i - 1) })), []);
  const forward = useCallback(() => setNav((n) => ({ ...n, i: Math.min(n.hist.length - 1, n.i + 1) })), []);
  const up = useCallback(() => go(parentOf(cwd)), [go, cwd]);
  const reset = useCallback(() => setNav({ hist: [''], i: 0 }), []);
  return { cwd, go, back, forward, up, reset, canBack: nav.i > 0, canForward: nav.i < nav.hist.length - 1, canUp: cwd !== '' };
}

// Always-visible type filter chips (each toggles a group of asset types). A chip
// is active when all its types are in the filter set; "All" clears the filter.
const CHIP_GROUPS: { label: string; types: AssetType[]; color: string }[] = [
  { label: 'Image', types: ['texture', 'sprite'], color: assetTint('texture') },
  { label: 'Prefab', types: ['prefab'], color: assetTint('prefab') },
  { label: 'Scene', types: ['scene'], color: assetTint('scene') },
  { label: 'Script', types: ['script'], color: assetTint('script') },
  { label: 'Audio', types: ['audio'], color: assetTint('audio') },
  { label: 'Material', types: ['material'], color: assetTint('material') },
];

function FolderNode({
  path,
  name,
  depth,
  cwd,
  onSelect,
}: {
  path: string;
  name: string;
  depth: number;
  cwd: string;
  onSelect: (p: string) => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const children = useDir(open ? path : null);
  const subdirs = children.filter((e) => e.isDir);

  return (
    <>
      <div
        className={`tr${cwd === path ? ' sel' : ''}${open ? ' open' : ''}`}
        style={{ paddingLeft: depth * 12 + 6 }}
        title={name}
        onClick={() => onSelect(path)}
      >
        <span
          className={`tw${subdirs.length ? '' : ' leaf'}`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
        >
          <ChevronRight size={10} strokeWidth={2.6} />
        </span>
        <span className="ti">
          <AssetIcon type="folder" size={14} />
        </span>
        <span className="tn">{name}</span>
      </div>
      {open && subdirs.map((d) => (
        <FolderNode key={d.name} path={join(path, d.name)} name={d.name} depth={depth + 1} cwd={cwd} onSelect={onSelect} />
      ))}
    </>
  );
}

export function ContentBrowser() {
  const project = useSyncExternalStore(ProjectStore.subscribe, ProjectStore.getSnapshot);
  const { cwd, go, back, forward, up, reset, canBack, canForward, canUp } = useNav();
  const [query, setQuery] = useState('');
  // A right-click menu: on an item (target set) or on empty space (target null).
  const [ctx, setCtx] = useState<{ x: number; y: number; target: { path: string; entry: DirEntry } | null } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [hover, setHover] = useState<{ path: string; entry: DirEntry; rect: DOMRect } | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const [filters, setFilters] = useState<Set<AssetType>>(new Set());

  const clearHover = useCallback(() => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setHover(null);
  }, []);
  useEffect(() => () => clearHover(), [clearHover]);
  // Asset selection lives in the shared store (unified inspector): selecting an
  // asset drives the Details panel + clears any entity selection.
  const selected = useSelection((s) => s.selectedAsset);
  const selectAsset = useSelection((s) => s.selectAsset);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [tileSize, setTileSize] = useState<number>(() => {
    const v = Number(localStorage.getItem(TILE_KEY));
    return v >= TILE_MIN && v <= TILE_MAX ? v : 96;
  });
  useEffect(() => localStorage.setItem(TILE_KEY, String(tileSize)), [tileSize]);

  // Reset navigation + selection when the open project changes.
  useEffect(() => {
    reset();
    selectAsset(null);
  }, [project?.name, reset, selectAsset]);
  // Selection doesn't survive a folder change.
  useEffect(() => selectAsset(null), [cwd, selectAsset]);

  const entries = useDir(project ? cwd : null);
  const q = query.trim().toLowerCase();
  const items = useMemo(() => {
    const list = entries.filter((e) => {
      if (q && !e.name.toLowerCase().includes(q)) return false;
      // Folders always show (they're navigation); a type filter narrows files.
      if (filters.size > 0 && !e.isDir && !filters.has(assetType(e.name))) return false;
      return true;
    });
    // Folders first, then files; both alphabetical.
    return [...list].sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
  }, [entries, q, filters]);

  // Double-click: enter folders; open scenes as the editor document (guarding
  // unsaved edits — history is cleared on open, so canUndo ≈ "edited this session").
  const onOpen = (path: string, isDir: boolean, name: string) => {
    if (isDir) {
      go(path);
      return;
    }
    if (assetType(name) === 'scene') {
      if (EditorHistory.canUndo() && !window.confirm(`Open ${name}? Unsaved changes will be lost.`)) return;
      void ProjectStore.openScene(path);
    }
  };

  // After any fs mutation: re-read open directories + re-scan the asset registry
  // (so `@uuid:` refs stay resolvable and the inspector reflects new paths).
  const refreshFs = useCallback(() => {
    fsRefresh.bump();
    void ProjectStore.refreshAssets();
  }, []);

  const copy = (text: string, label: string) => {
    void navigator.clipboard?.writeText(text);
    Toasts.push(label, 'info', 1600);
  };

  const commitRename = async (path: string, raw: string) => {
    setRenaming(null);
    const name = raw.trim();
    const cur = path.slice(path.lastIndexOf('/') + 1);
    if (!name || name === cur) return;
    if (/[\\/]/.test(name)) {
      Toasts.push('Name can’t contain slashes', 'error');
      return;
    }
    const dest = join(parentOf(path), name);
    try {
      await window.estella.fs.rename(path, dest);
      refreshFs();
      selectAsset(dest);
    } catch (e) {
      Toasts.push(`Rename failed: ${errMsg(e)}`, 'error');
    }
  };

  const duplicate = async (path: string) => {
    try {
      const next = await window.estella.fs.duplicate(path);
      refreshFs();
      selectAsset(next);
    } catch (e) {
      Toasts.push(`Duplicate failed: ${errMsg(e)}`, 'error');
    }
  };

  const remove = async (path: string, name: string) => {
    if (!window.confirm(`Delete “${name}”? It will be moved to the trash.`)) return;
    try {
      await window.estella.fs.trash(path);
      refreshFs();
      if (selected === path) selectAsset(null);
    } catch (e) {
      Toasts.push(`Delete failed: ${errMsg(e)}`, 'error');
    }
  };

  const newFolder = async () => {
    const taken = new Set(entries.map((e) => e.name));
    let name = 'New Folder';
    for (let i = 2; taken.has(name); i++) name = `New Folder ${i}`;
    const path = join(cwd, name);
    try {
      await window.estella.fs.mkdir(path);
      refreshFs();
      selectAsset(path);
      setRenaming(path); // drop straight into rename, like UE5
    } catch (e) {
      Toasts.push(`New folder failed: ${errMsg(e)}`, 'error');
    }
  };

  const showInExplorer = async (path: string) => {
    try {
      await window.estella.shell.showItem(path);
    } catch (e) {
      Toasts.push(`Couldn’t reveal: ${errMsg(e)}`, 'error');
    }
  };

  // Breadcrumb segments: Project › folder › subfolder, each a jump target.
  const crumbs = useMemo(() => {
    const out = [{ name: project?.name ?? 'Project', path: '' }];
    let acc = '';
    for (const part of cwd ? cwd.split('/') : []) {
      acc = acc ? `${acc}/${part}` : part;
      out.push({ name: part, path: acc });
    }
    return out;
  }, [cwd, project?.name]);

  // Shared interaction binding for an asset, reused by the grid tile and the
  // list row so both views behave identically (drag-assign, select, open, menu).
  const bindItem = (path: string, e: DirEntry) => ({
    draggable: !e.isDir && renaming !== path,
    onDragStart: (ev: React.DragEvent) => {
      clearHover();
      ev.dataTransfer.effectAllowed = 'copy';
      ev.dataTransfer.setData('application/x-estella-asset', path);
      ev.dataTransfer.setData('text/plain', path);
    },
    onClick: () => selectAsset(path),
    onDoubleClick: () => onOpen(path, e.isDir, e.name),
    onMouseEnter: (ev: React.MouseEvent) => {
      if (renaming) return;
      const rect = ev.currentTarget.getBoundingClientRect();
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      hoverTimer.current = window.setTimeout(() => setHover({ path, entry: e, rect }), 450);
    },
    onMouseLeave: clearHover,
    onContextMenu: (ev: React.MouseEvent) => {
      ev.preventDefault();
      ev.stopPropagation(); // don't fall through to the empty-space menu
      clearHover();
      selectAsset(path);
      setCtx({ x: ev.clientX, y: ev.clientY, target: { path, entry: e } });
    },
  });

  const ctxItems: MenuItem[] = (() => {
    if (!ctx) return [];
    if (!ctx.target) {
      // Empty-space menu (acts on the current folder).
      return [
        { label: 'New Folder', icon: <FolderPlus size={14} />, onClick: () => void newFolder() },
        { sep: true },
        { label: 'Show in Explorer', onClick: () => void showInExplorer(cwd) },
      ];
    }
    const { path, entry } = ctx.target;
    const isScene = !entry.isDir && assetType(entry.name) === 'scene';
    const ref = entry.isDir ? null : ProjectStore.assetRef(path);
    return [
      ...(entry.isDir || isScene
        ? [{ label: 'Open', onClick: () => onOpen(path, entry.isDir, entry.name) }]
        : []),
      { label: 'Rename', onClick: () => setRenaming(path) },
      { label: 'Duplicate', onClick: () => void duplicate(path) },
      { sep: true },
      { label: 'Copy Path', onClick: () => copy(path, 'Copied path') },
      ...(ref ? [{ label: 'Copy Reference', onClick: () => copy(ref, 'Copied reference') }] : []),
      { label: 'Show in Explorer', onClick: () => void showInExplorer(path) },
      { sep: true },
      { label: 'Delete', danger: true, onClick: () => void remove(path, entry.name) },
    ];
  })();

  if (!project) {
    return (
      <div className="panel">
        <div className="empty">
          <FolderOpen size={24} strokeWidth={1.4} />
          <p>Open a project to browse its assets.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="cb-work">
        {/* ── Sources (left) ── */}
        <div className="cb-panel cb-src">
          <div className="cb-head">
            <span className="pt">Sources</span>
          </div>
          <div className="cb-src-body">
            <div className="cb-sec">Folders</div>
            <FolderNode path="" name={project.name} depth={0} cwd={cwd} onSelect={go} />
          </div>
        </div>

        {/* ── Main (center) ── */}
        <div className="cb-panel cb-main">
          <div className="cb-bar">
            <div className="cb-nav">
              <button type="button" disabled={!canBack} onClick={back} title="Back">
                <ArrowLeft size={15} strokeWidth={2} />
              </button>
              <button type="button" disabled={!canForward} onClick={forward} title="Forward">
                <ArrowRight size={15} strokeWidth={2} />
              </button>
              <button type="button" disabled={!canUp} onClick={up} title="Up one level">
                <ArrowUp size={15} strokeWidth={2} />
              </button>
            </div>
            <div className="crumbs">
              {crumbs.map((c, i) => (
                <Fragment key={c.path}>
                  {i > 0 && <span className="sep">›</span>}
                  <span
                    className={`cr${i === crumbs.length - 1 ? ' cur' : ''}`}
                    onClick={() => go(c.path)}
                  >
                    {c.name}
                  </span>
                </Fragment>
              ))}
            </div>
            <div className="search cb-search">
              <Search size={13} strokeWidth={1.9} />
              <input
                placeholder="Search assets"
                spellCheck={false}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="cb-seg">
              <button type="button" className={view === 'grid' ? 'on' : ''} title="Grid view" onClick={() => setView('grid')}>
                <LayoutGrid size={13} strokeWidth={1.9} />
              </button>
              <button type="button" className={view === 'list' ? 'on' : ''} title="List view" onClick={() => setView('list')}>
                <List size={13} strokeWidth={1.9} />
              </button>
            </div>
            <button type="button" className="cb-ghost" title="New Folder" onClick={() => void newFolder()}>
              <FolderPlus size={13} strokeWidth={1.9} />
            </button>
            <button type="button" className="cb-add" disabled title="Import (coming soon)">
              <Import size={13} strokeWidth={1.9} /> Import
            </button>
          </div>

          <div className="cb-chips">
            <button
              type="button"
              className={`chip${filters.size === 0 ? ' on' : ''}`}
              onClick={() => setFilters(new Set())}
            >
              All
            </button>
            {CHIP_GROUPS.map((g) => {
              const active = g.types.every((t) => filters.has(t));
              return (
                <button
                  key={g.label}
                  type="button"
                  className={`chip${active ? ' on' : ''}`}
                  onClick={() =>
                    setFilters((prev) => {
                      const next = new Set(prev);
                      if (active) g.types.forEach((t) => next.delete(t));
                      else g.types.forEach((t) => next.add(t));
                      return next;
                    })
                  }
                >
                  <span className="d" style={{ background: g.color }} />
                  {g.label}
                </button>
              );
            })}
          </div>

          <div
            className={`cb-scroll${view === 'list' ? ' list' : ''}`}
            onScroll={clearHover}
            onClick={(e) => {
              if (e.target === e.currentTarget) selectAsset(null);
            }}
            onContextMenu={(e) => {
              // Items stopPropagation, so reaching here = a right-click on empty space.
              e.preventDefault();
              clearHover();
              setCtx({ x: e.clientX, y: e.clientY, target: null });
            }}
          >
            {view === 'grid' ? (
              <div className="cb-grid" style={{ ['--tile' as string]: `${tileSize}px` } as React.CSSProperties}>
                {items.map((e) => {
                  const path = join(cwd, e.name);
                  const type: AssetType = e.isDir ? 'folder' : assetType(e.name);
                  const isImg = !e.isDir && IMAGE_RE.test(e.name);
                  return (
                    <div
                      key={e.name}
                      className={`asset${e.isDir ? ' folder' : ''}${selected === path ? ' sel' : ''}`}
                      // Files drag onto inspector asset fields / the viewport (assign / instantiate).
                      {...bindItem(path, e)}
                    >
                      <div className="th">
                        {isImg ? (
                          <img src={`estella://project/${path}`} alt="" draggable={false} />
                        ) : (
                          <AssetIcon type={type} size={30} />
                        )}
                        {!e.isDir && TYPE_CODE[type] && <span className="badge">{TYPE_CODE[type]}</span>}
                      </div>
                      <div
                        className="nm"
                        style={e.isDir ? undefined : ({ ['--tc' as string]: assetTint(type) } as React.CSSProperties)}
                      >
                        {renaming === path ? (
                          <RenameInput
                            name={e.name}
                            onCommit={(v) => void commitRename(path, v)}
                            onCancel={() => setRenaming(null)}
                          />
                        ) : (
                          <span>{e.name}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {items.length === 0 && (
                  <div className="cb-empty" style={{ gridColumn: '1 / -1' }}>
                    {q ? 'No assets match.' : 'Empty folder.'}
                  </div>
                )}
              </div>
            ) : (
              <div className="cb-list">
                <div className="lh">
                  <span>Name</span>
                  <span>Type</span>
                </div>
                {items.map((e) => {
                  const path = join(cwd, e.name);
                  const type: AssetType = e.isDir ? 'folder' : assetType(e.name);
                  return (
                    <div key={e.name} className={`lr${selected === path ? ' sel' : ''}`} {...bindItem(path, e)}>
                      <span className="ln">
                        <AssetIcon type={type} size={15} />
                        {renaming === path ? (
                          <RenameInput
                            name={e.name}
                            onCommit={(v) => void commitRename(path, v)}
                            onCancel={() => setRenaming(null)}
                          />
                        ) : (
                          <span className="t">{e.name}</span>
                        )}
                      </span>
                      <span className="c">{e.isDir ? '' : TYPE_CODE[type] || type}</span>
                    </div>
                  );
                })}
                {items.length === 0 && <div className="cb-empty">{q ? 'No assets match.' : 'Empty folder.'}</div>}
              </div>
            )}
          </div>

          <div className="cb-foot">
            <span>
              {items.length} items{selected ? ' · 1 selected' : ''}
            </span>
            <span className="sp" />
            {view === 'grid' && (
              <input
                type="range"
                title="Thumbnail size"
                min={TILE_MIN}
                max={TILE_MAX}
                step={4}
                value={tileSize}
                onChange={(ev) => setTileSize(Number(ev.target.value))}
              />
            )}
          </div>
        </div>
      </div>

      {hover && !ctx && <AssetTooltip path={hover.path} entry={hover.entry} rect={hover.rect} />}
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems} onClose={() => setCtx(null)} />}
    </div>
  );
}
