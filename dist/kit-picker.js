/* Kit-name autocomplete from the bundled Bandai catalogue (catalogue.json, from gunpla.fyi).
   Works offline and without an account; community.js adds "parts list available" labels when it is switched on. */
(() => {
  'use strict';
  const K = window.Catalogue;
  const App = window.RunnerApp;
  const $ = id => document.getElementById(id);
  if (!K || !App) return;

  let entries = null;
  let loading = null;
  let status = () => '';
  const pickListeners = [];
  function load() {
    if (entries) return Promise.resolve(entries);
    // The release stamp keeps a freshly deployed page from reading a stale catalogue from the browser cache.
    const version = (document.querySelector('meta[name="runner-version"]') || {}).content || 'dev';
    if (!loading) loading = fetch(`catalogue.json?v=${encodeURIComponent(version)}`).then(response => {
      if (!response.ok) throw new Error('The kit catalogue could not load.');
      return response.json();
    }).then(data => (entries = K.parseCatalogue(data))).catch(error => { loading = null; throw error; });
    return loading;
  }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // A combobox listbox under an input: arrow keys move, Enter picks, Escape closes.
  let listCount = 0;
  function attach(input, onPick) {
    const list = element('ul', 'kit-suggestions');
    list.id = `kit-suggestions-${++listCount}`;
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    input.after(list);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', list.id);
    input.setAttribute('aria-expanded', 'false');
    let results = [];
    let active = -1;
    let token = 0;
    let picking = false;
    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      active = -1;
    }
    function highlight(index) {
      active = index;
      [...list.children].forEach((item, position) => item.setAttribute('aria-selected', String(position === index)));
      if (index >= 0) { input.setAttribute('aria-activedescendant', list.children[index].id); list.children[index].scrollIntoView({ block: 'nearest' }); }
    }
    function pick(entry) {
      close();
      // onPick fills the input, which must not reopen the list.
      picking = true;
      try { onPick(entry); } finally { picking = false; }
      pickListeners.forEach(listener => listener(entry, input));
    }
    async function update() {
      if (picking) return;
      const query = input.value.trim();
      const mine = ++token;
      if (query.length < 2) { close(); return; }
      try { await load(); } catch { close(); return; }
      if (mine !== token) return;
      results = K.searchCatalogue(entries, query, { limit: 8 });
      if (!results.length) { close(); return; }
      list.replaceChildren(...results.map((entry, index) => {
        const item = element('li', 'kit-suggestion');
        item.id = `${list.id}-${index}`;
        item.setAttribute('role', 'option');
        const label = status(entry);
        item.append(element('span', 'kit-suggestion-name', K.projectName(entry)), element('span', 'kit-suggestion-meta', K.entryMeta(entry)));
        if (label) item.append(element('span', `kit-suggestion-status${/^No /.test(label) ? '' : ' has-list'}`, label));
        item.addEventListener('mousedown', event => event.preventDefault());
        item.addEventListener('click', () => pick(entry));
        return item;
      }));
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      highlight(-1);
    }
    input.addEventListener('input', update);
    input.addEventListener('focus', () => { load().catch(() => {}); });
    input.addEventListener('blur', () => setTimeout(close, 120));
    input.addEventListener('keydown', event => {
      if (list.hidden) return;
      if (event.key === 'ArrowDown') { event.preventDefault(); highlight((active + 1) % results.length); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); highlight(active <= 0 ? results.length - 1 : active - 1); }
      else if (event.key === 'Enter' && active >= 0) { event.preventDefault(); pick(results[active]); }
      else if (event.key === 'Escape') { event.preventDefault(); close(); }
    });
    return { close, refresh: update };
  }

  // Workbench: picking a kit names the project and remembers its brand, grade, scale and product code.
  const details = $('kit-details');
  function renderDetails() {
    const kit = App.project().kit;
    const parts = kit && kit.catalogueId ? [K.entryMeta({ scale: kit.scale, line: kit.line, released: '' }), kit.productCode && `Product code ${kit.productCode}`] : [];
    details.textContent = parts.filter(Boolean).join(' · ');
    details.hidden = !details.textContent;
  }
  attach($('project-name'), entry => {
    const project = App.project();
    project.kit = { ...(project.kit || {}), ...K.kitFromEntry(entry) };
    $('project-name').value = K.projectName(entry);
    $('project-name').dispatchEvent(new Event('input', { bubbles: true }));
    renderDetails();
  });
  $('project-name').addEventListener('input', event => {
    // Typing a different name after picking a kit forgets the old kit link.
    const kit = App.project().kit;
    if (event.isTrusted && kit && kit.catalogueId && App.project().name.trim() === '') { delete kit.catalogueId; renderDetails(); }
  });
  App.onChange(renderDetails);
  renderDetails();

  window.KitPicker = {
    load,
    attach,
    entries: () => entries,
    onPick(listener) { pickListeners.push(listener); },
    setStatus(provider) { status = provider; }
  };
})();
