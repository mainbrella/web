export type BuildMessage = { text: string; createdAt: string };
export type BuildDraft = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  messages: BuildMessage[];
};

export const maxBuildDrafts = 50;
export const maxBuildMessages = 100;
export const buildExamples: Record<string, string> = {
  expense: 'Build an expense tracker with a monthly overview, spending by category, budgets, and a searchable list of transactions. Use a clean layout that works on mobile.',
  portfolio: 'Build a portfolio website for a freelance designer with selected projects, an about page, and a contact form. Use large project images, simple typography, and a responsive layout.',
  team: 'Build a task board for a small team with To do, In progress, and Done columns. Include task owners, due dates, priority, and filters by team member.',
};

function validDate(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function validDraft(value: unknown): value is BuildDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as BuildDraft;
  return typeof draft.id === 'string' && draft.id.length > 0 && draft.id.length <= 100
    && typeof draft.name === 'string' && draft.name.trim().length > 0 && draft.name.length <= 80
    && validDate(draft.createdAt) && validDate(draft.updatedAt)
    && Array.isArray(draft.messages) && draft.messages.length > 0 && draft.messages.length <= maxBuildMessages
    && draft.messages.every(message => message && typeof message.text === 'string'
      && message.text.trim().length > 0 && message.text.length <= 6000 && validDate(message.createdAt));
}

export function createBuildDraftStore(storage: Pick<Storage, 'getItem' | 'setItem'>, userId: string) {
  const key = `mainbrella-build-drafts:v1:${userId}`;
  function validate(value: unknown): asserts value is BuildDraft[] {
    if (!Array.isArray(value) || value.length > maxBuildDrafts || !value.every(validDraft)
      || new Set(value.map(draft => draft.id)).size !== value.length) throw new Error('invalid_drafts');
  }
  return {
    read(): BuildDraft[] {
      const saved = storage.getItem(key);
      if (saved === null) return [];
      const drafts: unknown = JSON.parse(saved);
      validate(drafts);
      return drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    save(drafts: BuildDraft[]) {
      validate(drafts);
      storage.setItem(key, JSON.stringify(drafts));
    },
  };
}

export function newBuildDraft(prompt: string): BuildDraft {
  const text = prompt.trim();
  if (!text || text.length > 6000) throw new Error('invalid_prompt');
  const now = new Date().toISOString();
  const firstLine = text.split(/\r?\n/)[0].replace(/\s+/g, ' ');
  const name = firstLine.length > 64 ? `${firstLine.slice(0, 61).trimEnd()}…` : firstLine;
  return { id: crypto.randomUUID(), name, createdAt: now, updatedAt: now, messages: [{ text, createdAt: now }] };
}

export function formatBuildBrief(draft: BuildDraft) {
  return `${draft.name}\n\n${draft.messages.map((message, index) => `${index === 0 ? 'Initial brief' : `Update ${index}`}\n${message.text}`).join('\n\n')}\n`;
}
