import type { Workflow } from '../types';
import { StatusBadge } from './StatusBadge';

interface Props {
  workflows: Workflow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function WorkflowList({ workflows, selectedId, onSelect }: Props) {
  if (!workflows.length) {
    return <div className="muted padded">No workflows yet. Start one on the right.</div>;
  }

  return (
    <ul className="workflow-list">
      {workflows.map((w) => {
        const done = w.steps.filter((s) => s.status === 'completed').length;
        return (
          <li
            key={w.id}
            className={`workflow-list-item ${w.id === selectedId ? 'selected' : ''}`}
            onClick={() => onSelect(w.id)}
          >
            <div className="workflow-list-row">
              <span className="workflow-list-name">{w.name}</span>
              <StatusBadge status={w.status} />
            </div>
            <div className="muted small">
              {done}/{w.steps.length} steps · {new Date(w.createdAt).toLocaleString()}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
