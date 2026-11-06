import { useEffect, useSyncExternalStore } from 'react';
import { api } from './api.ts';
import type { GlobalEvent, PaperMeta, SessionStatus } from '../shared/types.ts';

// ── Open tabs: ids of papers, persisted across reloads ──

const TABS_KEY = 'pr-tabs';
let tabs: string[] = (() => {
  try {
    return JSON.parse(localStorage.getItem(TABS_KEY) || '[]');
  } catch {
    return [];
  }
})();
const tabListeners = new Set<() => void>();

function setTabs(next: string[]) {
  tabs = next;
  localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
  tabListeners.forEach((fn) => fn());
}

export const tabStore = {
  open(id: string) {
    if (!tabs.includes(id)) setTabs([...tabs, id]);
  },
  /** returns the tab to show instead, if any */
  close(id: string): string | null {
    const i = tabs.indexOf(id);
    const next = tabs.filter((t) => t !== id);
    setTabs(next);
    return next[Math.min(i, next.length - 1)] ?? null;
  },
  prune(existing: Set<string>) {
    const next = tabs.filter((t) => existing.has(t));
    if (next.length !== tabs.length) setTabs(next);
  },
  move(id: string, to: number) {
    const next = tabs.filter((t) => t !== id);
    next.splice(to, 0, id);
    setTabs(next);
  },
};

export function useTabs(): string[] {
  return useSyncExternalStore(
    (fn) => {
      tabListeners.add(fn);
      return () => tabListeners.delete(fn);
    },
    () => tabs,
  );
}

// ── Library list, shared by tabs and the quick switcher ──

let papers: PaperMeta[] = [];
const paperListeners = new Set<() => void>();
export function refreshPapers() {
  return api.papers().then((list) => {
    papers = list;
    tabStore.prune(new Set(list.map((p) => p.id)));
    paperListeners.forEach((fn) => fn());
    return list;
  });
}
export function usePapers(): PaperMeta[] {
  const list = useSyncExternalStore(
    (fn) => {
      paperListeners.add(fn);
      return () => paperListeners.delete(fn);
    },
    () => papers,
  );
  useEffect(() => {
    if (!papers.length) refreshPapers().catch(() => {});
  }, []);
  return list;
}

// ── Claude activity across all papers ──

interface Activity {
  status: Record<string, SessionStatus>;
  /** papers with an answer the reader has not looked at yet */
  unread: Set<string>;
}

let activity: Activity = { status: {}, unread: new Set() };
let activePaper: string | null = null;
const activityListeners = new Set<() => void>();
const emitActivity = () => activityListeners.forEach((fn) => fn());
let source: EventSource | null = null;

function connect() {
  if (source) return;
  source = new EventSource('/api/events');
  source.onmessage = (e) => {
    const ev = JSON.parse(e.data) as GlobalEvent;
    if (ev.type === 'status') activity = { ...activity, status: { ...activity.status, [ev.paperId]: ev.status } };
    else if (ev.type === 'answer' && ev.paperId !== activePaper) activity = { ...activity, unread: new Set(activity.unread).add(ev.paperId) };
    emitActivity();
  };
}

export function setActivePaper(id: string | null) {
  activePaper = id;
  if (id && activity.unread.has(id)) {
    const unread = new Set(activity.unread);
    unread.delete(id);
    activity = { ...activity, unread };
    emitActivity();
  }
}

export function useActivity(): Activity {
  useEffect(connect, []);
  return useSyncExternalStore(
    (fn) => {
      activityListeners.add(fn);
      return () => activityListeners.delete(fn);
    },
    () => activity,
  );
}
