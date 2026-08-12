// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronRight, LayoutGrid, List, Import, FolderOpen, Folder, FolderPlus, ArrowLeft, ArrowRight, ArrowUp, ArrowDownUp, Play, EyeOff, Plus, Search } from 'lucide-react';
import { AssetIcon, assetTint } from '@/components/icons';
import { EmptyState } from '@/components/EmptyState';
import { IconButton } from '@/components/IconButton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { VirtualGrid } from '@/components/VirtualGrid';
import { SearchField } from '@/components/SearchField';
import { ContextMenu, type MenuItem } from '@/components/Menu';
import { useTooltip } from '@/components/Tooltip';
import { Segmented } from '@/components/Segmented';
import { ProjectStore } from '@/project/ProjectStore';
import { AssetRegistry } from '@/project/AssetRegistry';
import { Toasts } from '@/store/Toasts';
import { useSelection } from '@/store/selectionStore';
import { IMAGE_RE, baseName, TYPE_CODE } from '@/project/assetMeta';
import { formatBytes } from '@/project/sizeBudget';
import { openAssetOfType } from '@/project/assetOpen';
import { assetTypeRegistry } from '@/project/assetTypes';
import { contributedContextRows } from '@/plugins/contextMenus';
import { syncAssetPaths } from '@/project/assetPathSync';
import { findAssetUsagesOfAll, type AssetUsage } from '@/project/assetUsages';
import { deleteAssets } from '@/project/deleteAssets';
import { FindUsagesDialog } from '@/components/FindUsagesDialog';
import { NewTilesetDialog } from '@/components/NewTilesetDialog';
import { parseAssetQuery, filterAndSortAssets, type AssetSort } from '@/project/assetFilter';
// Create-FROM-a-source-asset actions (context menu); the "New blank asset" list
// lives in the NEW_ASSET_TYPES registry.
import { createTilesetFromTexture } from '@/tileset/openTileset';
import { createFlipbookFromTexture } from '@/flipbook/openFlipbook';
import { createAnimatedSpriteFromClip } from '@/flipbook/createAnimatedSprite';
import { createTilemapFromTileset } from '@/tilemap/createTilemap';
import { createMaterialInstance } from '@/material/openMaterial';
import { NEW_ASSET_TYPES, type CreateAsset } from '@/project/newAssetTypes';
import { ASSET_GROUP_MODES, type AssetGroupMode } from 'esengine';
import { onAssetReveal } from '@/project/assetReveal';
import { fsRefresh } from '@/project/fsRefresh';
import { t, type MsgKey } from '@/i18n';
import type { DirEntry } from '@/project/format';
import type { AssetType } from '@/types';

const TILE_MIN = 64;
const TILE_MAX = 152;
const TILE_KEY = 'estella.content.tileSize';
// Must match the `gap` on .cb-grid in content.css — the grid lays its own rows out.
const GRID_GAP = 10;
// Must match .lr in content.css — the first-render guess, before one is measured.
const LIST_ROW_H = 30;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** What kind of thing a project file is — the ONE resolver the tiles, badges, type
 *  chips, sort and double-click open all read, so they cannot disagree. Asked by
 *  PATH, not name: a file's type is not always readable from its name (a Spine JSON
 *  skeleton is a plain `.json`), and the registry knows what its `.meta` recorded. */
const typeAt = (path: string): AssetType => AssetRegistry.assetTypeAt(path);

// Per-delivery-mode presentation (menu label + corner badge; `local` has none).
// Keyed by AssetGroupMode so adding a mode to the SDK's ASSET_GROUP_MODES forces
// a matching entry here — the vocabulary is single-sourced in the SDK, only its
// editor-side presentation lives here.
const DELIVERY_MODE_META: Record<AssetGroupMode, { labelKey: MsgKey; badge?: { color: string; textKey: MsgKey } }> = {
  local: { labelKey: 'cb.deliveryLocal' },
  subpackage: { labelKey: 'cb.deliverySubpackage', badge: { color: '#8a5cf6', textKey: 'cb.badgeSubpackage' } },
  remote: { labelKey: 'cb.deliveryRemote', badge: { color: '#2f6df6', textKey: 'cb.badgeRemote' } },
};

// Lazily read a project-relative directory (or [] when null / no project / error),
// re-reading whenever the path changes or an fs mutation bumps fsRefresh.
// `loading` flips in-render on a path change (so the empty state never paints
// before the read lands); fs-version bumps refresh silently over stale rows.
function useDir(relPath: string | null): { entries: DirEntry[]; loading: boolean } {
  const [state, setState] = useState<{ path: string | null; entries: DirEntry[]; loading: boolean }>({
    path: relPath,
    entries: [],
    loading: relPath != null,
  });
  const version = useSyncExternalStore(fsRefresh.subscribe, fsRefresh.get);
  if (state.path !== relPath) setState({ path: relPath, entries: [], loading: relPath != null });
  useEffect(() => {
    if (relPath == null || !window.estella?.fs) {
      setState((s) => (s.entries.length || s.loading ? { path: relPath, entries: [], loading: false } : s));
      return;
    }
    let alive = true;
    window.estella.fs
      .readDir(relPath)
      .then((e) => alive && setState({ path: relPath, entries: e, loading: false }))
      .catch(() => alive && setState({ path: relPath, entries: [], loading: false }));
    return () => {
      alive = false;
    };
  }, [relPath, version]);
  return state;
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

function TipRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="cb-tip-row">
      <span className="k">{k}</span>
      <span className={`v${mono ? ' mono' : ''}`}>{v}</span>
    </div>
  );
}

// UE5-style hover-card body: the metadata you can't see at a glance (type / path /
// reference / image dimensions / disk size / modified). Positioning, portaling and
// dismissal are the shared <Tooltip> primitive's job; this is just the contents,
// fetched lazily on show.
function AssetTipCard({ path, entry }: { path: string; entry: DirEntry }) {
  const [stat, setStat] = useState<{ size: number; mtimeMs: number } | null>(null);
  const [dims, setDims] = useState<string | null>(null);

  const type: AssetType = entry.isDir ? 'folder' : typeAt(path);
  const isImg = !entry.isDir && IMAGE_RE.test(entry.name);
  const assetReference = entry.isDir ? null : AssetRegistry.assetRef(path);

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

  return (
    <>
      <div className="cb-tip-name">{entry.name}</div>
      <TipRow k={t('cb.type')} v={entry.isDir ? t('cb.tipFolder') : TYPE_CODE[type] || type} />
      {dims && <TipRow k={t('cb.tipDimensions')} v={dims} />}
      {!entry.isDir && stat && <TipRow k={t('cb.tipSize')} v={formatBytes(stat.size)} />}
      {stat && <TipRow k={t('cb.tipModified')} v={new Date(stat.mtimeMs).toLocaleString()} />}
      <TipRow k={t('cb.tipPath')} v={path} mono />
      {assetReference && <TipRow k={t('cb.tipReference')} v={assetReference} mono />}
    </>
  );
}

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

