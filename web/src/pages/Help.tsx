import { useQuery } from '@tanstack/react-query';
import { BookOpen, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ErrorBox, PageHeader } from '../components/ui';
import { get } from '../lib/api';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s: string) {
  let out = esc(s);
  const codes: string[] = [];
  out = out.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(`<code>${c}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => {
      const safe = /^(https?:|#|\/|[\w.-]+\.md)/i.test(u) ? u : '#';
      const md = /^[\w.-]+\.md$/i.test(safe.replace(/^docs\//, '')) ? `?doc=${safe.replace(/^docs\//, '')}` : safe;
      return `<a href="${md}" ${/^https?:/.test(safe) ? 'target="_blank" rel="noreferrer"' : ''}>${t}</a>`;
    });
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

/** Small Markdown renderer for our own docs: headings, lists, tables, code, quotes. Escapes all HTML. */
export function renderMarkdown(md: string) {
  const lines = md.replace(/\r/g, '').split('\n');
  const html: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      html.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const id = h[2].toLowerCase().replace(/[^a-z0-9]+/g, '-');
      html.push(`<h${h[1].length + 1} id="${id}">${inline(h[2])}</h${h[1].length + 1}>`);
      i++;
      continue;
    }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      html.push('<hr/>');
      i++;
      continue;
    }
    if (/^\|/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        if (!/^\|[\s:|-]+\|?\s*$/.test(lines[i])) {
          // Split on | but not on an escaped \| (used inside cells).
          const cells = lines[i].trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/);
          rows.push(cells.map((c) => c.trim().replace(/\\\|/g, '|')));
        }
        i++;
      }
      const [head, ...body] = rows;
      html.push(
        `<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table></div>`,
      );
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      html.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items: { depth: number; ordered: boolean; text: string }[] = [];
      while (i < lines.length && (/^\s*([-*]|\d+\.)\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (m) items.push({ depth: Math.floor(m[1].length / 2), ordered: /\d/.test(m[2]), text: m[3] });
        else items[items.length - 1].text += ' ' + lines[i].trim();
        i++;
      }
      const tag = items[0].ordered ? 'ol' : 'ul';
      html.push(`<${tag}>${items.map((it) => `<li style="margin-left:${it.depth * 18}px">${inline(it.text)}</li>`).join('')}</${tag}>`);
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\||>|\s*([-*]|\d+\.)\s)/.test(lines[i])) buf.push(lines[i++]);
    html.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return html.join('\n');
}

export function HelpPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['docs'], queryFn: () => get<{ file: string; title: string }[]>('/api/docs'), staleTime: 300_000 });
  const file = params.get('doc') ?? list.data?.[0]?.file ?? '';
  const doc = useQuery({ queryKey: ['docs', file], queryFn: () => get<{ text: string }>(`/api/docs/${encodeURIComponent(file)}`), enabled: !!file, staleTime: 300_000 });
  const all = useQuery({
    queryKey: ['docs', 'all'],
    queryFn: async () => Promise.all((list.data ?? []).map(async (d) => ({ ...d, text: (await get<{ text: string }>(`/api/docs/${encodeURIComponent(d.file)}`)).text }))),
    enabled: q.trim().length >= 3 && !!list.data,
    staleTime: 300_000,
  });
  const hits = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (term.length < 3 || !all.data) return [];
    return all.data
      .map((d) => {
        const lines = d.text.split('\n').filter((l) => l.toLowerCase().includes(term));
        return { ...d, lines: lines.slice(0, 3), count: lines.length };
      })
      .filter((d) => d.count)
      .sort((a, b) => b.count - a.count);
  }, [q, all.data]);
  return (
    <>
      <PageHeader title="Help & setup guides" subtitle="Every setup step and error message, searchable. The same files are in the docs folder of the project." />
      <ErrorBox error={list.error || doc.error} />
      <div className="grid help-grid">
        <div className="card help-side">
          <div className="card-pad" style={{ paddingBottom: 8 }}>
            <div style={{ position: 'relative' }}>
              <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-dim)' }} />
              <input className="input" style={{ paddingLeft: 32 }} placeholder="Search an error or topic…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          <div className="list">
            {q.trim().length >= 3
              ? hits.map((d) => (
                  <button key={d.file} className="list-item" style={{ background: 'none', border: 0, borderBottom: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left', flexDirection: 'column', alignItems: 'flex-start' }} onClick={() => (setParams({ doc: d.file }), setQ(''))}>
                    <strong>{d.title}</strong>
                    {d.lines.map((l, i) => (
                      <span key={i} className="dim" style={{ fontSize: 12 }}>
                        {l.replace(/[#*`|>]/g, '').trim().slice(0, 90)}
                      </span>
                    ))}
                  </button>
                ))
              : (list.data ?? []).map((d) => (
                  <button
                    key={d.file}
                    className={`nav-link ${d.file === file ? 'active' : ''}`}
                    style={{ border: 0, background: d.file === file ? undefined : 'none', cursor: 'pointer', textAlign: 'left', borderRadius: 0 }}
                    onClick={() => setParams({ doc: d.file })}
                  >
                    <BookOpen size={15} style={{ flex: 'none' }} /> {d.title}
                  </button>
                ))}
            {q.trim().length >= 3 && all.data && hits.length === 0 && <div className="empty-inline">Nothing found for “{q}”</div>}
          </div>
        </div>
        <article className="card card-pad doc" dangerouslySetInnerHTML={{ __html: doc.data ? renderMarkdown(doc.data.text) : '<p class="muted">Loading…</p>' }} />
      </div>
    </>
  );
}
