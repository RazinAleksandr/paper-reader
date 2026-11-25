import { t } from './i18n.ts';

export interface QuickAction {
  id: string;
  label: string;
  prompt: string;
  hint?: string;
}

/** One-click questions about a selected fragment or screenshot. */
export const fragmentActions = (): QuickAction[] => [
  {
    id: 'explain',
    label: t('Explain', 'Объясни', '解释'),
    prompt: t(
      'Explain this passage in plain words: what it says and why it is in the paper.',
      'Объясни этот фрагмент простыми словами: что здесь сказано и зачем это в статье.',
      '用通俗的话解释这段内容：它在说什么，为什么会出现在这篇论文里。',
    ),
    hint: 'E',
  },
  {
    id: 'parts',
    label: t('Break down', 'Разбери', '拆解'),
    prompt: t(
      'Break it down piece by piece: what each symbol, term or element means, and the intuition behind it.',
      'Разбери по частям: что означает каждый символ, термин или элемент, и какая за этим интуиция.',
      '逐项拆解：每个符号、术语或组成部分分别是什么意思，背后的直觉是什么。',
    ),
  },
  {
    id: 'example',
    label: t('Example', 'Пример', '举例'),
    prompt: t(
      'Give me a concrete example — with numbers or from everyday life — so that this becomes clear.',
      'Приведи конкретный пример — с числами или из жизни, — чтобы это стало понятно.',
      '举一个具体的例子（用数字，或者用生活中的场景），帮我把它弄明白。',
    ),
  },
];

/** Starters for an empty chat. */
export const starters = (): QuickAction[] => [
  {
    id: 'map',
    label: t('Map of the paper: what it is about and what to read first', 'Карта статьи: о чём она и что читать первым', '论文导读：讲了什么，先读哪里'),
    prompt: t(
      'Give me a map of the paper: what problem it solves, the main idea in two sentences, what parts the paper consists of, what to read first and what can be skipped.',
      'Дай карту статьи: какую проблему решают, главная идея в двух предложениях, из каких частей состоит статья, что читать в первую очередь, а что можно пропустить.',
      '给我一份这篇论文的导读：它要解决什么问题，用两句话概括核心思想，论文由哪几部分组成，哪些部分应该先读，哪些可以跳过。',
    ),
  },
  {
    id: 'prereq',
    label: t('What to know before reading it', 'Что нужно знать заранее, чтобы её понять', '读懂它需要哪些预备知识'),
    prompt: t(
      'What concepts do I need to know to understand this paper? List them from most to least important, with a 1–2 line explanation for each.',
      'Какие понятия нужно знать, чтобы понять эту статью? Список от самого важного; к каждому — объяснение в 1–2 строки.',
      '要读懂这篇论文，需要先了解哪些概念？按重要程度从高到低列出，每个概念用一两句话解释。',
    ),
  },
  {
    id: 'simple',
    label: t('The main idea in plain words', 'Главная идея простыми словами', '用大白话讲核心思想'),
    prompt: t(
      "Explain the paper's main idea as if I were a smart high school student. Use an analogy from everyday life.",
      'Объясни главную идею статьи так, будто я умный школьник. С аналогией из жизни.',
      '把这篇论文的核心思想讲给我听，就当我是一个聪明的高中生。用一个生活中的类比。',
    ),
  },
  {
    id: 'results',
    label: t('What the authors found and where it is weak', 'Что получили авторы и где слабые места', '作者得出了什么，有哪些不足'),
    prompt: t(
      'What did the authors achieve or prove? Key numbers, what they compared against and how good it is. Where are the weak spots?',
      'Что авторы получили или доказали? Ключевые цифры, с чем сравнивали и насколько это хорошо. Где слабые места?',
      '作者得到了什么结果，或者证明了什么？给出关键数字、和什么做了比较、效果到底有多好。有哪些薄弱之处？',
    ),
  },
];

export const notesPrompt = () =>
  t(
    "Create or update the notes for this paper in its notes.md file: the main idea, key concepts with simple definitions, how the method works, the results, and what I've asked while reading (briefly, with links to pages). Keep it short, in bullet points.",
    'Создай или обнови конспект в файле notes.md этой статьи: главная идея, ключевые понятия с простыми определениями, как устроен метод, результаты, и что я уже спрашивал по ходу чтения (коротко, со ссылками на страницы). Пиши кратко, по пунктам.',
    '在这篇论文的 notes.md 文件里创建或更新笔记：核心思想、关键概念及简明定义、方法是怎样运作的、结果，以及我在阅读过程中问过的问题（简要列出，并附上页码链接）。写得简洁些，用要点列出。',
  );
