import { Link, useNavigate } from 'react-router-dom';
import { Library, Loader2, Plus, X } from 'lucide-react';
import { tabStore, useActivity, usePapers, useTabs } from '../workspace.ts';
import { t } from '../i18n.ts';

/** Open papers as tabs; a dot shows where Claude is answering or has a new answer. */
export function TabBar({ current, onNew }: { current: string; onNew(): void }) {
  const tabs = useTabs();
  const papers = usePapers();
  const activity = useActivity();
  const navigate = useNavigate();
  const byId = new Map(papers.map((p) => [p.id, p]));

  const close = (id: string) => {
    const next = tabStore.close(id);
    if (id === current) navigate(next ? `/paper/${next}` : '/');
  };

  return (
    <div className="tabbar">
      <Link to="/" className="tab-home" title={t('Library', 'Библиотека', '论文库')}>
        <Library size={15} />
      </Link>
      <div className="tabs">
        {tabs.map((id) => {
          const p = byId.get(id);
          const busy = activity.status[id] === 'busy' || activity.status[id] === 'starting';
          const unread = activity.unread.has(id);
          return (
            <div
              key={id}
              className={`tab ${id === current ? 'on' : ''}`}
              onClick={() => id !== current && navigate(`/paper/${id}`)}
              onAuxClick={(e) => e.button === 1 && close(id)}
              title={p?.title}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('text/x-tab', id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const moved = e.dataTransfer.getData('text/x-tab');
                if (moved) tabStore.move(moved, tabs.indexOf(id));
              }}
            >
              {busy ? <Loader2 size={12} className="spin tab-state" /> : unread ? <span className="tab-unread" title={t('New answer from Claude', 'Новый ответ Claude', 'Claude 有新回答')} /> : null}
              <span className="tab-title">{p?.title || '…'}</span>
              <button
                className="tab-close"
                title={t('Close tab', 'Закрыть вкладку', '关闭标签页')}
                onClick={(e) => {
                  e.stopPropagation();
                  close(id);
                }}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
        <button className="tab-new" title={t('Open paper (⌘K)', 'Открыть статью (⌘K)', '打开论文（⌘K）')} onClick={onNew}>
          <Plus size={15} />
        </button>
      </div>
    </div>
  );
}
