import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../api.ts';
import { currentLang, LANGS, setLang, t, type Lang } from '../i18n.ts';
import type { AppConfig } from '../../shared/types.ts';

const models = () => [
  { value: '', label: t('Claude Code default', 'Как в Claude Code по умолчанию', 'Claude Code 默认') },
  { value: 'opus', label: t('Opus — deeper, slower', 'Opus — глубже, медленнее', 'Opus — 更深入，较慢') },
  { value: 'sonnet', label: t('Sonnet — faster', 'Sonnet — быстрее', 'Sonnet — 更快') },
  { value: 'fable', label: 'Fable' },
  { value: 'haiku', label: t('Haiku — fastest', 'Haiku — самый быстрый', 'Haiku — 最快') },
];
const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'];

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [skills, setSkills] = useState('');
  const [uiLang, setUiLang] = useState<Lang>(currentLang);
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
    // Other fields first: switching the language saves uiLang and reloads the page.
    const next = await api.saveConfig({ ...cfg, skills: skills.split('\n') });
    setCfg(next);
    setSaved(true);
    if (uiLang !== currentLang()) return setLang(uiLang);
    setTimeout(onClose, 500);
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{t('Settings', 'Настройки', '设置')}</h3>
          <button className="icon-btn ghost" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <label className="field">
          <span>{t('Interface language', 'Язык интерфейса', '界面语言')}</span>
          <select value={uiLang} onChange={(e) => setUiLang(e.target.value as Lang)}>
            {LANGS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('Model', 'Модель', '模型')}</span>
          <select value={cfg.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value })}>
            {models().map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('Effort', 'Усилие (effort)', '思考强度（effort）')}</span>
          <select value={cfg.effort} onChange={(e) => setCfg({ ...cfg, effort: e.target.value })}>
            {EFFORTS.map((m) => (
              <option key={m} value={m}>
                {m || t('default', 'по умолчанию', '默认')}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('Answer language', 'Язык ответов', '回答语言')}</span>
          <input
            value={cfg.language}
            placeholder={t('Same as interface', 'Как в интерфейсе', '与界面相同')}
            onChange={(e) => setCfg({ ...cfg, language: e.target.value })}
          />
        </label>
        <label className="field">
          <span>{t('Skills to run at session start (one per line)', 'Скиллы при старте сессии (по одному на строку)', '会话启动时运行的技能（每行一个）')}</span>
          <textarea rows={3} value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="/i-have-adhd:i-have-adhd" />
        </label>
        <p className="muted small">
          {t(
            'Model and effort apply the next time a session starts. Skills are sent once to each new paper session.',
            'Модель и effort применяются к новым запускам сессии. Скиллы отправляются один раз в каждую новую сессию статьи.',
            '模型和 effort 在下次启动会话时生效。技能会在每篇论文的新会话中发送一次。',
          )}
        </p>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            {t('Cancel', 'Отмена', '取消')}
          </button>
          <button className="btn primary" onClick={save}>
            {saved ? t('Saved', 'Сохранено', '已保存') : t('Save', 'Сохранить', '保存')}
          </button>
        </div>
      </div>
    </div>
  );
}
