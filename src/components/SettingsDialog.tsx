import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../api.ts';
import type { AppConfig } from '../../shared/types.ts';

const MODELS = [
  { value: '', label: 'Как в Claude Code по умолчанию' },
  { value: 'opus', label: 'Opus — глубже, медленнее' },
  { value: 'sonnet', label: 'Sonnet — быстрее' },
  { value: 'fable', label: 'Fable' },
  { value: 'haiku', label: 'Haiku — самый быстрый' },
];
const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'];

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [skills, setSkills] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.config().then((c) => {
      setCfg(c);
      setSkills(c.skills.join('\n'));
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!cfg) return null;

  const save = async () => {
    const next = await api.saveConfig({ ...cfg, skills: skills.split('\n') });
    setCfg(next);
    setSaved(true);
    setTimeout(onClose, 500);
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Настройки Claude</h3>
          <button className="icon-btn ghost" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <label className="field">
          <span>Модель</span>
          <select value={cfg.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value })}>
            {MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Усилие (effort)</span>
          <select value={cfg.effort} onChange={(e) => setCfg({ ...cfg, effort: e.target.value })}>
            {EFFORTS.map((m) => (
              <option key={m} value={m}>
                {m || 'по умолчанию'}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Язык ответов</span>
          <input value={cfg.language} onChange={(e) => setCfg({ ...cfg, language: e.target.value })} />
        </label>
        <label className="field">
          <span>Скиллы при старте сессии (по одному на строку)</span>
          <textarea rows={3} value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="/i-have-adhd:i-have-adhd" />
        </label>
        <p className="muted small">
          Модель и effort применяются к новым запускам сессии. Скиллы отправляются один раз в каждую новую сессию статьи.
        </p>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn primary" onClick={save}>
            {saved ? 'Сохранено' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
}
