import { X } from 'lucide-react';

const GROUPS: [string, [string, string][]][] = [
  [
    'Чтение',
    [
      ['⌘K', 'Открыть другую статью / вставить ссылку'],
      ['⌘F', 'Поиск по статье'],
      ['⌘+ ⌘− ⌘0', 'Масштаб, 0 — по ширине'],
      ['S', 'Вырезать область скриншотом'],
      ['Esc', 'Закрыть меню и режимы'],
    ],
  ],
  [
    'Выделенный фрагмент',
    [
      ['A', 'Добавить в вопрос'],
      ['E', 'Сразу попросить объяснить'],
    ],
  ],
  [
    'Чат',
    [
      ['/', 'Перейти к полю вопроса'],
      ['Enter', 'Отправить'],
      ['Shift+Enter', 'Новая строка'],
      ['⌘V', 'Вставить картинку из буфера'],
    ],
  ],
];

export function ShortcutsHelp({ onClose }: { onClose(): void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal shortcuts" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Горячие клавиши</h3>
          <button className="icon-btn ghost" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {GROUPS.map(([title, rows]) => (
          <section key={title}>
            <h4>{title}</h4>
            {rows.map(([k, label]) => (
              <div key={k} className="shortcut-row">
                <span>{label}</span>
                <kbd>{k}</kbd>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
