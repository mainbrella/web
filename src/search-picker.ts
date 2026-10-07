export interface PickerOption { value: string; label: string; search?: string }

/** A searchable single selection. Typed text is never used as an identity. */
export function createSearchPicker(input: HTMLInputElement, onChange: () => void) {
  const wrapper = document.createElement('div');
  wrapper.className = 'search-picker';
  input.before(wrapper); wrapper.append(input);
  const popup = document.createElement('div');
  popup.className = 'search-picker-popup'; popup.hidden = true;
  const list = document.createElement('div');
  list.id = `${input.id}-options`; list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', input.labels?.[0]?.textContent ?? 'Options');
  const status = document.createElement('div');
  status.className = 'search-picker-status'; status.setAttribute('role', 'status');
  popup.append(list, status); wrapper.append(popup);
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', list.id); input.setAttribute('aria-expanded', 'false');
  let options: PickerOption[] = [], matches: PickerOption[] = [], selected = '', active = -1;

  function close() {
    popup.hidden = true; input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant'); active = -1;
  }
  function validity() {
    input.setCustomValidity(selected ? '' : 'Select an option from the search results.');
  }
  function highlight(index: number) {
    active = index;
    Array.from(list.children).forEach((node, i) => node.setAttribute('aria-selected', String(i === active)));
    const node = list.children[active];
    if (node) {
      input.setAttribute('aria-activedescendant', node.id);
      node.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }
  function choose(option: PickerOption) {
    selected = option.value; input.value = option.label; validity(); close(); onChange();
  }
  function render() {
    if (input.disabled) { close(); return; }
    const query = selected ? '' : input.value.trim().toLocaleLowerCase();
    const filtered = options.filter(option => `${option.label} ${option.search ?? ''}`.toLocaleLowerCase().includes(query));
    // Keep the DOM bounded even when the source list contains thousands of entries.
    matches = filtered.slice(0, 50); active = -1;
    input.removeAttribute('aria-activedescendant');
    list.replaceChildren(...matches.map((option, index) => {
      const node = document.createElement('div');
      node.id = `${list.id}-${index}`; node.className = 'search-picker-option';
      node.setAttribute('role', 'option'); node.setAttribute('aria-selected', 'false');
      node.textContent = option.label;
      node.addEventListener('pointerdown', event => event.preventDefault());
      node.addEventListener('click', () => choose(option));
      return node;
    }));
    status.textContent = filtered.length === 0 ? 'No matches found.'
      : filtered.length > matches.length ? `${filtered.length} matches. Type more to narrow the results.`
      : `${filtered.length} ${filtered.length === 1 ? 'match' : 'matches'}.`;
    popup.hidden = false; input.setAttribute('aria-expanded', 'true');
  }
  input.addEventListener('focus', () => { input.select(); render(); });
  input.addEventListener('click', () => { if (popup.hidden) { input.select(); render(); } });
  input.addEventListener('input', () => { selected = ''; validity(); render(); onChange(); });
  input.addEventListener('blur', close);
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); if (popup.hidden) render();
      if (matches.length) highlight(event.key === 'ArrowDown' ? Math.min(active + 1, matches.length - 1) : active < 0 ? matches.length - 1 : Math.max(0, active - 1));
    } else if (event.key === 'Enter' && !popup.hidden) {
      event.preventDefault();
      if (active >= 0) choose(matches[active]);
      else if (matches.length === 1) choose(matches[0]);
    } else if (event.key === 'Escape' && !popup.hidden) {
      event.preventDefault(); event.stopPropagation(); close();
    } else if (event.key === 'Tab') close();
  });
  input.closest('dialog')?.addEventListener('close', close);
  validity();
  return {
    get value() { return selected; },
    set value(value: string) {
      const option = options.find(option => option.value === value);
      selected = option?.value ?? ''; input.value = option?.label ?? ''; validity(); close();
    },
    get disabled() { return input.disabled; },
    set disabled(value: boolean) { input.disabled = value; if (value) close(); },
    focus() { input.focus(); },
    setOptions(next: PickerOption[]) {
      options = next;
      if (selected) {
        const option = options.find(option => option.value === selected);
        selected = option?.value ?? ''; input.value = option?.label ?? '';
      }
      validity(); if (!popup.hidden) render();
    },
  };
}
