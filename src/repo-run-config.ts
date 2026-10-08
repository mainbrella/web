import { normalizeRepo, type RepoRunOptions } from './repo-run-contract.ts';
import { validRepo } from './repo-run-prompt.ts';
import { Document, isAlias, isMap, isScalar, parseDocument, Scalar } from 'yaml';

const keys = ['repo', 'ref', 'catalogId', 'size', 'cwd', 'setupCommand', 'startCommand', 'port'];

export function validateRepoRunConfig(value: unknown): RepoRunOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Use a YAML mapping containing the repository configuration.');
  const config = value as Record<string, unknown>;
  if (Object.keys(config).some(key => !keys.includes(key))) throw new Error('Use only repo, ref, catalogId, size, cwd, setupCommand, startCommand and port.');
  if (typeof config.repo !== 'string' || !validRepo(config.repo)) throw new Error('repo must be a public GitHub URL or owner/repository.');
  const result: RepoRunOptions = { repo: normalizeRepo(config.repo), size: 'small', cwd: '.' };
  if (config.ref !== undefined) {
    if (typeof config.ref !== 'string' || !config.ref || config.ref.length > 200 || /[\x00-\x20\x7f]/.test(config.ref)) throw new Error('ref must be a commit, branch or tag without spaces (up to 200 characters).');
    result.ref = config.ref;
  }
  if (config.catalogId !== undefined) {
    if (typeof config.catalogId !== 'string' || !['node', 'python', 'rust', 'go', 'devops'].includes(config.catalogId)) throw new Error('catalogId must be node, python, rust, go or devops.');
    result.catalogId = config.catalogId;
  }
  if (config.size !== undefined) {
    if (typeof config.size !== 'string' || !['lite', 'small', 'medium', 'large', 'xl'].includes(config.size)) throw new Error('size must be lite, small, medium, large or xl.');
    result.size = config.size;
  }
  if (config.cwd !== undefined) {
    if (typeof config.cwd !== 'string' || config.cwd.length > 200 || !(config.cwd === '.' ||
      /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(config.cwd) && config.cwd.split('/').every(part => part !== '.' && part !== '..'))) throw new Error('cwd must be "." or a relative directory without "." or ".." path segments (up to 200 characters).');
    result.cwd = config.cwd;
  }
  for (const key of ['setupCommand', 'startCommand'] as const) {
    const command = config[key];
    if (command === undefined) continue;
    if (typeof command !== 'string' || !command.trim() || command.trim().length > 4096 || command.includes('\0')) throw new Error(`${key} must be a nonempty shell command of at most 4096 characters.`);
    result[key] = command.trim();
  }
  if (config.port !== undefined) {
    if (typeof config.port !== 'number' || !Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw new Error('port must be an integer between 1024 and 65535.');
    result.port = config.port;
  }
  if (Boolean(result.startCommand) !== (result.port !== undefined)) throw new Error('Supply startCommand and port together, or omit both for a terminal-only run.');
  return result;
}

export function parseRepoRunConfig(text: string): RepoRunOptions {
  if (text.length > 100_000) throw new Error('This response is too long. Paste only the YAML configuration.');
  const trimmed = text.trim();
  // Keep raw JSON support strict: malformed JSON that starts like JSON should not
  // be mistaken for a YAML document or silently recovered from surrounding text.
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed: unknown;
    try { parsed = JSON.parse(trimmed); }
    catch { throw new Error('Could not parse the JSON configuration.'); }
    return validateRepoRunConfig(parsed);
  }

  const fences = [...text.matchAll(/```([^\r\n`]*)\r?\n([\s\S]*?)```/g)];
  const yamlCandidates = fences.filter(fence => ['yaml', 'yml', ''].includes(fence[1].trim().toLowerCase()));
  const jsonCandidates = fences.filter(fence => fence[1].trim().toLowerCase() === 'json');
  const rawYaml = !fences.length && /^(?:---\s*\n)?(?:repo|ref|catalogId|size|cwd|setupCommand|startCommand|port)\s*:/m.test(trimmed);
  if (rawYaml) return validateRepoRunConfig(parseYamlConfig(trimmed));
  if (yamlCandidates.length || jsonCandidates.length) {
    const candidates: unknown[] = [];
    for (const fence of yamlCandidates) {
      const body = fence[2];
      if (!/^(?:---\s*\n)?(?:repo|ref|catalogId|size|cwd|setupCommand|startCommand|port)\s*:/m.test(body.trim())) continue;
      candidates.push(parseYamlConfig(body));
    }
    for (const fence of jsonCandidates) {
      try {
        const parsedBlock: unknown = JSON.parse(fence[2]);
        if (parsedBlock && typeof parsedBlock === 'object' && !Array.isArray(parsedBlock) && Object.hasOwn(parsedBlock, 'repo')) candidates.push(parsedBlock);
      } catch { /* Invalid fenced JSON is ignored alongside prose and examples. */ }
    }
    if (candidates.length > 1) throw new Error('Found multiple repository configurations. Paste only the one you want to run.');
    if (candidates.length === 1) return validateRepoRunConfig(candidates[0]);
    throw new Error('Could not find a repository configuration. Paste valid YAML or an AI response containing it.');
  }

  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { /* A full AI response may surround JSON with prose or Markdown. */ }
  if (parsed !== undefined) return validateRepoRunConfig(parsed);

  const candidates: unknown[] = [];
  let start = -1, depth = 0, quoted = false, escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (start === -1) {
      if (char === '{') { start = index; depth = 1; }
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      try {
        const value: unknown = JSON.parse(text.slice(start, index + 1));
        if (value && typeof value === 'object' && Object.hasOwn(value, 'repo')) candidates.push(value);
      } catch { /* Ignore braces in prose or shell examples. */ }
      start = -1;
    }
  }
  if (candidates.length > 1) throw new Error('Found multiple repository configurations. Paste only the one you want to run.');
  if (!candidates.length) throw new Error('Could not find a repository configuration. Paste valid YAML or the AI response containing it.');
  return validateRepoRunConfig(candidates[0]);
}

function containsAlias(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  if (isAlias(node)) return true;
  if (isMap(node)) return node.items.some(pair => containsAlias(pair.key) || containsAlias(pair.value));
  if ('items' in node && Array.isArray(node.items)) return node.items.some(containsAlias);
  if (isScalar(node)) return false;
  return false;
}

function parseYamlConfig(text: string): unknown {
  const document = parseDocument(text, { uniqueKeys: true, strict: true });
  if (document.errors.length || document.warnings.length) throw new Error('Could not parse the YAML configuration. Check its indentation, keys and scalar values.');
  if (document.contents && containsAlias(document.contents)) throw new Error('YAML aliases are not supported in repository configurations.');
  try { return document.toJS({ maxAliasCount: 0 }); }
  catch { throw new Error('Could not parse the YAML configuration.'); }
}

export function stringifyRepoRunConfig(value: RepoRunOptions): string {
  const document = new Document(value);
  if (isMap(document.contents)) {
    for (const pair of document.contents.items) {
      if (isScalar(pair.key) && (pair.key.value === 'setupCommand' || pair.key.value === 'startCommand') && isScalar(pair.value) && typeof pair.value.value === 'string') {
        pair.value.type = Scalar.BLOCK_LITERAL;
      }
    }
  }
  return document.toString({ lineWidth: 0 });
}
