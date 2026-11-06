import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppConfig } from '../shared/types.ts';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Library, chats and settings; override to keep them elsewhere (e.g. in a synced folder). */
export const DATA_DIR = path.resolve(process.env.PAPER_READER_DATA || path.join(ROOT, 'data'));
export const PAPERS_DIR = path.join(DATA_DIR, 'papers');
export const PORT = Number(process.env.PORT || 4317);
export const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
/** Claude sessions run from the product folder so `claude --resume` from paper-reader/ finds them */
export const SESSION_CWD = process.env.PAPER_READER_SESSION_CWD || ROOT;

const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const DEFAULT_CONFIG: AppConfig = {
  model: '',
  effort: '',
  skills: ['/i-have-adhd:i-have-adhd'],
  language: 'русский',
};

fs.mkdirSync(PAPERS_DIR, { recursive: true });

export function getConfig(): AppConfig {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(patch: Partial<AppConfig>): AppConfig {
  const next = { ...getConfig(), ...patch };
  next.skills = (next.skills || []).map((s) => s.trim()).filter(Boolean);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2));
  return next;
}

const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

/**
 * Whether a slash command can run: plugin skills ("/plugin:skill") need the plugin installed,
 * plain ones ("/name") need a user or project skill/command with that name.
 */
export function skillAvailable(command: string): boolean {
  const name = command.replace(/^\//, '').split(/\s/)[0];
  if (name.includes(':')) {
    const plugin = name.split(':')[0];
    try {
      const installed = JSON.parse(fs.readFileSync(path.join(CLAUDE_HOME, 'plugins', 'installed_plugins.json'), 'utf8'));
      return Object.keys(installed.plugins || {}).some((k) => k === plugin || k.startsWith(`${plugin}@`));
    } catch {
      return false;
    }
  }
  return [CLAUDE_HOME, path.join(SESSION_CWD, '.claude')].some(
    (base) => fs.existsSync(path.join(base, 'skills', name)) || fs.existsSync(path.join(base, 'commands', `${name}.md`)),
  );
}

export function activeSkills(): string[] {
  return getConfig().skills.filter(skillAvailable);
}
