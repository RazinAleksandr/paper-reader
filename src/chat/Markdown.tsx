import { memo, useEffect, useId, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';

/**
 * Claude often writes \( \) and \[ \]; remark-math wants $ and $$. Code (fenced, ~~~, inline,
 * and an unfinished fence while streaming) is left alone, and "$5" prices stay text.
 */
export function normalizeMath(src: string): string {
  return src
    .split(/(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/g)
    .map((part, i) =>
      i % 2
        ? part
        : part
            .replace(/(^|[\s(«"])\$(\d[\d.,]*)(?=[\s.,;:!?)»"]|$)/gm, '$1\\$$$2')
            .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `$$${m.trim().replace(/\s*\n\s*/g, ' ')}$$`)
            .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m.trim()}$`)
            // a lone $$…$$ line is meant as a display formula; keep the indent so lists stay intact
            .replace(/^([ \t]*)\$\$([^\n]+?)\$\$[ \t]*$/gm, (_, indent, m) => `${indent}$$\n${indent}${m.trim()}\n${indent}$$`),
    )
    .join('');
}

function Mermaid({ code }: { code: string }) {
  const id = useId().replace(/[^a-z0-9]/gi, '');
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    import('mermaid').then(async ({ default: mermaid }) => {
      const dark = document.documentElement.dataset.theme === 'dark';
      mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'neutral', securityLevel: 'strict', fontFamily: 'inherit' });
      try {
        const { svg } = await mermaid.render(`m${id}`, code);
        if (alive) setSvg(svg);
      } catch {
        if (alive) setFailed(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [code, id]);
  if (failed || !svg) return <pre className="mermaid-src">{code}</pre>;
  return <div className="mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
}

interface Props {
  text: string;
  streaming?: boolean;
  onPage?(page: number): void;
}

export const Markdown = memo(function Markdown({ text, streaming, onPage }: Props) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }], [rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={{
          a({ href, children }) {
            const m = href?.match(/^#page=(\d+)/);
            if (m)
              return (
                <button className="page-link" onClick={() => onPage?.(Number(m[1]))}>
                  {children}
                </button>
              );
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
          code({ className, children, ...rest }) {
            if (/language-mermaid/.test(className || '') && !streaming) return <Mermaid code={String(children).trim()} />;
            return (
              <code className={className} {...rest}>
                {children}
              </code>
            );
          },
        }}
      >
        {normalizeMath(text)}
      </ReactMarkdown>
    </div>
  );
});
