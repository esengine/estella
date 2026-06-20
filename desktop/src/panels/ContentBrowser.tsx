import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ChevronRight, Search, Plus, LayoutGrid, Import, FolderOpen } from 'lucide-react';
import { AssetIcon } from '@/components/icons';
import { ContextMenu, type MenuItem } from '@/components/Menu';
import { ProjectStore } from '@/project/ProjectStore';
import { Toasts } from '@/store/Toasts';
import type { DirEntry } from '@/project/format';
import type { AssetType } from '@/types';

const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;

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
        <span>{name}</span>
      </div>
      {open && subdirs.map((d) => (
        <FolderNode key={d.name} path={join(path, d.name)} name={d.name} depth={depth + 1} cwd={cwd} onSelect={onSelect} />
      ))}
    </>
  );
}

export function ContentBrowser() {
  const project = useSyncExternalStore(ProjectStore.subscribe, ProjectStore.getSnapshot);
  const [cwd, setCwd] = useState('');
  const [query, setQuery] = useState('');
  const [ctx, setCtx] = useState<{ x: number; y: number; path: string } | null>(null);

  const entries = useDir(project ? cwd : null);
  const q = query.trim().toLowerCase();
  const items = useMemo(() => {
    const list = q ? entries.filter((e) => e.name.toLowerCase().includes(q)) : entries;
    // Folders first, then files; both alphabetical.
    return [...list].sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
  }, [entries, q]);

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
        <button type="button" className="iconbtn" title="View options">
          <LayoutGrid size={15} strokeWidth={1.85} />
        </button>
      </div>

      <div className="content__split">
        <div className="content__tree">
          <FolderNode path="" name={project.name} depth={0} cwd={cwd} onSelect={setCwd} />
        </div>

        <div className="content__grid">
          {items.map((e) => {
            const path = join(cwd, e.name);
            const type = e.isDir ? 'folder' : assetType(e.name);
            return (
              <button
                key={e.name}
                type="button"
                className="tile"
                // Files are draggable onto inspector asset fields (drag-assign);
                // the payload is the project-relative path, resolved to a @uuid: ref on drop.
                draggable={!e.isDir}
                onDragStart={(ev) => {
                  ev.dataTransfer.effectAllowed = 'copy';
                  ev.dataTransfer.setData('application/x-estella-asset', path);
                  ev.dataTransfer.setData('text/plain', path);
                }}
                onDoubleClick={() => e.isDir && setCwd(path)}
                onContextMenu={(ev) => {
                  ev.preventDefault();
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
              </button>
            );
          })}
          {items.length === 0 && <p className="inspector-note">{q ? 'No assets match.' : 'Empty folder.'}</p>}
        </div>
      </div>

      <div className="content__path mono">/{cwd} · {items.length} items</div>

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems} onClose={() => setCtx(null)} />}
    </div>
  );
}
