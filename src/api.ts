import type { AppConfig, ChatMessage, Health, Highlight, PaperMeta, SessionInfo } from '../shared/types.ts';

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `Ошибка ${res.status}`);
  return body as T;
}

const send = (method: string, body?: unknown) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const api = {
  papers: () => fetch('/api/papers').then((r) => json<PaperMeta[]>(r)),
  paper: (id: string) => fetch(`/api/papers/${id}`).then((r) => json<PaperMeta>(r)),
  updatePaper: (id: string, patch: Omit<Partial<PaperMeta>, 'openedAt'> & { openedAt?: boolean }) =>
    fetch(`/api/papers/${id}`, send('PATCH', patch)).then((r) => json<PaperMeta>(r)),
  deletePaper: (id: string) => fetch(`/api/papers/${id}`, send('DELETE')).then((r) => json(r)),
  upload: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch('/api/papers/upload', { method: 'POST', body: fd }).then((r) => json<PaperMeta>(r));
  },
  importUrl: (url: string) => fetch('/api/papers/url', send('POST', { url })).then((r) => json<PaperMeta>(r)),

  highlights: (id: string) => fetch(`/api/papers/${id}/highlights`).then((r) => json<Highlight[]>(r)),
  addHighlight: (id: string, h: Omit<Highlight, 'id' | 'createdAt'>) =>
    fetch(`/api/papers/${id}/highlights`, send('POST', h)).then((r) => json<Highlight>(r)),
  updateHighlight: (id: string, hid: string, patch: Partial<Highlight>) =>
    fetch(`/api/papers/${id}/highlights/${hid}`, send('PATCH', patch)).then((r) => json<Highlight>(r)),
  deleteHighlight: (id: string, hid: string) => fetch(`/api/papers/${id}/highlights/${hid}`, send('DELETE')).then((r) => json(r)),

  chat: (id: string) => fetch(`/api/papers/${id}/chat`).then((r) => json<{ messages: ChatMessage[]; session: SessionInfo }>(r)),
  sendChat: (id: string, text: string, attachments: ChatMessage['attachments']) =>
    fetch(`/api/papers/${id}/chat`, send('POST', { text, attachments })).then((r) => json<ChatMessage>(r)),
  retry: (id: string, messageId: string) => fetch(`/api/papers/${id}/chat/retry`, send('POST', { messageId })).then((r) => json(r)),
  health: () => fetch('/api/health').then((r) => json<Health>(r)),
  interrupt: (id: string) => fetch(`/api/papers/${id}/chat/interrupt`, send('POST')).then((r) => json(r)),
  resetChat: (id: string) => fetch(`/api/papers/${id}/chat/reset`, send('POST')).then((r) => json(r)),
  startSession: (id: string) => fetch(`/api/papers/${id}/session/start`, send('POST')).then((r) => json<SessionInfo>(r)),
  notes: (id: string) => fetch(`/api/papers/${id}/files/notes.md`).then((r) => (r.status === 200 ? r.text() : '')),

  config: () => fetch('/api/config').then((r) => json<AppConfig>(r)),
  saveConfig: (patch: Partial<AppConfig>) => fetch('/api/config', send('PUT', patch)).then((r) => json<AppConfig>(r)),
};

export const fileUrl = (id: string, rel: string) => `/api/papers/${id}/files/${rel}`;
