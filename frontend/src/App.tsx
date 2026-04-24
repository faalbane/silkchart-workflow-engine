import { useEffect, useState } from 'react';
import { api } from './api';
import { usePolling } from './hooks/usePolling';
import { WorkflowList } from './components/WorkflowList';
import { WorkflowDetail } from './components/WorkflowDetail';
import { StartWorkflowForm } from './components/StartWorkflowForm';
import type { Workflow } from './types';

export default function App() {
  const { data, error, refetch } = usePolling<Workflow[]>(() => api.list(), 2000, []);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && data && data.length) {
      setSelectedId(data[0].id);
    }
  }, [data, selectedId]);

  const handleCreated = (id: string) => {
    setSelectedId(id);
    refetch();
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>SilkChart Workflows</h1>
        <span className="muted small">
          Durable step execution · resumes automatically after a crash
        </span>
      </header>

      <main className="app-main">
        <aside className="app-sidebar">
          <StartWorkflowForm onCreated={handleCreated} />
          <div className="sidebar-divider" />
          <h3 className="sidebar-title">Recent</h3>
          {error ? (
            <div className="padded error">{error}</div>
          ) : (
            <WorkflowList
              workflows={data ?? []}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}
        </aside>

        <section className="app-detail">
          {selectedId ? (
            <WorkflowDetail id={selectedId} />
          ) : (
            <div className="padded muted">Select or start a workflow to view its steps.</div>
          )}
        </section>
      </main>
    </div>
  );
}