// A browser row: an entry plus its full project-relative path. Folder-view rows
// derive the path from cwd; recursive-search rows carry their own (cross-folder) path.
interface Row {
  path: string;
  name: string;
  isDir: boolean;
}
const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

// Where a project's content lives. The browser opens here, not at the project
// root — whose listing is the same boilerplate for every project ever opened.
const CONTENT_ROOT = 'assets';

// Folder navigation with a back/forward history (the breadcrumb nav arrows).
function useNav() {
  const [nav, setNav] = useState<{ hist: string[]; i: number }>({ hist: [CONTENT_ROOT], i: 0 });
  const cwd = nav.hist[nav.i];
  const go = useCallback(
    (p: string) => setNav((n) => (p === n.hist[n.i] ? n : { hist: [...n.hist.slice(0, n.i + 1), p], i: n.i + 1 })),
    [],
  );
  const back = useCallback(() => setNav((n) => ({ ...n, i: Math.max(0, n.i - 1) })), []);
  const forward = useCallback(() => setNav((n) => ({ ...n, i: Math.min(n.hist.length - 1, n.i + 1) })), []);
  const up = useCallback(() => go(parentOf(cwd)), [go, cwd]);
  const reset = useCallback((to: string = CONTENT_ROOT) => setNav({ hist: [to], i: 0 }), []);
  return { cwd, go, back, forward, up, reset, canBack: nav.i > 0, canForward: nav.i < nav.hist.length - 1, canUp: cwd !== '' };
}

// Always-visible type filter chips (each toggles a group of asset types). A chip
// is active when all its types are in the filter set; "All" clears the filter.
const CHIP_GROUPS: { label: string; types: AssetType[]; color: string }[] = [
  { label: t('cb.chipImage'), types: ['texture', 'sprite'], color: assetTint('texture') },
  { label: t('cb.chipPrefab'), types: ['prefab'], color: assetTint('prefab') },
  { label: t('cb.chipScene'), types: ['scene'], color: assetTint('scene') },
  { label: t('cb.chipAnimation'), types: ['animation'], color: assetTint('animation') },
  { label: t('cb.chipScript'), types: ['script'], color: assetTint('script') },
  { label: t('cb.chipAudio'), types: ['audio'], color: assetTint('audio') },
  { label: t('cb.chipMaterial'), types: ['material'], color: assetTint('material') },
];

function FolderNode({
  path,
  name,
  depth,
  cwd,
  onSelect,
  folderDrop,
  dropPath,
  onContext,
  renaming,
  onRename,
  onCommitRename,
  onCancelRename,
}: {
  path: string;
  name: string;
  depth: number;
  cwd: string;
  onSelect: (p: string) => void;
  folderDrop?: (
    folderPath: string,
  ) => Pick<React.HTMLAttributes<HTMLDivElement>, 'onDragEnter' | 'onDragOver' | 'onDragLeave' | 'onDrop'>;
  dropPath?: string | null;
  /** Right-click a folder row → the shared folder context menu (Open/Rename/Delete…). */
  onContext?: (path: string, name: string, ev: React.MouseEvent) => void;
  /** The path currently being inline-renamed (shows the editor in that row). */
  renaming?: string | null;
  onRename?: (path: string) => void; // F2 → start renaming this folder
  onCommitRename?: (path: string, value: string) => void;
  onCancelRename?: () => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const { entries: children, loading } = useDir(open ? path : null);
  const subdirs = children.filter((e) => e.isDir);
  // Only an OPEN listing can prove a folder childless: counting a closed node's
  // subdirs answers 0 for every one of them, retiring a twisty nothing can click
  // again. Assume expandable until a listing says otherwise, and keep that answer.
  const [childless, setChildless] = useState(false);
  useEffect(() => {
    if (open && !loading) setChildless(subdirs.length === 0);
  }, [open, loading, subdirs.length]);

  // Tree keyboard: Enter/Space enters the folder, ←/→ collapse/expand, ↑/↓ walk
  // the visible rows. Arrows are consumed so they never reach the global nudge.
  const onRowKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        onSelect(path);
        break;
      case 'F2':
        // Rename in the tree, matching the grid — the root (depth 0 = project) has
        // no real folder path to rename.
        if (depth > 0 && onRename) {
          e.preventDefault();
          onRename(path);
        }
        break;
      case 'ArrowRight':
        e.preventDefault();
        e.stopPropagation();
        if (!childless && !open) setOpen(true);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        e.stopPropagation();
        if (open && depth > 0) setOpen(false);
        break;
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        e.stopPropagation();
        const rows = e.currentTarget.closest('.cb-src-body')?.querySelectorAll<HTMLElement>('.tr');
        if (!rows) break;
        const list = [...rows];
        const next = list[list.indexOf(e.currentTarget) + (e.key === 'ArrowDown' ? 1 : -1)];
        next?.focus();
        break;
      }
    }
  };

  return (
    <>
      <div
        className={`tr${cwd === path ? ' sel' : ''}${open ? ' open' : ''}${dropPath === path ? ' is-drop' : ''}`}
        style={{ paddingLeft: depth * 12 + 6 }}
        title={name}
        role="treeitem"
        aria-expanded={childless ? undefined : open}
        aria-selected={cwd === path}
        tabIndex={0}
        onKeyDown={onRowKey}
        onClick={() => onSelect(path)}
        onContextMenu={depth > 0 && onContext ? (ev) => onContext(path, name, ev) : undefined}
        {...(folderDrop ? folderDrop(path) : null)}
      >
        <span
          className={`tw${childless ? ' leaf' : ''}`}
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
        {renaming === path && onCommitRename && onCancelRename ? (
          <RenameInput name={name} onCommit={(v) => onCommitRename(path, v)} onCancel={onCancelRename} />
        ) : (
          <span className="tn">{name}</span>
        )}
      </div>
      {open && subdirs.map((d) => (
        <FolderNode key={d.name} path={join(path, d.name)} name={d.name} depth={depth + 1} cwd={cwd} onSelect={onSelect} folderDrop={folderDrop} dropPath={dropPath}
          onContext={onContext} renaming={renaming} onRename={onRename} onCommitRename={onCommitRename} onCancelRename={onCancelRename} />
      ))}
    </>
  );
}

