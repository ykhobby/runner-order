/* UI only. User-entered content is always inserted as text, never HTML. */
(() => {
  'use strict';
  const P = window.Parts;
  const L = window.Projects;
  const $ = id => document.getElementById(id);
  let storage;
  try { storage = window.localStorage; } catch { storage = null; }
  const loaded = L.loadLibrary(storage);
  let library = loaded.library;
  let project = library.current;
  let lastDeletion = null;
  let editors = new Map();
  let exportBusy = false;
  let exportChoiceMade = false;
  let exportURL = null;
  let exportedData = null;
  const exportData = () => JSON.stringify({ name: project.name, sections: project.sections });
  const icons = {
    up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 10 6 6 6-6"/></svg>',
    delete: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7"/></svg>'
  };
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function plural(count, word) { return `${count} ${word}${count === 1 ? '' : 's'}`; }
  function warnStorage(message) {
    $('storage-warning').textContent = message;
    $('storage-warning').hidden = !message;
  }
  function save() {
    library.current = project;
    const success = L.saveLibrary(storage, library);
    $('save-status').replaceChildren(element('span', 'status-dot'), document.createTextNode(success ? 'Saved on this device' : 'Not saved'));
    warnStorage(success ? '' : 'Browser storage is unavailable or full. Keep this page open: your latest changes cannot be saved.');
  }
  function renderProjects() {
    const select = $('saved-projects');
    select.replaceChildren(element('option', '', 'Choose a project'));
    select.firstChild.value = '';
    [...library.projects].sort((a, b) => a.project.name.localeCompare(b.project.name, 'en', { numeric: true })).forEach(entry => {
      const option = element('option', '', entry.project.name);
      option.value = entry.id;
      select.append(option);
    });
    select.value = library.activeId || '';
    select.disabled = !library.projects.length;
    $('open-project').disabled = !select.value;
  }
  function changeProject(operation) {
    // Commit switches and saves atomically. A storage failure leaves the inputs intact.
    const next = JSON.parse(JSON.stringify(library));
    next.current = JSON.parse(JSON.stringify(project));
    const result = operation(next);
    if (!L.saveLibrary(storage, next)) throw new Error('Could not save to this browser. Your current inputs are still open.');
    library = next;
    project = library.current;
    lastDeletion = null;
    $('deletion-notice').hidden = true;
    if (exportURL) URL.revokeObjectURL(exportURL);
    exportURL = null;
    exportedData = null;
    $('export-file').hidden = true;
    $('export-status').textContent = '';
    $('export-options').hidden = true;
    $('export-toggle').setAttribute('aria-expanded', 'false');
    exportChoiceMade = false;
    document.querySelector('input[name="export-pages"][value="1"]').checked = true;
    $('project-name').value = project.name;
    renderProjects();
    renderEditors();
    renderOutput();
    save();
    return result;
  }
  function projectAction(operation, message) {
    try {
      const result = changeProject(operation);
      $('project-status').textContent = message(result);
      return true;
    } catch (error) {
      $('project-status').textContent = error.message;
      $('project-name').focus();
      return false;
    }
  }
  $('save-project').addEventListener('click', () => projectAction(next => L.saveCurrent(next), entry => `Saved "${entry.project.name}" on this device.`));
  $('new-project').addEventListener('click', () => {
    if (projectAction(next => L.startNew(next), saved => saved ? `Saved "${saved.project.name}". Your new project is ready.` : 'Your new project is ready.')) $('project-name').focus();
  });
  $('export-project').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([L.projectFile(project)], { type: 'application/json' }));
    const link = element('a');
    link.href = url;
    link.download = L.projectFileName(project);
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('project-status').textContent = `Exported "${project.name.trim() || 'Untitled project'}" as a file. Keep it as a backup or import it on another device.`;
  });
  $('import-project').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    let imported;
    try { imported = L.readProjectFile(await file.text()); }
    catch (error) { $('project-status').textContent = error.message; return; }
    projectAction(next => L.importProject(next, imported), result => `Imported "${result.entry.project.name}"${result.saved ? ` and saved "${result.saved.project.name}"` : ''}.`);
  });
  $('saved-projects').addEventListener('change', event => { $('open-project').disabled = !event.target.value; });
  $('open-project').addEventListener('click', () => {
    const id = $('saved-projects').value;
    if (id) projectAction(next => L.openProject(next, id), result => `Opened "${result.entry.project.name}".`);
  });

  function actionButton(action, section, index) {
    const button = element('button', `icon-button ${action === 'delete' ? 'delete-button' : ''}`);
    button.type = 'button';
    // Only trusted, constant icon markup is used here.
    button.innerHTML = icons[action];
    const label = action === 'delete' ? `Delete ${P.sectionName(section)}` : `Move ${P.sectionName(section)} ${action}`;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.dataset.action = action;
    button.disabled = (action === 'up' && index === 0) || (action === 'down' && index === project.sections.length - 1);
    button.addEventListener('click', () => {
      if (action === 'delete') {
        lastDeletion = P.deleteSection(project, section.id);
        $('deletion-message').textContent = `${P.sectionName(section)} deleted.`;
        $('deletion-notice').hidden = false;
        renderEditors();
        $('undo-delete').focus();
      } else {
        P.moveSection(project, section.id, action === 'up' ? -1 : 1);
        renderEditors();
        const replacement = editors.get(section.id).root.querySelector(`[data-action="${action}"]`);
        (replacement.disabled ? editors.get(section.id).name : replacement).focus();
      }
      renderOutput();
      save();
    });
    return button;
  }

  function updateEditor(section) {
    const editor = editors.get(section.id);
    const parsed = P.parseParts(section.raw);
    editor.count.textContent = plural(parsed.parts.length, 'part');
    editor.error.hidden = parsed.invalid.length === 0;
    editor.error.textContent = parsed.invalid.length ? `Check: ${parsed.invalid.join(', ')}. Use A15 or B1-12.` : '';
    editor.raw.setAttribute('aria-invalid', String(parsed.invalid.length > 0));
    for (const button of editor.root.querySelectorAll('[data-action]')) {
      const action = button.dataset.action;
      const label = action === 'delete' ? `Delete ${P.sectionName(section)}` : `Move ${P.sectionName(section)} ${action}`;
      button.setAttribute('aria-label', label);
      button.title = label;
    }
  }
  function renderEditors() {
    editors = new Map();
    const fragment = document.createDocumentFragment();
    project.sections.forEach((section, index) => {
      const root = element('div', 'section-editor');
      const toolbar = element('div', 'section-toolbar');
      toolbar.append(element('span', 'section-index', String(index + 1).padStart(2, '0')));
      const nameLabel = element('label', 'sr-only', `Section ${index + 1} name`);
      nameLabel.htmlFor = `name-${section.id}`;
      const name = element('input', 'section-name');
      name.id = nameLabel.htmlFor;
      name.type = 'text';
      name.value = section.name;
      name.placeholder = 'Section name';
      name.autocomplete = 'off';
      toolbar.append(nameLabel, name);
      const actions = element('div', 'section-actions');
      ['up', 'down', 'delete'].forEach(action => actions.append(actionButton(action, section, index)));
      toolbar.append(actions);
      const label = element('label', 'parts-label');
      label.htmlFor = `parts-${section.id}`;
      const count = element('span', 'entry-part-count');
      label.append(document.createTextNode('Parts'), count);
      const raw = element('textarea');
      raw.id = label.htmlFor;
      raw.value = section.raw;
      raw.placeholder = 'A15 A16 B12 A3 F16';
      raw.spellcheck = false;
      raw.autocapitalize = 'characters';
      const help = element('p', 'input-help', 'A15 · B1-12 · B1:12 · B1 12   /   spaces, commas, new lines');
      help.id = `help-${section.id}`;
      const error = element('p', 'parse-error');
      error.id = `error-${section.id}`;
      raw.setAttribute('aria-describedby', `${help.id} ${error.id}`);
      root.append(toolbar, label, raw, help, error);
      editors.set(section.id, { root, name, raw, count, error });
      name.addEventListener('input', () => {
        section.name = name.value;
        updateEditor(section);
        renderOutput();
        save();
      });
      raw.addEventListener('input', () => {
        section.raw = raw.value;
        updateEditor(section);
        renderOutput();
        save();
      });
      updateEditor(section);
      fragment.append(root);
    });
    $('sections').replaceChildren(fragment);
    $('entry-empty').hidden = project.sections.length > 0;
    $('section-count').textContent = project.sections.length;
  }

  function runnerGroup(group, showSource) {
    const root = element('div', 'runner-group');
    const heading = element(showSource ? 'h3' : 'h4', 'runner-heading');
    heading.append(document.createTextNode('Runner'), element('span', 'runner-code', group.runner));
    root.append(heading);
    const list = element('ul', showSource ? 'runner-table' : 'part-chips');
    group.parts.forEach(part => {
      const item = element('li', showSource ? 'runner-row' : 'part-chip');
      if (showSource) item.append(element('span', 'part-reference', P.partLabel(part)), element('span', 'source-section', part.sectionName));
      else item.textContent = P.partLabel(part);
      list.append(item);
    });
    root.append(list);
    return root;
  }
  function renderOutput() {
    if (exportedData && exportedData !== exportData()) {
      $('export-file').hidden = true;
      $('export-status').textContent = 'Project changed. Export again for an updated cutting sheet.';
      if (exportURL) URL.revokeObjectURL(exportURL);
      exportURL = null;
      exportedData = null;
    }
    const parts = P.projectParts(project);
    const invalid = project.sections.reduce((count, section) => count + P.parseParts(section.raw).invalid.length, 0);
    const byRunner = project.view === 'runner';
    $('part-count').textContent = plural(parts.length, 'part');
    $('view-section').setAttribute('aria-pressed', String(!byRunner));
    $('view-runner').setAttribute('aria-pressed', String(byRunner));
    $('view-description').textContent = byRunner ? 'One runner at a time. Every part shows its source section.' : 'One assembly at a time. Parts sorted within each section.';
    $('output-warning').hidden = !invalid;
    $('output-warning').textContent = `${plural(invalid, 'entry')} ${invalid === 1 ? 'needs' : 'need'} checking. Only recognised parts appear below; your original text is kept on the left.`;
    $('output-empty').hidden = parts.length > 0;
    const fragment = document.createDocumentFragment();
    if (byRunner) P.groupParts(parts).forEach(group => fragment.append(runnerGroup(group, true)));
    else if (parts.length > 0) project.sections.forEach(section => {
      const parsed = P.parseParts(section.raw);
      const root = element('div', 'output-section');
      const heading = element('div', 'output-section-heading');
      heading.append(element('h3', '', P.sectionName(section)), element('span', '', plural(parsed.parts.length, 'part')));
      root.append(heading);
      if (parsed.parts.length === 0) root.append(element('p', 'empty-section', 'No recognised parts in this section yet.'));
      P.groupParts(parsed.parts).forEach(group => root.append(runnerGroup(group, false)));
      fragment.append(root);
    });
    $('cutting-list').replaceChildren(fragment);
    $('export-toggle').disabled = !parts.length || exportBusy;
    $('export-download').disabled = !parts.length || !!invalid || exportBusy;
    $('save-project').disabled = exportBusy;
    $('new-project').disabled = exportBusy;
    $('import-project').disabled = exportBusy;
    $('open-project').disabled = exportBusy || !$('saved-projects').value;
    $('export-warning').hidden = !invalid;
    $('export-warning').textContent = `Check ${plural(invalid, 'unrecognised entry')} before exporting so the cutting sheet is complete.`;
  }
  function add() {
    const section = P.addSection(project);
    renderEditors();
    renderOutput();
    save();
    editors.get(section.id).name.focus();
  }
  $('add-section').addEventListener('click', add);
  $('add-first-section').addEventListener('click', add);
  $('project-name').value = project.name;
  $('project-name').addEventListener('input', event => { project.name = event.target.value; renderOutput(); save(); });
  for (const view of ['section', 'runner']) $('view-' + view).addEventListener('click', () => {
    project.view = view;
    renderOutput();
    save();
  });
  $('undo-delete').addEventListener('click', () => {
    if (!P.restoreSection(project, lastDeletion)) return;
    const id = lastDeletion.section.id;
    lastDeletion = null;
    $('deletion-notice').hidden = true;
    renderEditors();
    renderOutput();
    save();
    editors.get(id).name.focus();
  });
  function closeExport() {
    $('export-options').hidden = true;
    $('export-toggle').setAttribute('aria-expanded', 'false');
    $('export-toggle').focus();
  }
  $('export-toggle').addEventListener('click', () => {
    const open = $('export-options').hidden;
    $('export-options').hidden = !open;
    $('export-toggle').setAttribute('aria-expanded', String(open));
    if (open) {
      if (!exportChoiceMade) document.querySelector(`input[name="export-mode"][value="${project.view}"]`).checked = true;
      document.querySelector('input[name="export-mode"]:checked').focus();
    }
  });
  $('export-options').addEventListener('change', () => {
    exportChoiceMade = true;
    $('export-file').hidden = true;
    $('export-status').textContent = '';
  });
  $('export-cancel').addEventListener('click', closeExport);
  $('export-options').addEventListener('keydown', event => {
    if (event.key === 'Escape' && !exportBusy) closeExport();
  });
  $('export-options').addEventListener('submit', async event => {
    event.preventDefault();
    if (exportBusy || $('export-download').disabled) return;
    exportBusy = true;
    $('export-download').textContent = 'Creating PDF…';
    $('export-status').textContent = 'Preparing your cutting sheet…';
    $('export-options').setAttribute('aria-busy', 'true');
    renderOutput();
    const mode = document.querySelector('input[name="export-mode"]:checked').value;
    const pageCount = Number(document.querySelector('input[name="export-pages"]:checked').value);
    // Capture the current inputs, even if editing continues while the PDF is created.
    const snapshot = JSON.parse(JSON.stringify(project));
    try {
      const bytes = await window.PartsExport.createPDF(snapshot, mode, pageCount);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      if (exportURL) URL.revokeObjectURL(exportURL);
      exportURL = url;
      const link = $('export-file');
      link.href = url;
      link.download = window.PartsExport.fileName(snapshot, mode, pageCount);
      link.hidden = false;
      exportedData = JSON.stringify({ name: snapshot.name, sections: snapshot.sections });
      link.click();
      $('export-status').textContent = 'PDF ready. If the download does not start, use the save link below.';
    } catch (error) {
      $('export-status').textContent = `Could not create the PDF. ${error.message || 'Please try again.'}`;
    } finally {
      exportBusy = false;
      $('export-download').textContent = 'Download PDF';
      $('export-options').removeAttribute('aria-busy');
      renderOutput();
    }
  });
  // Colour theme: "auto" follows the device's light/dark setting; the choice stays in this browser.
  const THEME_KEY = 'runner-notes.theme';
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  let themeChoice = 'auto';
  try { themeChoice = localStorage.getItem(THEME_KEY) || 'auto'; } catch { /* storage unavailable: use auto */ }
  if (themeChoice === 'crimson') themeChoice = 'char'; // renamed theme; older saved choices carry over
  if (![...$('theme-select').options].some(option => option.value === themeChoice)) themeChoice = 'auto';
  function applyTheme() {
    document.documentElement.dataset.theme = themeChoice === 'auto' ? (darkQuery.matches ? 'dark' : 'light') : themeChoice;
    document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.body).backgroundColor;
  }
  $('theme-select').value = themeChoice;
  $('theme-select').addEventListener('change', event => {
    themeChoice = event.target.value;
    try { localStorage.setItem(THEME_KEY, themeChoice); } catch { /* the theme still applies for this visit */ }
    applyTheme();
  });
  darkQuery.addEventListener('change', () => { if (themeChoice === 'auto') applyTheme(); });
  applyTheme();
  // Feedback is the app's only network request, and is sent only when the tester submits the form.
  const feedbackKey = (window.RunnerNotesConfig || {}).feedbackAccessKey;
  let feedbackBusy = false;
  $('feedback-open').addEventListener('click', () => {
    $('feedback-status').textContent = feedbackKey ? '' : 'Feedback is not connected yet. Add a Web3Forms access key in config.js.';
    $('feedback-dialog').showModal();
    $('feedback-message').focus();
  });
  $('feedback-close').addEventListener('click', () => $('feedback-dialog').close());
  $('feedback-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (feedbackBusy) return;
    const message = $('feedback-message').value.trim();
    const name = $('feedback-name').value.trim();
    const email = $('feedback-email').value.trim();
    if (!feedbackKey) { $('feedback-status').textContent = 'Feedback is not connected yet. Add a Web3Forms access key in config.js.'; return; }
    if (!message) { $('feedback-status').textContent = 'Write your feedback before sending.'; $('feedback-message').focus(); return; }
    if (!name) { $('feedback-status').textContent = 'Enter your name before sending.'; $('feedback-name').focus(); return; }
    // Stricter than the browser's own check: needs a name, an @, and a domain with a dot (you@example.com).
    if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,}$/i.test(email) || !$('feedback-email').checkValidity()) {
      $('feedback-status').textContent = 'Enter a valid email address, like you@example.com.'; $('feedback-email').focus(); return;
    }
    feedbackBusy = true;
    $('feedback-send').disabled = true;
    $('feedback-status').textContent = 'Sending…';
    const payload = {
      access_key: feedbackKey,
      subject: `Runner Order feedback${project.name.trim() ? ` · ${project.name.trim()}` : ''}`,
      from_name: name,
      email,
      message,
      botcheck: $('feedback-form').elements.botcheck.checked,
      page: location.href,
      browser: navigator.userAgent
    };
    if ($('feedback-project').checked) payload.project = L.projectFile(project);
    try {
      const response = await fetch('https://api.web3forms.com/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.message);
      $('feedback-form').reset();
      $('feedback-status').textContent = 'Thanks! Your feedback was sent.';
    } catch {
      $('feedback-status').textContent = 'Could not send your feedback. Check your connection and try again.';
    } finally {
      feedbackBusy = false;
      $('feedback-send').disabled = false;
    }
  });
  renderProjects();
  renderEditors();
  renderOutput();
  // Do not overwrite unreadable saved data during initialisation.
  if (loaded.error) {
    warnStorage(loaded.error);
    $('save-status').textContent = 'Storage needs attention';
  }
})();
