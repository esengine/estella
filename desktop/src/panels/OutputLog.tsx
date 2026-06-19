import { Trash2, Filter, ArrowDownToLine } from 'lucide-react';
import { MOCK_LOG } from '@/mock/sceneData';

export function OutputLog() {
  return (
    <div className="panel log">
      <div className="panel__toolbar">
        <div className="log__filters">
          <button type="button" className="pill is-active">All</button>
          <button type="button" className="pill"><i className="dot dot--info" />Info</button>
          <button type="button" className="pill"><i className="dot dot--warn" />Warnings</button>
          <button type="button" className="pill"><i className="dot dot--error" />Errors</button>
        </div>
        <div className="log__tools">
          <button type="button" className="iconbtn" title="Filter source"><Filter size={14} strokeWidth={1.85} /></button>
          <button type="button" className="iconbtn" title="Scroll to bottom"><ArrowDownToLine size={14} strokeWidth={1.85} /></button>
          <button type="button" className="iconbtn" title="Clear log"><Trash2 size={14} strokeWidth={1.85} /></button>
        </div>
      </div>

      <div className="panel__body log__body mono">
        {MOCK_LOG.map((e) => (
          <div key={e.id} className={`logline logline--${e.level}`}>
            <span className="logline__time">{e.time}</span>
            <span className="logline__source">{e.source}</span>
            <span className="logline__msg">{e.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