export function ContentBrowser() {
  const project = useSyncExternalStore(ProjectStore.subscribe, ProjectStore.getSnapshot);
  const { cwd, go, back, forward, up, reset, canBack, canForward, canUp } = useNav();
  const [query, setQuery] = useState('');
  // A right-click menu: on an item (target set) or on empty space (target null).
  const [ctx, setCtx] = useState<{ x: number; y: number; target: { path: string; entry: DirEntry; inTree?: boolean } | null } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  // A folder can appear in BOTH the tree and the grid (cwd = its parent). Track
  // which surface owns the rename so only ONE editor mounts — two RenameInputs on
  // the same path fight for focus and immediately commit each other closed.
  const [renameInTree, setRenameInTree] = useState(false);
  const startRename = (path: string, inTree = false) => {
    setRenameInTree(inTree);
    setRenaming(path);
  };
  // The tile being dragged dims so the source of the move reads at a glance.
  const [dragPath, setDragPath] = useState<string | null>(null);
  const [filters, setFilters] = useState<Set<AssetType>>(new Set());
  const [sort, setSort] = useState<AssetSort>('name');
  const tip = useTooltip<{ path: string; entry: DirEntry }>((p) => <AssetTipCard path={p.path} entry={p.entry} />);

  // Asset selection lives in the shared store (unified inspector): selecting an
  // asset drives the Details panel + clears any entity selection.
  const selected = useSelection((s) => s.selectedAsset);
  const selectedAssets = useSelection((s) => s.selectedAssets);
  const selectAsset = useSelection((s) => s.selectAsset);
  const toggleAsset = useSelection((s) => s.toggleAsset);
  const selectAssets = useSelection((s) => s.selectAssets);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [tileSize, setTileSize] = useState<number>(() => {
    const v = Number(localStorage.getItem(TILE_KEY));
    return v >= TILE_MIN && v <= TILE_MAX ? v : 96;
  });
  useEffect(() => localStorage.setItem(TILE_KEY, String(tileSize)), [tileSize]);

  // Reset navigation + selection + search/filter when the open project changes —
  // project A's query/type-filter must not carry into project B's browser.
  useEffect(() => {
    let alive = true;
    reset();
    selectAsset(null);
    setQuery('');
    setFilters(new Set());
    // A project laid out some other way has no assets/ — land on its root rather
    // than on a folder that isn't there. Asked of the ROOT listing, which always
    // reads, instead of probing the missing folder itself.
    void window.estella?.fs
      ?.readDir('')
      .then((e) => {
        if (alive && !e.some((d) => d.isDir && d.name === CONTENT_ROOT)) reset('');
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [project?.name, reset, selectAsset]);
  // Selection doesn't survive a folder change.
  useEffect(() => selectAsset(null), [cwd, selectAsset]);

  // Cross-panel locate (revealAsset): navigate to the containing folder first;
  // selection + scroll happen in a second phase once the folder's rows are in
  // (and after the cwd-change effect above has done its clearing).
  const [pendingReveal, setPendingReveal] = useState<string | null>(null);
  useEffect(
    () =>
      onAssetReveal((path) => {
        setQuery('');
        setFilters(new Set());
        setPendingReveal(path);
        go(parentOf(path));
      }),
    [go],
  );

  const { entries, loading: dirLoading } = useDir(project ? cwd : null);
  const q = query.trim();
  // Search supports `type:`/`t:` tokens + free text; the type chips add to the
  // token constraint; sort is folders-first, then by name or type.
  const parsed = useMemo(() => parseAssetQuery(query), [query]);
  // With a non-empty query, search the whole cwd subtree (flat, project-wide-style);
  // otherwise list just the current folder. The recursive file list is fetched
  // main-side and refreshed on fs mutations (same signal useDir rides).
  const searching = q.length > 0;
  const fsVersion = useSyncExternalStore(fsRefresh.subscribe, fsRefresh.get);
  // Keyed like useDir: entering search / changing folders flips `loading`
  // in-render (skeletons, not a false "No assets match."); version bumps
  // re-scan silently over the stale list.
  const scanKey = project && searching ? cwd : null;
  const [scan, setScan] = useState<{ key: string | null; files: string[]; loading: boolean }>({
    key: scanKey,
    files: [],
    loading: scanKey != null,
  });
  if (scan.key !== scanKey) setScan({ key: scanKey, files: [], loading: scanKey != null });
  useEffect(() => {
    if (scanKey == null) return;
    let alive = true;
    window.estella.fs
      .listFiles(scanKey)
      .then((f) => alive && setScan({ key: scanKey, files: f, loading: false }))
      .catch(() => alive && setScan({ key: scanKey, files: [], loading: false }));
    return () => {
      alive = false;
    };
  }, [scanKey, fsVersion]);

  const rows = useMemo<Row[]>(
    () =>
      searching
        ? scan.files.map((p) => ({ path: p, name: p.split('/').pop() ?? p, isDir: false }))
        : entries.map((e) => ({ path: join(cwd, e.name), name: e.name, isDir: e.isDir })),
    [searching, scan.files, entries, cwd],
  );
  const items = useMemo(
    () => filterAndSortAssets(rows, parsed, filters as ReadonlySet<string>, sort, typeAt),
    [rows, parsed, filters, sort],
  );
  const listLoading = searching ? scan.loading : dirLoading;

  // Scrolling is by INDEX, not by finding the element: with the list windowed, the
  // row being revealed is usually not in the DOM to be found.
  const [scrollTo, setScrollTo] = useState<{ index: number; nonce: number }>({ index: -1, nonce: 0 });
  const scrollNonce = useRef(0);
  const revealIndex = useCallback(
    (index: number) => setScrollTo({ index, nonce: ++scrollNonce.current }),
    [],
  );

  useEffect(() => {
    if (!pendingReveal) return;
    const index = items.findIndex((it) => it.path === pendingReveal);
    if (index < 0) return;
    selectAsset(pendingReveal);
    setPendingReveal(null);
    revealIndex(index);
  }, [pendingReveal, items, selectAsset, revealIndex]);

  // Double-click: enter folders; otherwise dispatch through the per-type open
  // table (scene/clip/tileset editors).
  const onOpen = (path: string, isDir: boolean, name: string) => {
    if (isDir) {
      go(path);
      return;
    }
    // Awaitable for drivers; a double-click has nothing to wait for, and every
    // opener already reports its own failure as a toast.
    void openAssetOfType(typeAt(path), path, name).catch(() => {});
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

  // Undo for file ops rides on toasts, NOT EditorHistory: fs changes aren't
  // document edits, and pushing them into the scene stack would poison its
  // dirty tracking and Ctrl+Z ordering. Reverting is a best-effort fs op — a
  // path taken in the meantime surfaces as an error toast.
  const undoMove = async (from: string, to: string) => {
    try {
      await window.estella.fs.rename(from, to);
      syncAssetPaths(from, to);
      refreshFs();
      selectAsset(to);
    } catch (e) {
      Toasts.push(t('cb.undoFailed', { error: errMsg(e) }), 'error');
    }
  };

  const commitRename = async (path: string, raw: string) => {
    setRenaming(null);
    let name = raw.trim();
    const cur = path.slice(path.lastIndexOf('/') + 1);
    if (!name || name === cur) return;
    if (/[\\/]/.test(name)) {
      Toasts.push(t('cb.nameNoSlashes'), 'error');
      return;
    }
    // Preserve a FILE's extension if the user dropped it (e.g. Ctrl+A + retype):
    // the type drives the icon AND double-click open and is mostly extension-based,
    // so an extensionless file would go inert. Folders have no extension to keep.
    const isDir = entries.find((e) => e.name === cur)?.isDir ?? false;
    const dot = cur.lastIndexOf('.');
    const ext = !isDir && dot > 0 ? cur.slice(dot) : '';
    if (ext && !name.toLowerCase().endsWith(ext.toLowerCase())) name += ext;
    if (name === cur) return;
    const dest = join(parentOf(path), name);
    try {
      await window.estella.fs.rename(path, dest);
      syncAssetPaths(path, dest);
      refreshFs();
      selectAsset(dest);
      Toasts.push(t('cb.renamedTo', { name }), 'info', 6000, { label: t('cb.undo'), run: () => void undoMove(dest, path) });
    } catch (e) {
      Toasts.push(t('cb.renameFailed', { error: errMsg(e) }), 'error');
    }
  };

  const duplicate = async (path: string) => {
    try {
      const next = await window.estella.fs.duplicate(path);
      refreshFs();
      selectAsset(next);
      Toasts.push(t('cb.duplicatedAs', { name: next.split('/').pop() ?? next }), 'info', 6000, {
        label: t('cb.undo'),
        run: async () => {
          try {
            await window.estella.fs.trash(next);
            refreshFs();
            if (useSelection.getState().selectedAsset === next) selectAsset(null);
          } catch (e) {
            Toasts.push(t('cb.undoFailed', { error: errMsg(e) }), 'error');
          }
        },
      });
    } catch (e) {
      Toasts.push(t('cb.duplicateFailed', { error: errMsg(e) }), 'error');
    }
  };

  // Delete = themed confirm (Enter confirms, Esc cancels) → trash. The dialog
  // body lists WHICH scenes/prefabs reference the asset (disk dep graph + the
  // unsaved in-memory scene — a ref added since the last save would break too).
  const [confirmDel, setConfirmDel] = useState<{ paths: string[]; names: string[]; usages: AssetUsage[] } | null>(null);
  const [usagesPath, setUsagesPath] = useState<string | null>(null);
  const [newTilesetFor, setNewTilesetFor] = useState<string | null>(null);
  // Confirm deletion of one OR many assets (multi-select) behind a SINGLE dialog —
  // aggregating each one's references so nothing gets deleted out from under a scene.
  const remove = async (paths: string[]) => {
    if (paths.length === 0) return;
    // Best-effort: if the scan fails, confirm without the warnings.
    const usages = await findAssetUsagesOfAll(paths).catch((): AssetUsage[] => []);
    setConfirmDel({ paths, names: paths.map((p) => baseName(p)), usages });
  };
  const doRemove = async () => {
    const target = confirmDel;
    setConfirmDel(null);
    if (!target) return;
    // Trash each; remember (path, token) pairs so one Undo restores the whole batch.
    const results = await deleteAssets(target.paths);
    const trashed: { path: string; token: string }[] = [];
    for (const r of results) {
      if (r.token !== null) trashed.push({ path: r.path, token: r.token });
      else Toasts.push(t('cb.deleteFailed', { error: r.error ?? '' }), 'error');
    }
    refreshFs();
    selectAsset(null);
    if (trashed.length === 0) return;
    const msg = trashed.length === 1 ? t('cb.deletedName', { name: target.names[0] }) : t('cb.deletedCount', { count: trashed.length });
    Toasts.push(msg, 'info', 6000, {
      label: t('cb.undo'),
      run: async () => {
        for (const { path, token } of trashed) {
          try {
            await window.estella.fs.restoreTrashed(path, token);
          } catch (e) {
            Toasts.push(t('cb.undoFailed', { error: errMsg(e) }), 'error');
          }
        }
        refreshFs();
      },
    });
  };

  // Keyboard, scoped to the focused item area (it carries tabIndex, so clicking a
  // tile lands focus there): arrow/Home/End navigation, Enter open, F2 rename,
  // Delete, Ctrl+D duplicate — the same conventions as the Outliner. Delete is
  // consumed even with nothing selected, so it can never fall through to the
  // global entity delete while the user is working in the browser.
  const scrollRef = useRef<HTMLDivElement>(null);
  // Reported by the grid, which decides the count rather than reading it back off
  // the laid-out tiles — with only a window of them mounted, there is no longer a
  // full first row to measure where the wrap fell.
  const [gridColumns, setGridColumns] = useState(1);
  const onGridKey = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (el.tagName === 'INPUT' || renaming != null) return; // typing / inline rename
    const idx = items.findIndex((it) => it.path === selected);
    const focusIndex = (i: number, extend = false) => {
      const it = items[Math.max(0, Math.min(items.length - 1, i))];
      if (!it) return;
      // Shift+arrow grows the multi-selection to the new item; plain arrow replaces.
      if (extend) selectAssets([...new Set([...selectedAssets, it.path])], it.path);
      else selectAsset(it.path);
      revealIndex(items.indexOf(it));
    };
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        e.preventDefault();
        e.stopPropagation(); // grid navigation, not the viewport's selection nudge
        const rowStep = view === 'grid' ? gridColumns : 1;
        const step =
          e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? rowStep : -rowStep;
        focusIndex(idx < 0 ? 0 : idx + step, e.shiftKey);
        break;
      }
      case 'Home': {
        e.preventDefault();
        e.stopPropagation();
        focusIndex(0);
        break;
      }
      case 'End': {
        e.preventDefault();
        e.stopPropagation();
        focusIndex(items.length - 1);
        break;
      }
      case 'Enter': {
        const it = items[idx];
        if (it) {
          e.preventDefault();
          onOpen(it.path, it.isDir, it.name);
        }
        break;
      }
      case 'F2': {
        if (idx >= 0 && selected) {
          e.preventDefault();
          startRename(selected);
        }
        break;
      }
      case 'Delete':
      case 'Backspace': {
        e.preventDefault();
        e.stopPropagation();
        // Delete the whole multi-selection at once (one confirm), else the focused item.
        const paths = selectedAssets.size > 0 ? [...selectedAssets] : items[idx] ? [items[idx].path] : [];
        if (paths.length) void remove(paths);
        break;
      }
      case 'a':
      case 'A': {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          e.stopPropagation(); // select all IN the browser, not the scene's entities
          const paths = items.map((it) => it.path);
          if (paths.length) selectAssets(paths, paths[paths.length - 1]);
        }
        break;
      }
      case 'd':
      case 'D': {
        if ((e.ctrlKey || e.metaKey) && idx >= 0 && selected) {
          e.preventDefault();
          e.stopPropagation();
          void duplicate(selected);
        }
        break;
      }
      case 'Escape': {
        if (selected) {
          e.stopPropagation();
          selectAsset(null);
        }
        break;
      }
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
      setQuery(""); setFilters(new Set()); startRename(path); // drop straight into rename, like UE5
    } catch (e) {
      Toasts.push(t('cb.newFolderFailed', { error: errMsg(e) }), 'error');
    }
  };

  // Run a NEW_ASSET_TYPES creator. A returned path is a blank-file asset with no
  // editor of its own → reveal it + drop into rename (like New Folder); void means
  // the creator opened its own editor and refreshed/toasted itself.
  const runNew = async (create: CreateAsset, errorKey?: MsgKey) => {
    try {
      const path = await create(cwd);
      if (typeof path === 'string') {
        refreshFs();
        selectAsset(path);
        setQuery(""); setFilters(new Set()); startRename(path);
      }
    } catch (e) {
      if (errorKey) Toasts.push(t(errorKey, { error: errMsg(e) }), 'error');
    }
  };

  const newAssetItems: MenuItem[] = [
    ...NEW_ASSET_TYPES.map((a) =>
      a.templates
        ? { label: t(a.labelKey), children: a.templates().map((tpl) => ({ label: tpl.label, onClick: () => void runNew(tpl.create) })) }
        : { label: t(a.labelKey), onClick: () => void runNew(a.create!, a.errorKey) },
    ),
    // Contributed asset types that offer a creator, after the built-ins. They go
    // through the SAME runNew path, so a contributed asset is revealed and dropped
    // into rename exactly like a built-in one.
    ...assetTypeRegistry
      .all()
      .filter((type) => type.create)
      .map((type) => ({ label: type.create!.label, onClick: () => void runNew(type.create!.run) })),
  ];

  const showInExplorer = async (path: string) => {
    try {
      await window.estella.shell.showItem(path);
    } catch (e) {
      Toasts.push(t('cb.revealFailed', { error: errMsg(e) }), 'error');
    }
  };

  // Shared post-import handling (dialog import + OS drag-drop): refresh, select the
  // last new asset, and report imported / skipped counts.
  const applyImportResult = (res: { imported: string[]; skipped: string[] } | null) => {
    if (!res) return;
    refreshFs();
    if (res.imported.length) {
      selectAsset(res.imported[res.imported.length - 1]);
      const n = res.imported.length;
      Toasts.push(t(n > 1 ? 'cb.importedMany' : 'cb.importedOne', { count: n }), 'success');
    }
    if (res.skipped.length) {
      const n = res.skipped.length;
      Toasts.push(t(n > 1 ? 'cb.skippedMany' : 'cb.skippedOne', { count: n }), 'warn');
    }
  };

  const importAssets = async () => {
    try {
      applyImportResult(await window.estella.project.importAssets(cwd));
    } catch (e) {
      Toasts.push(t('cb.importFailed', { error: errMsg(e) }), 'error');
    }
  };

  // OS drag-drop import: files dragged from Finder/Explorer onto the browser body.
  // Internal asset drags carry our custom type and are ignored here (they re-assign,
  // not import). Electron 32+ removed File.path, so resolve via the preload bridge.
  const isOsFileDrag = (e: React.DragEvent) =>
    !e.dataTransfer.types.includes('application/x-estella-asset') &&
    Array.from(e.dataTransfer.types).includes('Files');

  // Drop affordances. dragenter/dragleave also fire when crossing child elements,
  // so both the body and each folder target keep an enter-depth counter — the
  // highlight clears only when the count returns to zero (a real exit), never on
  // a child-to-child transition.
  const [fileDrop, setFileDrop] = useState(false);
  const fileDragDepth = useRef(0);
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  const folderDragDepth = useRef(new Map<string, number>());
  const clearDropState = () => {
    fileDragDepth.current = 0;
    setFileDrop(false);
    folderDragDepth.current.clear();
    setDropFolder(null);
  };

  const onBodyDragEnter = (e: React.DragEvent) => {
    if (!isOsFileDrag(e)) return;
    fileDragDepth.current++;
    setFileDrop(true);
  };

  const onBodyDragOver = (e: React.DragEvent) => {
    if (!isOsFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const onBodyDragLeave = (e: React.DragEvent) => {
    if (!isOsFileDrag(e)) return;
    fileDragDepth.current = Math.max(0, fileDragDepth.current - 1);
    if (fileDragDepth.current === 0) setFileDrop(false);
  };

  const onBodyDrop = (e: React.DragEvent) => {
    clearDropState();
    if (!isOsFileDrag(e)) return;
    e.preventDefault();
    const sources = Array.from(e.dataTransfer.files)
      .map((f) => window.estella.app.getPathForFile(f))
      .filter(Boolean);
    if (!sources.length) return;
    void window.estella.project
      .importFiles(cwd, sources)
      .then(applyImportResult)
      .catch((err) => Toasts.push(t('cb.importFailed', { error: errMsg(err) }), 'error'));
  };

  // Move an asset into a folder (drag onto a folder tile / tree node). Rename moves
  // the `.meta` sidecar too, so uuid refs survive; rejects no-op and self/descendant
  // moves. Refs are uuid-based, so nothing referencing the asset breaks.
  // Move one asset into a folder (no toast / refresh — the callers own those, so a
  // batch move renames every file before one combined refresh + undo toast).
  const doMoveAsset = async (srcPath: string, folderPath: string): Promise<string | null> => {
    const name = srcPath.split('/').pop();
    if (!name) return null;
    const dest = join(folderPath, name);
    if (dest === srcPath || srcPath === folderPath || folderPath.startsWith(`${srcPath}/`)) return null;
    try {
      await window.estella.fs.rename(srcPath, dest);
      syncAssetPaths(srcPath, dest);
      if (selected === srcPath) selectAsset(dest);
      return dest;
    } catch (e) {
      Toasts.push(t('cb.moveFailed', { error: errMsg(e) }), 'error');
      return null;
    }
  };

  const moveAssetToFolder = async (srcPath: string, folderPath: string) => {
    const dest = await doMoveAsset(srcPath, folderPath);
    if (!dest) return;
    refreshFs();
    Toasts.push(t('cb.movedTo', { name: srcPath.split('/').pop() ?? srcPath, dest: folderPath || t('cb.projectRoot') }), 'info', 6000, {
      label: t('cb.undo'),
      run: () => void undoMove(dest, srcPath),
    });
  };

  // Drag a multi-selection into a folder: move each, then ONE combined undo toast
  // (reverses every move) — so a batch move is one calm, undoable operation.
  const moveAssetsToFolder = async (srcPaths: string[], folderPath: string) => {
    if (srcPaths.length <= 1) return moveAssetToFolder(srcPaths[0], folderPath);
    const moved: { src: string; dest: string }[] = [];
    for (const src of srcPaths) {
      const dest = await doMoveAsset(src, folderPath);
      if (dest) moved.push({ src, dest });
    }
    if (!moved.length) return;
    refreshFs();
    Toasts.push(t('cb.movedCount', { count: moved.length, dest: folderPath || t('cb.projectRoot') }), 'info', 6000, {
      label: t('cb.undo'),
      run: () => void (async () => {
        for (const m of moved) await undoMove(m.dest, m.src);
      })(),
    });
  };

  // Drop-target props for a folder (tile, list row or tree node): accept internal
  // asset drags + highlight the hovered target. The clear on leave is conditional
  // because moving between targets fires the new target's dragenter first.
  const folderDrop = (folderPath: string) => ({
    onDragEnter: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('application/x-estella-asset')) return;
      folderDragDepth.current.set(folderPath, (folderDragDepth.current.get(folderPath) ?? 0) + 1);
      setDropFolder(folderPath);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('application/x-estella-asset')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('application/x-estella-asset')) return;
      const depth = (folderDragDepth.current.get(folderPath) ?? 0) - 1;
      if (depth <= 0) {
        folderDragDepth.current.delete(folderPath);
        setDropFolder((cur) => (cur === folderPath ? null : cur));
      } else {
        folderDragDepth.current.set(folderPath, depth);
      }
    },
    onDrop: (e: React.DragEvent) => {
      clearDropState();
      const multi = e.dataTransfer.getData('application/x-estella-assets');
      const src = e.dataTransfer.getData('application/x-estella-asset');
      const paths: string[] = multi ? JSON.parse(multi) : src ? [src] : [];
      if (!paths.length) return;
      e.preventDefault();
      e.stopPropagation();
      void moveAssetsToFolder(paths, folderPath);
    },
  });

  // Breadcrumb segments: Project › folder › subfolder, each a jump target.
  const crumbs = useMemo(() => {
    const out = [{ name: project?.name ?? t('cb.project'), path: '' }];
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
      tip.close();
      // copyMove: dropping into a folder MOVES; dropping into the scene / inspector
      // COPIES (instantiate / assign a ref) — so both cursors read correctly.
      ev.dataTransfer.effectAllowed = 'copyMove';
      ev.dataTransfer.setData('application/x-estella-asset', path);
      ev.dataTransfer.setData('text/plain', path);
      // Grabbing one of several selected assets drags the whole selection. Only the
      // folder-move reads this plural payload; single-asset consumers (assign a ref,
      // instantiate) keep reading the singular one above.
      if (selectedAssets.has(path) && selectedAssets.size > 1) {
        ev.dataTransfer.setData('application/x-estella-assets', JSON.stringify([...selectedAssets]));
      }
      setDragPath(path);
    },
    // A cancelled drag (Escape / dropped outside a target) fires no drop —
    // make sure no folder keeps its highlight and the source undims.
    onDragEnd: () => {
      clearDropState();
      setDragPath(null);
    },
    // Ctrl/Cmd toggles one item; Shift ranges from the primary; plain replaces —
    // the Outliner's multi-select gestures, so batch file ops are possible.
    onClick: (ev: React.MouseEvent) => {
      if (ev.ctrlKey || ev.metaKey) return toggleAsset(path);
      if (ev.shiftKey && selected) {
        const a = items.findIndex((it) => it.path === selected);
        const b = items.findIndex((it) => it.path === path);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          return selectAssets(items.slice(lo, hi + 1).map((it) => it.path), path);
        }
      }
      selectAsset(path);
    },
    onDoubleClick: () => onOpen(path, e.isDir, e.name),
    // Suppress the hover card while any inline rename is active.
    ...(renaming ? null : tip.bind({ path, entry: e })),
    onContextMenu: (ev: React.MouseEvent) => {
      ev.preventDefault();
      ev.stopPropagation(); // don't fall through to the empty-space menu
      tip.close();
      selectAsset(path);
      setCtx({ x: ev.clientX, y: ev.clientY, target: { path, entry: e } });
    },
  });

  const ctxItems: MenuItem[] = (() => {
    if (!ctx) return [];
    if (!ctx.target) {
      // Empty-space menu (acts on the current folder).
      return [
        { label: t('cb.menuImport'), icon: <Import size={14} />, onClick: () => void importAssets() },
        { label: t('cb.menuNewFolder'), icon: <FolderPlus size={14} />, onClick: () => void newFolder() },
        { sep: true },
        ...newAssetItems,
        { sep: true },
        { label: t('cb.menuShowInExplorer'), onClick: () => void showInExplorer(cwd) },
        ...contributedContextRows('content/background', { path: cwd }),
      ];
    }
    const { path, entry } = ctx.target;
    const targetType = entry.isDir ? 'folder' : typeAt(path);
    const isScene = targetType === 'scene';
    const isTexture = targetType === 'texture' || targetType === 'sprite';
    const isTileset = targetType === 'tileset';
    const isAnimClip = targetType === 'animclip';
    const isMaterial = targetType === 'material';
    const ref = entry.isDir ? null : AssetRegistry.assetRef(path);
    return [
      // Offered for everything, because opening now always resolves to something —
      // an editor, the program set for that kind of file, or the OS default. The
      // old folder/scene/material test stood in for "is this openable at all?",
      // which stopped being a real question when the chain grew its last link.
      { label: t('cb.menuOpen'), onClick: () => onOpen(path, entry.isDir, entry.name) },
      // The startup scene: what the editor opens, Play boots, and exports ship
      // first. One per project — the current one offers no redundant action,
      // and it can't be excluded from export (it IS the export's boot scene).
      ...(isScene && path !== project?.defaultScene
        ? [
            { label: t('cb.menuSetStartupScene'), onClick: () => void ProjectStore.setDefaultScene(path) },
            project?.packaging?.excludeScenes?.includes(path)
              ? { label: t('cb.menuIncludeInExport'), onClick: () => void ProjectStore.setSceneExcluded(path, false) }
              : { label: t('cb.menuExcludeFromExport'), onClick: () => void ProjectStore.setSceneExcluded(path, true) },
          ]
        : []),
      ...(isTexture
        ? [
            { label: t('cb.menuCreateSpriteAnim'), onClick: () => void createFlipbookFromTexture(path) },
            { label: t('cb.menuCreateTileset'), onClick: () => setNewTilesetFor(path) },
          ]
        : []),
      ...(isTileset
        ? [{ label: t('cb.menuCreateTilemap'), onClick: () => void createTilemapFromTileset(path) }]
        : []),
      ...(isAnimClip
        ? [{ label: t('cb.menuCreateAnimatedSprite'), onClick: () => void createAnimatedSpriteFromClip(path) }]
        : []),
      ...(isMaterial
        ? [{ label: t('cb.menuCreateMaterialInstance'), onClick: () => void createMaterialInstance(path) }]
        : []),
      // A folder's delivery mode (local / subpackage / remote-CDN) — writes
      // .esengine/asset-groups.json; the cook + Play realm read it via one resolver.
      ...(entry.isDir
        ? [{
            label: t('cb.delivery'),
            children: [
              ...ASSET_GROUP_MODES.map((m) => ({
                label: t(DELIVERY_MODE_META[m].labelKey),
                checked: ProjectStore.folderDeliveryMode(path) === m,
                onClick: () => void ProjectStore.setFolderDeliveryMode(path, m),
              })),
              { sep: true } as MenuItem,
              // A build cooks what it can REACH from the entry scenes; this is how
              // a folder says "ship me anyway" — for what only code names.
              {
                label: t('cb.alwaysInclude'),
                checked: ProjectStore.folderAlwaysInclude(path),
                onClick: () => void ProjectStore.setFolderAlwaysInclude(
                  path, !ProjectStore.folderAlwaysInclude(path)),
              },
            ],
          }]
        : []),
      { label: t('ui.rename'), onClick: () => startRename(path, !!ctx?.target?.inTree) },
      { label: t('cb.menuDuplicate'), onClick: () => void duplicate(path) },
      { sep: true },
      { label: t('cb.menuCopyPath'), onClick: () => copy(path, t('cb.copiedPath')) },
      ...(ref ? [{ label: t('cb.menuCopyReference'), onClick: () => copy(ref, t('cb.copiedReference')) }] : []),
      ...(entry.isDir ? [] : [{ label: t('cb.menuFindUsages'), onClick: () => setUsagesPath(path) }]),
      { label: t('cb.menuShowInExplorer'), onClick: () => void showInExplorer(path) },
      ...contributedContextRows('content/item', { path }),
      { sep: true },
      { label: t('ui.delete'), danger: true, onClick: () => void remove(selectedAssets.has(path) && selectedAssets.size > 1 ? [...selectedAssets] : [path]) },
    ];
  })();

  if (!project) {
    return (
      <div className="panel">
        <EmptyState icon={FolderOpen} title={t('cb.noProjectTitle')} hint={t('cb.openProjectPrompt')} />
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="cb-work">
        {/* ── Sources (left) ── */}
        <div className="cb-panel cb-src">
          <div className="phead cb-head">
            <span className="pt">{t('cb.sources')}</span>
          </div>
          <div className="cb-src-body" role="tree" aria-label={t('cb.folders')}>
            <div className="cb-sec">{t('cb.folders')}</div>
            <FolderNode path="" name={project.name} depth={0} cwd={cwd} onSelect={go} folderDrop={folderDrop} dropPath={dropFolder}
              onContext={(p, n, ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                setCtx({ x: ev.clientX, y: ev.clientY, target: { path: p, entry: { name: n, isDir: true }, inTree: true } });
              }}
              renaming={renameInTree ? renaming : null} onRename={(p) => startRename(p, true)}
              onCommitRename={(p, v) => void commitRename(p, v)} onCancelRename={() => setRenaming(null)} />
          </div>
        </div>

        {/* ── Main (center) ── */}
        <div className="cb-panel cb-main">
          <div className="phead cb-bar">
            <div className="cb-nav">
              <button type="button" disabled={!canBack} onClick={back} title={t('cb.back')}>
                <ArrowLeft size={15} strokeWidth={2} />
              </button>
              <button type="button" disabled={!canForward} onClick={forward} title={t('cb.forward')}>
                <ArrowRight size={15} strokeWidth={2} />
              </button>
              <button type="button" disabled={!canUp} onClick={up} title={t('cb.upOneLevel')}>
                <ArrowUp size={15} strokeWidth={2} />
              </button>
            </div>
            <div className="crumbs">
              {crumbs.map((c, i) => (
                <Fragment key={c.path}>
                  {i > 0 && <span className="sep">›</span>}
                  <button
                    type="button"
                    className={`cr${i === crumbs.length - 1 ? ' cur' : ''}`}
                    onClick={() => go(c.path)}
                  >
                    {c.name}
                  </button>
                </Fragment>
              ))}
            </div>
            <SearchField className="cb-search" placeholder={t('cb.searchPlaceholder')} value={query} onChange={setQuery} />
            <IconButton
              size="lg"
              variant="outline"
              title={t('cb.sortTitle', {
                current: t(sort === 'name' ? 'cb.sortName' : 'cb.sortType'),
                next: t(sort === 'name' ? 'cb.sortType' : 'cb.sortName'),
              })}
              onClick={() => setSort((s) => (s === 'name' ? 'type' : 'name'))}
            >
              <ArrowDownUp size={14} strokeWidth={2} />
            </IconButton>
            <Segmented
              value={view}
              onChange={setView}
              ariaLabel={t('cb.view')}
              options={[
                { value: 'grid', icon: <LayoutGrid size={13} strokeWidth={1.9} />, title: t('cb.gridView') },
                { value: 'list', icon: <List size={13} strokeWidth={1.9} />, title: t('cb.listView') },
              ]}
            />
            <IconButton size="lg" variant="outline" title={t('cb.menuNewFolder')} onClick={() => void newFolder()}>
              <FolderPlus size={13} strokeWidth={1.9} />
            </IconButton>
            {/* Discoverable create entry point — opens the same menu as right-click
                empty space, so making an asset isn't a hidden right-click-only action. */}
            <button
              type="button"
              className="cb-add"
              title={t('cb.newAssetTip')}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                tip.close();
                setCtx({ x: r.left, y: r.bottom + 4, target: null });
              }}
            >
              <Plus size={13} strokeWidth={1.9} /> {t('cb.newAsset')}
            </button>
            <button type="button" className="cb-add" title={t('cb.importAssets')} onClick={() => void importAssets()}>
              <Import size={13} strokeWidth={1.9} /> {t('cb.import')}
            </button>
          </div>

          <div className="cb-chips">
            <button
              type="button"
              className={`chip${filters.size === 0 ? ' on' : ''}`}
              onClick={() => setFilters(new Set())}
            >
              {t('cb.chipAll')}
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
            className={`cb-scroll${view === 'list' ? ' list' : ''}${fileDrop ? ' is-file-drop' : ''}`}
            ref={scrollRef}
            tabIndex={0}
            onKeyDown={onGridKey}
            onClick={(e) => {
              if (e.target === e.currentTarget) selectAsset(null);
            }}
            onDragEnter={onBodyDragEnter}
            onDragOver={onBodyDragOver}
            onDragLeave={onBodyDragLeave}
            onDrop={onBodyDrop}
            onContextMenu={(e) => {
              // Items stopPropagation, so reaching here = a right-click on empty space.
              e.preventDefault();
              tip.close();
              setCtx({ x: e.clientX, y: e.clientY, target: null });
            }}
          >
            {!listLoading && items.length === 0 ? (
              q ? (
                <EmptyState icon={Search} title={t('cb.noMatch')} />
              ) : (
                <EmptyState icon={Folder} title={t('cb.emptyFolderTitle')} hint={t('cb.emptyFolder')} />
              )
            ) : view === 'grid' ? (
              listLoading ? (
                <div className="cb-grid" style={{ ['--tile' as string]: `${tileSize}px` } as React.CSSProperties}>
                  {Array.from({ length: 8 }, (_, i) => (
                    <div key={i} className="asset is-skel" aria-hidden="true">
                      <div className="th skel" />
                      <div className="nm">
                        <span className="skel" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <VirtualGrid
                  items={items}
                  scrollRef={scrollRef}
                  tileSize={tileSize}
                  gap={GRID_GAP}
                  scrollToIndex={scrollTo.index}
                  scrollNonce={scrollTo.nonce}
                  onColumns={setGridColumns}
                  renderItem={(it) => {
                  const path = it.path;
                  const type: AssetType = it.isDir ? 'folder' : typeAt(path);
                  const isImg = !it.isDir && IMAGE_RE.test(it.name);
                  const deliv = it.isDir ? ProjectStore.folderDeliveryMode(path) : 'local';
                  return (
                    <div
                      key={path}
                      data-path={path}
                      className={`asset${it.isDir ? ' folder' : ''}${selectedAssets.has(path) ? ' sel' : ''}${it.isDir && dropFolder === path ? ' is-drop' : ''}${dragPath === path ? ' is-dragging' : ''}`}
                      // Files drag onto inspector asset fields / the viewport (assign / instantiate);
                      // folders are drop targets that move the dragged asset into them.
                      {...bindItem(path, it)}
                      {...(it.isDir ? folderDrop(path) : null)}
                    >
                      <div className="th">
                        {isImg ? (
                          // Deferred, because a folder is however many images the user put
                          // in it: this grid mounts a tile per entry, and a full-size decode
                          // per tile is how browsing an art dump costs hundreds of megabytes
                          // of image memory for the twenty thumbnails actually on screen.
                          <img src={`estella://project/${path}`} alt="" draggable={false} loading="lazy" decoding="async" />
                        ) : (
                          <AssetIcon type={type} size={30} />
                        )}
                        {!it.isDir && TYPE_CODE[type] && <span className="badge">{TYPE_CODE[type]}</span>}
                        {DELIVERY_MODE_META[deliv].badge && (
                          <span
                            className="badge"
                            style={{ background: DELIVERY_MODE_META[deliv].badge!.color, color: '#fff' }}
                            title={t(DELIVERY_MODE_META[deliv].labelKey)}
                          >
                            {t(DELIVERY_MODE_META[deliv].badge!.textKey)}
                          </span>
                        )}
                        {path === project?.defaultScene && (
                          <span className="badge start" title={t('cb.startupScene')}>
                            <Play size={9} strokeWidth={2.5} />
                          </span>
                        )}
                        {project?.packaging?.excludeScenes?.includes(path) && (
                          <span className="badge excluded" title={t('cb.excludedFromExport')}>
                            <EyeOff size={9} strokeWidth={2.5} />
                          </span>
                        )}
                      </div>
                      <div
                        className="nm"
                        style={it.isDir ? undefined : ({ ['--tc' as string]: assetTint(type) } as React.CSSProperties)}
                      >
                        {renaming === path && !renameInTree ? (
                          <RenameInput
                            name={it.name}
                            onCommit={(v) => void commitRename(path, v)}
                            onCancel={() => setRenaming(null)}
                          />
                        ) : (
                          <span>{it.name}</span>
                        )}
                      </div>
                    </div>
                  );
                  }}
                />
              )
            ) : (
              <div className="cb-list">
                <div className="lh">
                  <span>{t('cb.name')}</span>
                  <span>{t('cb.type')}</span>
                </div>
                {listLoading &&
                  Array.from({ length: 8 }, (_, i) => (
                    <div key={i} className="lr is-skel" aria-hidden="true">
                      <span className="ln">
                        <span className="skel" />
                      </span>
                      <span className="c">
                        <span className="skel" />
                      </span>
                    </div>
                  ))}
                {!listLoading && (
                  <VirtualGrid
                    items={items}
                    scrollRef={scrollRef}
                    columns={1}
                    tileSize={0}
                    gap={0}
                    estimatedRowHeight={LIST_ROW_H}
                    scrollToIndex={scrollTo.index}
                    scrollNonce={scrollTo.nonce}
                    renderItem={(it) => {
                  const path = it.path;
                  const type: AssetType = it.isDir ? 'folder' : typeAt(path);
                  return (
                    <div
                      key={path}
                      data-path={path}
                      className={`lr${selectedAssets.has(path) ? ' sel' : ''}${it.isDir && dropFolder === path ? ' is-drop' : ''}${dragPath === path ? ' is-dragging' : ''}`}
                      {...bindItem(path, it)}
                      {...(it.isDir ? folderDrop(path) : null)}
                    >
                      <span className="ln">
                        <AssetIcon type={type} size={15} />
                        {renaming === path && !renameInTree ? (
                          <RenameInput
                            name={it.name}
                            onCommit={(v) => void commitRename(path, v)}
                            onCancel={() => setRenaming(null)}
                          />
                        ) : (
                          <span className="t">{it.name}</span>
                        )}
                        {path === project?.defaultScene && (
                          <Play className="start-mark" size={11} strokeWidth={2.5} aria-label={t('cb.startupScene')} />
                        )}
                        {project?.packaging?.excludeScenes?.includes(path) && (
                          <EyeOff className="excluded-mark" size={11} strokeWidth={2.5} aria-label={t('cb.excludedFromExport')} />
                        )}
                      </span>
                      <span className="c">{it.isDir ? '' : TYPE_CODE[type] || type}</span>
                    </div>
                  );
                    }}
                  />
                )}
              </div>
            )}
          </div>

          <div className="cb-foot">
            <span>
              {t(selectedAssets.size > 0 ? 'cb.footItemsSelected' : 'cb.footItems', {
                count: items.length,
                sel: selectedAssets.size,
              })}
            </span>
            <span className="sp" />
            {view === 'grid' && (
              <input
                type="range"
                title={t('cb.thumbSize')}
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

      {!ctx && tip.card}
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems} onClose={() => setCtx(null)} />}
      {usagesPath && <FindUsagesDialog path={usagesPath} onClose={() => setUsagesPath(null)} />}
      {newTilesetFor && (
        <NewTilesetDialog
          textureUrl={`estella://project/${newTilesetFor}`}
          onCancel={() => setNewTilesetFor(null)}
          onConfirm={(grid) => { void createTilesetFromTexture(newTilesetFor, grid); setNewTilesetFor(null); }}
        />
      )}
      {confirmDel && (
        <ConfirmDialog
          title={t('cb.deleteTitle')}
          danger
          confirmLabel={t('ui.delete')}
          body={
            <>
              {confirmDel.paths.length === 1
                ? t('cb.deleteBody', { name: confirmDel.names[0] })
                : t('cb.deleteBodyMany', { count: confirmDel.paths.length })}
              {confirmDel.usages.length > 0 && (
                <>
                  {'\n\n' +
                    t(confirmDel.usages.length > 1 ? 'cb.deleteRefListMany' : 'cb.deleteRefListOne', {
                      count: confirmDel.usages.length,
                    })}
                  <ul className="cb-usages">
                    {confirmDel.usages.slice(0, 8).map((u) => (
                      <li key={u.path ?? ' unsaved'}>
                        <span className="n">{u.path ? baseName(u.path) : t('cb.unsavedScene')}</span>
                        {u.path && <span className="p">{u.path}</span>}
                        {u.unsaved && <span className="u">{t('cb.unsavedMark')}</span>}
                      </li>
                    ))}
                  </ul>
                  {confirmDel.usages.length > 8 &&
                    t('cb.usagesMore', { count: confirmDel.usages.length - 8 })}
                </>
              )}
            </>
          }
          onConfirm={() => void doRemove()}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  );
}
