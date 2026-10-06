import type { PublicStatus } from './status-data.ts';
import { API_ORIGIN } from './auth.ts';
import { components, currentComponents, historyPath, readPublicStatus } from './status-data.ts';

const table = document.querySelector<HTMLElement>('#status-components')!;
const summary = document.querySelector<HTMLElement>('#status-summary')!;
const incidents = document.querySelector<HTMLElement>('#status-incidents')!;
const history = document.querySelector<HTMLElement>('#status-history')!;
const feedback = document.querySelector<HTMLElement>('#history-feedback')!;
const more = document.querySelector<HTMLButtonElement>('#history-more')!;
let status: PublicStatus | null = null, next: string | null = '/status/history', historyLoaded = false;
const date = (value?: string) => Number.isFinite(Date.parse(value ?? "")) ? new Date(value!).toLocaleString() : 'No observation';
const label = (value: unknown) => typeof value === 'string' ? value.replaceAll('_', ' ') : 'Unknown';
function row(parent: HTMLElement, values: string[]) {
  const tr = document.createElement('tr');
  values.forEach((value, index) => {
    const cell = document.createElement(index === 0 ? 'th' : 'td');
    if (index === 0) cell.scope = 'row';
    cell.textContent = value;
    tr.append(cell);
  });
  parent.append(tr);
}
function renderComponents() {
  table.replaceChildren();
  for (const item of currentComponents(status)) {
    row(table, [item.name, label(item.state), date(item.checkedAt), label(item.scope)]);
  }
}
async function refresh() {
  try {
    status = await readPublicStatus('/status', { origin: API_ORIGIN });
    summary.textContent = `Report generated ${date(status.generatedAt)}. Observations expire after 15 minutes.`;
    incidents.replaceChildren();
    if (!status.incidents.length) incidents.textContent = 'No incidents in the current report.';
    for (const item of status.incidents) {
      const article = document.createElement('article');
      article.className = 'release-entry';
      const title = document.createElement('h3');
      title.textContent = `${item.title} — ${label(item.state)}`;
      const message = document.createElement('p');
      message.textContent = item.message;
      const updated = document.createElement('p');
      updated.textContent = `${components[item.component] ?? 'Unknown component'} · Updated ${date(item.updated_at)}`;
      article.append(title, message, updated); incidents.append(article);
    }
  } catch {
    status = null;
    summary.textContent = 'Current status unavailable. Component health is unknown. Retrying automatically.';
    incidents.textContent = 'Incident report unavailable.';
  }
  renderComponents();
}
async function loadHistory() {
  if (!next) return;
  more.disabled = true;
  feedback.textContent = 'Loading observations…';
  try {
    const data = await readPublicStatus(next, { origin: API_ORIGIN });
    for (const item of data.observations) {
      row(history, [components[item.component] ?? 'Unknown component', label(item.state), date(item.checkedAt), label(item.scope)]);
    }
    next = historyPath(data.next);
    historyLoaded = true;
    feedback.textContent = history.children.length ? 'Observations are retained for 31 days; missing samples do not establish uptime.' : 'No observations in the retained history.';
    more.hidden = !next;
    more.textContent = 'Load older observations';
  } catch {
    feedback.textContent = 'Could not load observations. Try again.';
    more.hidden = false;
    more.textContent = historyLoaded ? 'Retry older observations' : 'Retry observations';
  } finally { more.disabled = false; }
}
more.addEventListener('click', loadHistory);
renderComponents();
void refresh();
void loadHistory();
setInterval(renderComponents, 15_000);
setInterval(refresh, 60_000);
