// Types shared by the server and the web client.

export type PaperKind = 'pdf' | 'html';

export interface PaperMeta {
  id: string;
  title: string;
  authors?: string;
  kind: PaperKind;
  source: { type: 'file' | 'url'; name?: string; url?: string };
  createdAt: string;
  openedAt?: string;
  pages?: number;
  lastPage?: number;
  /** 0..1, how far the reader got */
  progress?: number;
  zoom?: number;
  /** Claude Code session bound to this paper */
  sessionId?: string;
  /** true once the session file exists, so the next launch uses --resume */
  sessionStarted?: boolean;
  /** slash-command skills already sent to this session */
  activatedSkills?: string[];
  messageCount?: number;
  /** content hash of the original file, to recognise the same paper imported twice */
  sha1?: string;
}

/** Rect normalized to the page box: all values are 0..1 */
export interface NRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink';

export interface Highlight {
  id: string;
  color: HighlightColor;
  text: string;
  /** PDF only: first page, and the rects on it */
  page?: number;
  rects?: NRect[];
  /** PDF only: every page the highlight spans (a selection across a page break) */
  parts?: { page: number; rects: NRect[] }[];
  /** HTML only: text-quote anchor */
  prefix?: string;
  suffix?: string;
  note?: string;
  createdAt: string;
}

export interface Attachment {
  kind: 'text' | 'image' | 'paper';
  /** kind 'paper': another paper from the library to use as context */
  paperId?: string;
  text?: string;
  page?: number;
  /** image: data URL when sending, asset path once stored */
  image?: string;
  /** where the fragment came from, so the UI can jump back */
  rects?: NRect[];
}

export interface ToolUse {
  id: string;
  name: string;
  summary: string;
  status: 'running' | 'done' | 'error';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  attachments?: Attachment[];
  tools?: ToolUse[];
  error?: string;
  interrupted?: boolean;
  createdAt: string;
}

export type SessionStatus = 'offline' | 'starting' | 'ready' | 'busy';

export interface SessionInfo {
  status: SessionStatus;
  sessionId?: string;
  model?: string;
  skills: string[];
  skillsActive: boolean;
  resumeCommand?: string;
  queued: number;
  /** the start-up skill is running, not an answer to the reader */
  warming: boolean;
}

export type ChatEvent =
  | { type: 'status'; session: SessionInfo }
  | { type: 'message'; message: ChatMessage }
  | { type: 'partial'; text: string; tools: ToolUse[] }
  | { type: 'removed'; id: string }
  | { type: 'reset' };

/** Status of every paper session, for tabs and the library */
export type GlobalEvent =
  | { type: 'status'; paperId: string; status: SessionStatus }
  | { type: 'answer'; paperId: string };

export interface Health {
  claude: { ok: boolean; version?: string; error?: string };
  /** configured skills that are not installed and will be skipped */
  missingSkills: string[];
}

export interface AppConfig {
  /** empty = Claude Code default model */
  model: string;
  effort: string;
  /** slash commands sent once when a paper session is created */
  skills: string[];
  language: string;
}
