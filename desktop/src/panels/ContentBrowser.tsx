import { useState } from 'react';
import { ChevronRight, Search, Plus, LayoutGrid, Import } from 'lucide-react';
import { MOCK_ASSETS } from '@/mock/sceneData';
import { AssetIcon } from '@/components/icons';

const FOLDERS = ['Content', 'scenes', 'sprites', 'audio', 'scripts', 'prefabs'];

export function ContentBrowser() {
  const [active, setActive] = useState('Content');

  return (
    <div className="panel content">
      <div className="panel__toolbar">
        <button type="button" className="btn-soft">
          <Import size={13} strokeWidth={1.85} /> Import
        </button>
        <button type="button" className="btn-soft">
          <Plus size={13} strokeWidth={1.85} /> Add
        </button>
        <div className="searchbox searchbox--grow">
          <Search size={13} strokeWidth={1.85} />
          <input className="searchbox__input" placeholder="Search assets" spellCheck={false} />
        </div>
        <button type="button" className="iconbtn" title="View options">
          <LayoutGrid size={15} strokeWidth={1.85} />
        </button>
      </div>

      <div className="content__split">
        {/* Source tree */}
        <div className="content__tree">
          {FOLDERS.map((f, i) => (
            <div
              key={f}
              className={`content__folder${active === f ? ' is-active' : ''}`}
              style={{ paddingLeft: (i === 0 ? 0 : 14) + 8 }}
              onClick={() => setActive(f)}
            >
              <ChevronRight
                size={12}
                strokeWidth={2}
                className={`content__folder-twist${i === 0 ? ' is-open' : ''}`}
                style={{ opacity: i === 0 ? 1 : 0 }}
              />
              <AssetIcon type="folder" size={14} />
              <span>{f}</span>
            </div>
          ))}
        </div>

        {/* Asset grid */}
        <div className="content__grid">
          {MOCK_ASSETS.map((a) => (
            <button key={a.id} type="button" className="tile">
              <span className="tile__thumb">
                <AssetIcon type={a.type} />
              </span>
              <span className="tile__name">{a.name}</span>
              <span className="tile__type">{a.type}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="content__path mono">/Content · 14 items</div>
    </div>
  );
}
