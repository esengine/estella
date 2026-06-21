// Far-left icon rail (activity bar). Reveals docked panels and toggles the
// Content Drawer — the summoned quick-access surface.
import { ListTree, SlidersHorizontal, FolderOpen, Terminal, Settings } from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { dockApi } from '@/layout/dockApi';
import { commands } from '@/commands';

export function ActivityBar() {
  const contentDrawer = useEditorStore((s) => s.contentDrawer);
  const toggleContentDrawer = useEditorStore((s) => s.toggleContentDrawer);

  return (
    <div className="activity">
      <button
        type="button"
        className="act"
        title="Toggle right dock"
        onClick={() => dockApi.toggleCollapse('outliner', 'width')}
      >
        <ListTree size={19} strokeWidth={1.7} />
      </button>
      <button type="button" className="act" title="Details" onClick={() => dockApi.reveal('details')}>
        <SlidersHorizontal size={19} strokeWidth={1.7} />
      </button>
      <button
        type="button"
        className={`act${contentDrawer ? ' active' : ''}`}
        title="Content Drawer  (Ctrl+Space)"
        onClick={toggleContentDrawer}
      >
        <FolderOpen size={19} strokeWidth={1.7} />
      </button>
      <button type="button" className="act" title="Output Log" onClick={() => dockApi.reveal('log')}>
        <Terminal size={19} strokeWidth={1.7} />
      </button>

      <span className="act-spacer" />

      <button
        type="button"
        className="act"
        title="Settings  (Ctrl+,)"
        onClick={() => commands.run('settings.open')}
      >
        <Settings size={19} strokeWidth={1.7} />
      </button>
    </div>
  );
}
