import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import type { Attachment, ChatEvent, ChatMessage, SessionInfo, ToolUse } from '../../shared/types.ts';

export interface ChatState {
  messages: ChatMessage[];
  session: SessionInfo | null;
  partial: { text: string; tools: ToolUse[] } | null;
  connected: boolean;
  send(text: string, attachments?: Attachment[]): Promise<void>;
  interrupt(): void;
  reset(): Promise<void>;
  retry(messageId: string): void;
  /** bumps after every finished answer, e.g. to reload notes */
  answerTick: number;
}

function upsert(list: ChatMessage[], m: ChatMessage) {
  const i = list.findIndex((x) => x.id === m.id);
  if (i < 0) return [...list, m];
  const next = list.slice();
  next[i] = m;
  return next;
}

export function useChat(paperId: string): ChatState {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [partial, setPartial] = useState<ChatState['partial']>(null);
  const [connected, setConnected] = useState(false);
  const [answerTick, setAnswerTick] = useState(0);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    let alive = true;
    const sync = () =>
      api.chat(paperId).then(({ messages, session }) => {
        if (!alive) return;
        setMessages(messages);
        setSession(session);
      });
    sync();
    const es = new EventSource(`/api/papers/${paperId}/events`);
    let wasOpen = false;
    es.onopen = () => {
      setConnected(true);
      if (wasOpen) sync();
      wasOpen = true;
    };
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data) as ChatEvent;
      switch (ev.type) {
        case 'status':
          setSession(ev.session);
          if (ev.session.status !== 'busy') setPartial(null);
          break;
        case 'message':
          setMessages((list) => upsert(list, ev.message));
          if (ev.message.role === 'assistant') {
            setPartial(null);
            setAnswerTick((t) => t + 1);
          }
          break;
        case 'partial':
          setPartial({ text: ev.text, tools: ev.tools });
          break;
        case 'removed':
          setMessages((list) => list.filter((m) => m.id !== ev.id));
          break;
        case 'reset':
          setMessages([]);
          setPartial(null);
          break;
      }
    };
    return () => {
      alive = false;
      es.close();
    };
  }, [paperId]);

  const send = useCallback(
    async (text: string, attachments: Attachment[] = []) => {
      const m = await api.sendChat(paperId, text, attachments);
      setMessages((list) => upsert(list, m));
    },
    [paperId],
  );

  const interrupt = useCallback(() => {
    api.interrupt(paperId);
  }, [paperId]);

  const reset = useCallback(async () => {
    await api.resetChat(paperId);
    setMessages([]);
  }, [paperId]);

  const retry = useCallback(
    (messageId: string) => {
      api.retry(paperId, messageId);
    },
    [paperId],
  );

  return { messages, session, partial, connected, send, interrupt, reset, retry, answerTick };
}
