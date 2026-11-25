import { X } from 'lucide-react';
import { t } from '../i18n.ts';

const groups = (): [string, [string, string][]][] => [
  [
    t('Reading', 'Чтение', '阅读'),
    [
      ['⌘K', t('Open another paper or paste a link', 'Открыть другую статью / вставить ссылку', '打开其他论文 / 粘贴链接')],
      ['⌘F', t('Find in paper', 'Поиск по статье', '在论文中查找')],
      ['⌘+ ⌘− ⌘0', t('Zoom; 0 fits to width', 'Масштаб, 0 — по ширине', '缩放，0 为适应宽度')],
      ['S', t('Capture an area as a screenshot', 'Вырезать область скриншотом', '截取区域')],
      ['Esc', t('Close menus and modes', 'Закрыть меню и режимы', '关闭菜单和模式')],
    ],
  ],
  [
    t('Selected fragment', 'Выделенный фрагмент', '选中的内容'),
    [
      ['A', t('Add to question', 'Добавить в вопрос', '加入提问')],
      ['E', t('Ask for an explanation right away', 'Сразу попросить объяснить', '直接请求解释')],
    ],
  ],
  [
    t('Chat', 'Чат', '对话'),
    [
      ['/', t('Go to the question box', 'Перейти к полю вопроса', '跳到提问框')],
      ['Enter', t('Send', 'Отправить', '发送')],
      ['Shift+Enter', t('New line', 'Новая строка', '换行')],
      ['⌘V', t('Paste an image from the clipboard', 'Вставить картинку из буфера', '从剪贴板粘贴图片')],
    ],
  ],
];

export function ShortcutsHelp({ onClose }: { onClose(): void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal shortcuts" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{t('Keyboard shortcuts', 'Горячие клавиши', '快捷键')}</h3>
          <button className="icon-btn ghost" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {groups().map(([title, rows]) => (
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
