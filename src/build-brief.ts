export type BuildBrief = {
  prompt: string;
  answers: [string, string];
};

type BuildBriefOption = {
  value: string;
  description?: string;
  colors?: readonly string[];
};

type BuildBriefQuestion = {
  title: string;
  options: readonly BuildBriefOption[];
};

export const buildBriefQuestions: readonly BuildBriefQuestion[] = [
  {
    title: 'What kind of app do you have in mind?',
    options: [
      { value: 'Website', description: 'A landing page, portfolio, or guide' },
      { value: 'Interactive app', description: 'A tool or experience people can use' },
      { value: 'Dashboard', description: 'Track, compare, and manage information' },
    ],
  },
  {
    title: 'What should it look and feel like?',
    options: [
      { value: 'Clean and minimal', colors: ['#f5f5f0', '#d8dcd9', '#687780', '#1d2b36'] },
      { value: 'Warm and natural', colors: ['#f0e8da', '#c8b99c', '#6c7b5b', '#2c3b2e'] },
      { value: 'Dark and focused', colors: ['#0d1014', '#24303d', '#80aaff', '#e7edf5'] },
      { value: 'Bold and playful', colors: ['#f3e8f6', '#bba4d0', '#e4ab63', '#48385e'] },
    ],
  },
];

const preferenceMarker = '\n\nBuild preferences:\n';
const maxAnswerLength = 180;
const maxPromptLength = 6000;

function blankBrief(text: string): BuildBrief {
  return { prompt: text, answers: ['', ''] };
}

export function formatBuildBriefPrompt(prompt: string, answers: readonly string[]): string {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) throw new Error('Describe what you want to build before continuing.');

  const trimmedAnswers = [answers[0] ?? '', answers[1] ?? ''].map(answer => answer.trim());
  if (trimmedAnswers.some(answer => answer.length > maxAnswerLength)) {
    throw new Error('Each build preference must be 180 characters or fewer.');
  }

  if (trimmedAnswers.every(answer => !answer)) {
    if (trimmedPrompt.length > maxPromptLength) {
      throw new Error('Your idea and preferences are longer than 6,000 characters. Shorten your idea or skip the questions.');
    }
    return trimmedPrompt;
  }

  const formatted = `${trimmedPrompt}${preferenceMarker}${JSON.stringify({
    appType: trimmedAnswers[0],
    visualStyle: trimmedAnswers[1],
  })}`;
  if (formatted.length > maxPromptLength) {
    throw new Error('Your idea and preferences are longer than 6,000 characters. Shorten your idea or skip the questions.');
  }
  return formatted;
}

export function readBuildBriefPrompt(text: string): BuildBrief {
  const markerIndex = text.lastIndexOf(preferenceMarker);
  if (markerIndex < 0) return blankBrief(text);

  const prompt = text.slice(0, markerIndex);
  if (!prompt.trim()) return blankBrief(text);

  try {
    const parsed: unknown = JSON.parse(text.slice(markerIndex + preferenceMarker.length));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return blankBrief(text);

    const record = parsed as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length !== 2 || !keys.includes('appType') || !keys.includes('visualStyle')) return blankBrief(text);

    const appType = record.appType;
    const visualStyle = record.visualStyle;
    if (typeof appType !== 'string' || typeof visualStyle !== 'string'
      || appType.length > maxAnswerLength || visualStyle.length > maxAnswerLength
      || (!appType.trim() && !visualStyle.trim())) {
      return blankBrief(text);
    }

    return { prompt, answers: [appType, visualStyle] };
  } catch {
    return blankBrief(text);
  }
}
