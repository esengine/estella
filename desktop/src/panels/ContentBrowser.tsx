import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ChevronRight, Search, Plus, LayoutGrid, Import, FolderOpen, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';
import { AssetIcon, assetTint } from '@/components/icons';
import { ContextMenu, type MenuItem } from '@/components/Menu';
import { ProjectStore } from '@/project/ProjectStore';
import { Toasts } from '@/store/Toasts';
import type { DirEntry } from '@/project/format';
import type { AssetType } from '@/types';

const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;
const TILE_MIN = 64;
const TILE_MAX = 152;
const TILE_KEY = 'estella.content.tileSize';

// Lazily read a project-relative directory (or [] when null / no project / error).
function useDir(relPath: string | null): DirEntry[] {
  const [entries, setEntries] = useState<DirEntry[]>([]);
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
  }, [relPath]);
  return entries;
}

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

// Folder navigation with a back/forward history (UE5 Content Browser nav arrows).
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

// Asset type label from the file extension (drives the icon + tile caption).
function assetType(name: string): AssetType {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_RE.test(name)) return ext === 'png' || ext === 'webp' ? 'texture' : 'sprite';
  if (ext === 'esscene') return 'scene';
  if (ext === 'ogg' || ext === 'mp3' || ext === 'wav') return 'audio';
  if (ext === 'ts' || ext === 'js') return 'script';
  if (ext === 'atlas' || ext === 'skel') return 'spine';
  if (ext === 'esprefab') return 'prefab';
  if (ext === 'esmat') return 'material';
  return 'file';
}

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
        className={`content__folder${cwd === path ? ' is-active' : ''}`}
        style={{ paddingLeft: depth * 14 + 6 }}
        title={name}
        onClick={() => onSelect(path)}
      >
        <button
          type="button"
          className={`content__folder-twist${open ? ' is-open' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
        >
          <ChevronRight size={12} strokeWidth={2} />
        </button>
        <AssetIcon type="folder" size={14} />
        <span className="content__folder-name">{name}</span>
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
  const [ctx, setCtx] = useState<{ x: number; y: number; path: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tileSize, setTileSize] = useState<number>(() => {
    const v = Number(localStorage.getItem(TILE_KEY));
    return v >= TILE_MIN && v <= TILE_MAX ? v : 96;
  });
  useEffect(() => localStorage.setItem(TILE_KEY, String(tileSize)), [tileSize]);

  // Reset navigation + selection when the open project changes.
  useEffect(() => {
    reset();
    setSelected(null);
  }, [project?.name, reset]);
  // Selection doesn't survive a folder change.
  useEffect(() => setSelected(null), [cwd]);

  const entries = useDir(project ? cwd : null);
  const q = query.trim().toLowerCase();
  const items = useMemo(() => {
    const list = q ? entries.filter((e) => e.name.toLowerCase().includes(q)) : entries;
    // Folders first, then files; both alphabetical.
    return [...list].sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
  }, [entries, q]);

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

  const ctxItems: MenuItem[] = ctx
    ? [
        {
          label: 'Copy Path',
          onClick: () => {
            void navigator.clipboard?.writeText(ctx.path);
            Toasts.push('Copied path', 'info', 1600);
          },
        },
      ]
    : [];

  if (!project) {
    return (
      <div className="panel content">
        <div className="empty">
          <FolderOpen size={24} strokeWidth={1.4} />
          <p>Open a project to browse its assets.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel content">
      <div className="panel__toolbar">
        <button type="button" className="btn-soft" disabled title="Import (coming soon)">
          <Import size={13} strokeWidth={1.85} /> Import
        </button>
        <button type="button" className="btn-soft" disabled title="Add (coming soon)">
          <Plus size={13} strokeWidth={1.85} /> Add
        </button>
        <div className="searchbox searchbox--grow">
          <Search size={13} strokeWidth={1.85} />
          <input
            className="searchbox__input"
            placeholder="Search assets"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <label className="content__size" title="Thumbnail size">
          <LayoutGrid size={14} strokeWidth={1.85} />
          <input
            type="range"
            min={TILE_MIN}
            max={TILE_MAX}
            step={4}
            value={tileSize}
            onChange={(e) => setTileSize(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="content__nav">
        <button type="button" className="content__navbtn" disabled={!canBack} onClick={back} title="Back">
          <ArrowLeft size={14} strokeWidth={2} />
        </button>
        <button type="button" className="content__navbtn" disabled={!canForward} onClick={forward} title="Forward">
          <ArrowRight size={14} strokeWidth={2} />
        </button>
        <button type="button" className="content__navbtn" disabled={!canUp} onClick={up} title="Up one level">
          <ArrowUp size={14} strokeWidth={2} />
        </button>
        <div className="breadcrumb">
          {crumbs.map((c, i) => (
            <span key={c.path} className="breadcrumb__item">
              {i > 0 && <ChevronRight className="breadcrumb__sep" size={12} strokeWidth={2} />}
              <button
                type="button"
                className={`breadcrumb__seg${i === crumbs.length - 1 ? ' is-current' : ''}`}
                onClick={() => go(c.path)}
              >
                {c.name}
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="content__split">
        <div className="content__tree">
          <FolderNode path="" name={project.name} depth={0} cwd={cwd} onSelect={go} />
        </div>

        <div
          className="content__grid"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${tileSize}px, 1fr))` }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          {items.map((e) => {
            const path = join(cwd, e.name);
            const type = e.isDir ? 'folder' : assetType(e.name);
            return (
              <button
                key={e.name}
                type="button"
                className={`tile${selected === path ? ' is-selected' : ''}`}
                // Files are draggable onto inspector asset fields / the viewport
                // (drag-assign / instantiate); the payload is the project-relative
                // path, resolved to a @uuid: ref on drop.
                draggable={!e.isDir}
                onDragStart={(ev) => {
                  ev.dataTransfer.effectAllowed = 'copy';
                  ev.dataTransfer.setData('application/x-estella-asset', path);
                  ev.dataTransfer.setData('text/plain', path);
                }}
                onClick={() => setSelected(path)}
                onDoubleClick={() => e.isDir && go(path)}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  setSelected(path);
                  setCtx({ x: ev.clientX, y: ev.clientY, path });
                }}
              >
                <span className="tile__thumb">
                  {!e.isDir && IMAGE_RE.test(e.name) ? (
                    <img className="tile__img" src={`estella://project/${path}`} alt="" draggable={false} />
                  ) : (
                    <AssetIcon type={type} />
                  )}
                </span>
                <span className="tile__name">{e.name}</span>
                <span className="tile__type">{type}</span>
                <span className="tile__bar" style={{ background: assetTint(type) }} />
              </button>
            );
          })}
          {items.length === 0 && <p className="inspector-note">{q ? 'No assets match.' : 'Empty folder.'}</p>}
        </div>
      </div>

      <div className="content__path mono">
        {items.length} items{selected ? ' · 1 selected' : ''}
      </div>

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems} onClose={() => setCtx(null)} />}
    </div>
  );
}
