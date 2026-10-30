/* Community library UI: sign-in, cloud saves, the New project pre-check, sharing, browsing and moderation.
   Everything stays hidden until config.js has Supabase settings. User content is inserted as text, never HTML. */
(() => {
  'use strict';
  const config = window.RunnerNotesConfig || {};
  const C = window.Cloud;
  const P = window.Parts;
  const L = window.Projects;
  const App = window.RunnerApp;
  const $ = id => document.getElementById(id);
  // Loaded from the CDN at an exact version, and only when the community features are switched on.
  const SUPABASE_SRC = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
  window.RunnerCommunity = { startNew: () => false };
  if (!config.supabaseUrl || !config.supabaseAnonKey || !C || !App) return;

  let cloud = null;
  let cloudError = 'The community library is offline right now. Your projects in this browser still work.';
  let user = null;
  let profile = null;
  let syncedFor = null;
  let brands = C.BRANDS;
  const K = window.Catalogue;
  const Picker = window.KitPicker;
  // Product code -> number of shared parts lists, used to label catalogue kits.
  let codeCounts = new Map();
  const listsFor = entry => (entry.codeKey && codeCounts.get(entry.codeKey)) || 0;
  const listsLabel = count => count ? plural(count, 'parts list') : 'No parts list yet';

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(label, className, onClick) {
    const node = element('button', className, label);
    node.type = 'button';
    if (onClick) node.addEventListener('click', onClick);
    return node;
  }
  const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
  function debounce(callback, wait) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => callback(...args), wait); };
  }
  const status = message => { $('project-status').textContent = message; };
  const track = (name, title) => window.RunnerAnalytics && window.RunnerAnalytics.event(name, title);
  const emailPattern = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,}$/i;
  const uuidIn = value => (String(value).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) || [])[0];

  const ready = new Promise(resolve => {
    const script = document.createElement('script');
    script.src = SUPABASE_SRC;
    script.onload = () => {
      try { cloud = C.createCloud(config, window.supabase); } catch { cloud = null; }
      resolve(cloud);
    };
    script.onerror = () => resolve(null);
    document.head.append(script);
  });

  // ---------------------------------------------------------------- shared UI
  for (const close of document.querySelectorAll('dialog [data-close]')) close.addEventListener('click', () => close.closest('dialog').close());
  function fillSelect(select, options, anyLabel) {
    const current = select.value;
    select.replaceChildren();
    if (anyLabel) select.append(Object.assign(element('option', '', anyLabel), { value: '' }));
    for (const [value, label] of options) select.append(Object.assign(element('option', '', label), { value }));
    if ([...select.options].some(option => option.value === current)) select.value = current;
  }
  function fillBrandsAndScales() {
    const brandOptions = brands.map(brand => [brand.slug, brand.name]);
    fillSelect($('precheck-brand'), brandOptions, 'Any brand');
    fillSelect($('share-brand'), brandOptions);
    fillSelect($('precheck-scale'), C.SCALES, 'Any scale');
    fillSelect($('share-scale'), C.SCALES);
  }
  // A small yes/no (or text) question, answered in the page rather than a browser pop-up.
  function ask(message, { title = 'Are you sure?', yes = 'Yes', no = 'Cancel', input = null } = {}) {
    const dialog = $('ask-dialog');
    $('ask-heading').textContent = title;
    $('ask-message').textContent = message;
    $('ask-yes').textContent = yes;
    $('ask-no').textContent = no;
    $('ask-input-field').hidden = !input;
    if (input) { $('ask-input-label').textContent = input.label; $('ask-input').value = input.value || ''; }
    dialog.returnValue = '';
    dialog.showModal();
    (input ? $('ask-input') : $('ask-no')).focus();
    return new Promise(resolve => dialog.addEventListener('close', () => {
      const confirmed = dialog.returnValue === 'yes';
      resolve(input ? (confirmed ? $('ask-input').value.trim() : null) : confirmed);
    }, { once: true }));
  }
  function kitStats(kit) {
    const parts = [plural(kit.part_count, 'part'), plural(kit.confirmations_count || 0, 'confirmation')];
    if (kit.owner_name) parts.push(`shared by ${kit.owner_name}`);
    return parts.join(' · ');
  }
  function kitResult(kit, actions) {
    const item = element('li', 'kit-result');
    const text = element('div', 'kit-result-text');
    const title = element('a', 'kit-result-title', kit.title);
    title.href = `#/kits/${kit.id}`;
    text.append(title, element('p', 'kit-meta', C.kitMeta(kit, brands)), element('p', 'kit-stats', kitStats(kit)));
    if (kit.exact_code) text.prepend(element('span', 'exact-badge', 'Exact match'));
    const buttons = element('div', 'kit-result-actions');
    buttons.append(...actions);
    item.append(text, buttons);
    return item;
  }

  // ---------------------------------------------------------------- accounts
  $('account').hidden = false;
  $('site-nav').hidden = false;
  $('share-kit').hidden = false;
  $('footer-legal').hidden = false;
  $('footer-storage').textContent = 'Projects are saved in this browser · Sign in to keep them on every device';
  fillBrandsAndScales();

  function renderAccount() {
    $('footer-storage').textContent = user ? 'Signed in · Saved projects sync to your account'
      : 'Projects are saved in this browser · Sign in to keep them on every device';
    $('sign-in-open').hidden = !!user;
    $('account-menu').hidden = !user;
    $('account-name').textContent = user ? (profile && profile.display_name) || user.email || 'Account' : 'Account';
    $('admin-link').hidden = !(profile && profile.is_admin);
  }
  function openSignIn(reason) {
    $('sign-in-reason').textContent = reason || 'Sign in to keep your projects on every device and share kits with the community.';
    $('sign-in-status').textContent = cloud ? '' : cloudError;
    $('sign-in-dialog').showModal();
  }
  $('sign-in-open').addEventListener('click', () => openSignIn());
  $('sign-in-google').addEventListener('click', async () => {
    if (!(await ready)) { $('sign-in-status').textContent = cloudError; return; }
    $('sign-in-status').textContent = 'Opening Google…';
    try { await cloud.signInWithGoogle(); } catch (error) { $('sign-in-status').textContent = error.message; }
  });
  $('sign-in-email-form').addEventListener('submit', async event => {
    event.preventDefault();
    const email = $('sign-in-email').value.trim();
    if (!emailPattern.test(email)) { $('sign-in-status').textContent = 'Enter a valid email address, like you@example.com.'; $('sign-in-email').focus(); return; }
    if (!(await ready)) { $('sign-in-status').textContent = cloudError; return; }
    $('sign-in-email-send').disabled = true;
    $('sign-in-status').textContent = 'Sending…';
    try {
      await cloud.signInWithEmail(email);
      $('sign-in-status').textContent = `Check your inbox: we sent a sign-in link to ${email}. Open it in this browser.`;
    } catch (error) {
      $('sign-in-status').textContent = `Could not send the link. ${error.message}`;
    } finally {
      $('sign-in-email-send').disabled = false;
    }
  });
  $('sign-out').addEventListener('click', async () => {
    $('account-menu').open = false;
    try { await cloud.signOut(); status('Signed out. Projects in this browser are still here.'); } catch (error) { status(error.message); }
  });
  $('rename-account').addEventListener('click', async () => {
    $('account-menu').open = false;
    const name = await ask('This is shown on kits you share.', { title: 'Display name', yes: 'Save', input: { label: 'Display name', value: profile && profile.display_name } });
    if (!name) return;
    try {
      await cloud.renameProfile(user.id, name.slice(0, 40));
      profile = { ...profile, display_name: name.slice(0, 40) };
      renderAccount();
    } catch (error) { status(error.message); }
  });
  $('delete-account').addEventListener('click', async () => {
    $('account-menu').open = false;
    const confirmed = await ask('Your account and its cloud copies of your projects will be deleted. Kits you shared stay in the library without your name. Projects saved in this browser are not affected.',
      { title: 'Delete your account?', yes: 'Delete account' });
    if (!confirmed) return;
    try {
      await cloud.deleteAccount();
      await cloud.signOut().catch(() => {});
      status('Your account was deleted. Projects in this browser are still here.');
    } catch (error) { status(`Could not delete your account. ${error.message}`); }
  });

  async function setUser(next) {
    const id = next ? next.id : null;
    if ((user ? user.id : null) === id) return;
    user = next;
    profile = null;
    syncedFor = null;
    renderAccount();
    if (!user) { route(); return; }
    $('sign-in-dialog').close();
    try { profile = await cloud.profile(user.id); } catch { profile = null; }
    renderAccount();
    // Remove the one-time sign-in code from the address once Supabase has used it.
    if (/[?&]code=/.test(location.search)) history.replaceState(null, '', location.pathname + location.hash);
    await pullProjects();
    route();
  }

  // ---------------------------------------------------------------- cloud saves
  const syncKey = () => `runner-notes.cloud.${user.id}`;
  function syncState() {
    try { return { linked: false, excluded: [], pushed: {}, ...JSON.parse(localStorage.getItem(syncKey()) || '{}') }; }
    catch { return { linked: false, excluded: [], pushed: {} }; }
  }
  function storeSync(state) { try { localStorage.setItem(syncKey(), JSON.stringify(state)); } catch { /* sync still works this visit */ } }
  const iso = value => new Date(value).toISOString();
  function syncMessage(result) {
    const parts = [];
    if (result.added.length) parts.push(`${plural(result.added.length, 'project')} added from your account`);
    if (result.updated.length) parts.push(`${plural(result.updated.length, 'project')} updated from another device`);
    let message = parts.length ? `Synced: ${parts.join(', ')}.` : 'Synced with your account.';
    if (result.conflicts.length) message += ` "${result.conflicts[0]}" changed on another device, but your open copy has unsaved edits, so it was kept. Save to upload your version.`;
    return message;
  }
  async function pullProjects() {
    let rows;
    try { rows = await cloud.listProjects(); } catch (error) { status(`Could not reach your cloud projects. ${error.message}`); return; }
    const preview = L.mergeCloud(JSON.parse(JSON.stringify(App.library())), rows);
    if (preview.added.length || preview.updated.length) App.projectAction(next => L.mergeCloud(next, rows), syncMessage);
    else if (preview.conflicts.length) status(syncMessage(preview));
    const state = syncState();
    const cloudIds = new Set(rows.map(row => row.id));
    for (const row of rows) state.pushed[row.id] = iso(row.updated_at);
    if (!state.linked) {
      const localOnly = App.library().projects.filter(entry => !cloudIds.has(entry.id));
      if (localOnly.length) {
        const names = localOnly.slice(0, 5).map(entry => entry.project.name).join(', ') + (localOnly.length > 5 ? '…' : '');
        const upload = await ask(`${names}. Uploading lets you open ${localOnly.length === 1 ? 'it' : 'them'} on any device where you sign in.`,
          { title: `Add ${plural(localOnly.length, 'project')} from this browser to your account?`, yes: 'Upload', no: 'Not now' });
        if (!upload) state.excluded = localOnly.map(entry => entry.id);
      }
      state.linked = true;
    }
    storeSync(state);
    syncedFor = user.id;
    await pushProjects();
  }
  let pushing = Promise.resolve();
  function pushProjects() {
    pushing = pushing.then(async () => {
      if (!user || syncedFor !== user.id) return;
      const state = syncState();
      const changed = App.library().projects.filter(entry => !state.excluded.includes(entry.id) && state.pushed[entry.id] !== entry.updatedAt);
      if (!changed.length) return;
      try {
        await cloud.uploadProjects(changed.map(L.projectRow));
        for (const entry of changed) state.pushed[entry.id] = entry.updatedAt;
        storeSync(state);
      } catch (error) {
        status(`Saved in this browser, but not uploaded to your account yet. ${error.message}`);
      }
    });
    return pushing;
  }
  App.onChange(() => { pushProjects(); renderShareButton(); $('kit-hint').hidden = true; });

  // ---------------------------------------------------------------- New project: check the library first
  let precheckMode = 'new';
  let searchToken = 0;
  function openPrecheck(mode, query = '') {
    precheckMode = mode;
    $('precheck-query').value = query;
    $('precheck-brand').value = mode === 'new' ? 'bandai' : '';
    $('precheck-scale').value = '';
    $('precheck-line').value = '';
    $('precheck-scratch').textContent = mode === 'new' ? 'Start from scratch' : 'Keep my project';
    $('precheck-skip').hidden = mode !== 'new';
    $('precheck-results').replaceChildren();
    $('precheck-exact').hidden = true;
    $('precheck-dialog').showModal();
    $('precheck-query').focus();
    runPrecheck();
  }
  window.RunnerCommunity.startNew = () => { openPrecheck('new'); return true; };
  async function runPrecheck() {
    const query = $('precheck-query').value.trim();
    const token = ++searchToken;
    $('precheck-exact').hidden = true;
    if (query.length < 2) {
      $('precheck-results').replaceChildren();
      $('precheck-status').textContent = 'Type a kit name or product code to check the library.';
      return;
    }
    if (!(await ready) || !navigator.onLine) { $('precheck-status').textContent = 'Library unavailable offline. You can still start from scratch.'; return; }
    $('precheck-status').textContent = 'Checking the library…';
    let rows;
    try {
      rows = await cloud.searchKits({ query, brand: $('precheck-brand').value, scale: $('precheck-scale').value, line: $('precheck-line').value, limit: 8 });
    } catch {
      if (token === searchToken) $('precheck-status').textContent = 'Library unavailable right now. You can still start from scratch.';
      return;
    }
    if (token !== searchToken) return;
    // Matching Bandai catalogue kits that aren't already covered by a shared parts list above.
    let catalogue = [];
    const brand = $('precheck-brand').value;
    if (Picker && (!brand || brand === 'bandai')) {
      try {
        const shown = new Set(rows.map(row => C.normaliseCode(row.product_code)).filter(Boolean));
        catalogue = K.searchCatalogue(await Picker.load(), query, { line: $('precheck-line').value, scale: $('precheck-scale').value, limit: 6 })
          .filter(entry => !shown.has(entry.codeKey));
      } catch { catalogue = []; }
      if (token !== searchToken) return;
    }
    $('precheck-exact').hidden = !rows.some(row => row.exact_code);
    $('precheck-status').textContent = rows.length || catalogue.length
      ? [rows.length && `${plural(rows.length, 'shared parts list')}`, catalogue.length && `${plural(catalogue.length, 'catalogue kit')}`].filter(Boolean).join(' and ') + '.'
      : 'No matches yet. Start from scratch, then share it when you\'re done so the next builder can skip the typing.';
    const seeLists = entry => { $('precheck-query').value = entry.code; runPrecheck(); };
    $('precheck-results').replaceChildren(...rows.map(kit => kitResult(kit, [
      button('Use this kit', 'button primary', () => useKit(kit.id)),
      button('Preview', 'button secondary', () => { $('precheck-dialog').close(); location.hash = `#/kits/${kit.id}`; })
    ])), ...(catalogue.length ? [element('li', 'results-heading', 'From the kit catalogue')] : []), ...catalogue.map(entry => catalogueResult(entry, seeLists, precheckMode !== 'new')));
  }
  const runPrecheckSoon = debounce(runPrecheck, 250);
  $('precheck-form').addEventListener('input', runPrecheckSoon);
  $('precheck-form').addEventListener('change', runPrecheckSoon);
  $('precheck-form').addEventListener('submit', event => { event.preventDefault(); runPrecheck(); });
  $('precheck-scratch').addEventListener('click', () => {
    $('precheck-dialog').close();
    if (precheckMode !== 'new') return;
    const query = $('precheck-query').value.trim();
    // A query that is mostly digits is a product code, not a name.
    const isCode = /^[\d\s-]{5,}$/.test(query);
    const kit = { title: isCode ? '' : query, brand: $('precheck-brand').value || 'bandai', scale: $('precheck-scale').value,
      line: $('precheck-line').value.trim(), productCode: isCode ? query : '' };
    if (App.projectAction(next => {
      const saved = L.startNew(next);
      next.current.name = kit.title;
      next.current.kit = kit;
      return saved;
    }, saved => `${saved ? `Saved "${saved.project.name}". ` : ''}Your new project is ready. Share it when you're done so others can use it.`)) $('project-name').focus();
  });
  $('precheck-skip').addEventListener('click', () => {
    $('precheck-dialog').close();
    if (App.projectAction(next => L.startNew(next), saved => saved ? `Saved "${saved.project.name}". Your new project is ready.` : 'Your new project is ready.')) $('project-name').focus();
  });
  async function useKit(id) {
    let kit;
    try { kit = await cloud.kit(id); } catch (error) { status(error.message); }
    if (!kit) { status('That kit is no longer available.'); return; }
    $('precheck-dialog').close();
    const added = App.projectAction(next => L.importProject(next, C.projectFromKit(kit)),
      result => (track('kit-used', kit.title), `Added "${result.entry.project.name}" from the community library${result.saved ? ` and saved "${result.saved.project.name}"` : ''}.`));
    if (added) location.hash = '';
  }

  // A gentle hint for people who skipped the check: shown while an empty project's name matches a shared kit.
  // A kit picked from the catalogue is matched by product code; anything else by name.
  const checkName = debounce(async () => {
    const name = App.project().name.trim();
    if (name.length < 3 || P.projectParts(App.project()).length || !cloud) { $('kit-hint').hidden = true; return; }
    const kit = App.project().kit || {};
    const count = kit.productCode ? codeCounts.get(C.normaliseCode(kit.productCode)) || 0 : 0;
    if (count) {
      $('kit-hint-text').textContent = `${plural(count, 'community parts list')} already ${count === 1 ? 'exists' : 'exist'} for this kit.`;
      $('kit-hint-open').dataset.query = kit.productCode;
      $('kit-hint').hidden = false;
      return;
    }
    try {
      const rows = await cloud.searchKits({ query: name, limit: 3 });
      $('kit-hint-text').textContent = 'This kit may already be in the community library.';
      $('kit-hint-open').dataset.query = name;
      $('kit-hint').hidden = !rows.length || App.project().name.trim() !== name;
    } catch { $('kit-hint').hidden = true; }
  }, 600);
  $('project-name').addEventListener('input', checkName);
  $('kit-hint-open').addEventListener('click', () => openPrecheck('hint', $('kit-hint-open').dataset.query || App.project().name.trim()));
  // A catalogue kit becomes a new project (from New project) or fills in the open one (from the hint).
  function startFromEntry(entry, fromHint) {
    $('precheck-dialog').close();
    const name = K.projectName(entry);
    if (App.projectAction(next => {
      const saved = fromHint ? null : L.startNew(next);
      next.current.name = name;
      next.current.kit = { ...(fromHint && next.current.kit || {}), ...K.kitFromEntry(entry) };
      return saved;
    }, saved => `${saved ? `Saved "${saved.project.name}". ` : ''}Started ${name}. Share it when you're done so the next builder can skip the typing.`)) {
      location.hash = '';
      $('project-name').focus();
    }
  }
  function catalogueResult(entry, onLists, fromHint = false) {
    const count = listsFor(entry);
    const item = element('li', 'kit-result catalogue-result');
    const text = element('div', 'kit-result-text');
    text.append(element('p', 'kit-result-title', K.projectName(entry)), element('p', 'kit-meta', K.entryMeta(entry)),
      element('p', `kit-stats${count ? ' has-list' : ''}`, [listsLabel(count), entry.code && `Product code ${entry.code}`].filter(Boolean).join(' · ')));
    const actions = element('div', 'kit-result-actions');
    actions.append(count ? button(count === 1 ? 'See parts list' : 'See parts lists', 'button primary', () => onLists(entry))
      : button(fromHint ? 'Use these details' : 'Start this kit', 'button secondary', () => startFromEntry(entry, fromHint)));
    item.append(text, actions);
    return item;
  }

  // ---------------------------------------------------------------- Share to community
  let shareDetails = null;
  function renderShareButton() {
    $('share-kit').textContent = C.kitDetails(App.project()).sharedKitId ? 'Update shared kit' : 'Share to community';
  }
  function showShareStep(step) {
    $('share-duplicates').hidden = step !== 'duplicates';
    $('share-form').hidden = step !== 'form';
    $('share-done').hidden = step !== 'done';
  }
  function fillShareForm(details) {
    $('share-title').value = details.title;
    $('share-brand').value = brands.some(brand => brand.slug === details.brand) ? details.brand : 'other';
    $('share-brand-other').value = details.brand === 'other' || !brands.some(brand => brand.slug === details.brand) ? details.brandOther || details.brand : '';
    $('share-brand-other-field').hidden = $('share-brand').value !== 'other';
    $('share-scale').value = C.SCALES.some(([value]) => value === details.scale) ? details.scale : '1/144';
    $('share-line').value = details.line;
    $('share-series').value = details.series;
    $('share-code').value = details.productCode;
    $('share-notes').value = details.notes;
    $('share-licence').checked = false;
    $('share-status').textContent = '';
    $('share-submit').textContent = details.sharedKitId ? 'Update shared kit' : 'Share kit';
  }
  $('share-brand').addEventListener('change', () => { $('share-brand-other-field').hidden = $('share-brand').value !== 'other'; });
  $('share-kit').addEventListener('click', async () => {
    const project = App.project();
    const invalid = project.sections.reduce((sum, section) => sum + P.parseParts(section.raw).invalid.length, 0);
    if (!P.projectParts(project).length) { status('Add some parts before sharing.'); return; }
    if (invalid) { status('Check unrecognised entries before sharing.'); return; }
    if (!(await ready)) { status(cloudError); return; }
    if (!user) { openSignIn('Sign in to share kits with the community. Your project stays in this browser while you do.'); return; }
    shareDetails = C.kitDetails(project);
    fillShareForm(shareDetails);
    let similar = [];
    if (!shareDetails.sharedKitId) {
      try {
        similar = await cloud.searchKits({ query: shareDetails.productCode || shareDetails.title, limit: 5 });
      } catch { similar = []; }
    }
    $('share-duplicate-list').replaceChildren(...similar.map(kit => kitResult(kit, [
      button('Confirm this kit instead', 'button secondary', async event => {
        try { await cloud.confirmKit(kit.id); } catch (error) { if (!/duplicate/i.test(error.message)) { status(error.message); return; } }
        event.target.replaceWith(element('span', 'kit-confirmed', 'Confirmed. Thanks!'));
      })
    ])));
    showShareStep(similar.length ? 'duplicates' : 'form');
    $('share-dialog').showModal();
  });
  $('share-anyway').addEventListener('click', () => { showShareStep('form'); $('share-title').focus(); });
  $('share-form').addEventListener('submit', async event => {
    event.preventDefault();
    const details = { ...shareDetails, title: $('share-title').value.trim(), brand: $('share-brand').value, brandOther: $('share-brand-other').value.trim(),
      scale: $('share-scale').value, line: $('share-line').value.trim(), series: $('share-series').value.trim(),
      productCode: $('share-code').value.trim(), notes: $('share-notes').value.trim() };
    const errors = C.validateKitDetails(details);
    if (Object.keys(errors).length) { $('share-status').textContent = Object.values(errors)[0]; return; }
    if (!$('share-licence').checked) { $('share-status').textContent = 'Tick the box to agree the part list is free for anyone to use.'; return; }
    let row;
    try { row = C.kitFromProject(App.project(), details); } catch (error) { $('share-status').textContent = error.message; return; }
    if (!details.sharedKitId && details.sourceKitId) row.forked_from = details.sourceKitId;
    $('share-submit').disabled = true;
    $('share-status').textContent = 'Sharing…';
    let id;
    try { id = await cloud.shareKit(row, details.sharedKitId); }
    catch (error) { $('share-status').textContent = `Could not share the kit. ${error.message}`; return; }
    finally { $('share-submit').disabled = false; }
    const kit = { title: details.title, brand: details.brand, brandOther: details.brandOther, scale: details.scale, line: details.line,
      series: details.series, productCode: details.productCode, notes: details.notes, sharedKitId: id, sourceKitId: details.sourceKitId };
    const saved = App.projectAction(next => {
      next.current.kit = kit;
      if (!next.current.name.trim()) next.current.name = details.title;
      return L.saveCurrent(next);
    }, () => `Shared "${details.title}" to the community library.`);
    track(details.sharedKitId ? 'kit-updated' : 'kit-shared', details.title);
    if (!saved) App.project().kit = kit;
    loadCounts();
    $('share-done-message').textContent = `"${details.title}" is in the community library. Anyone can now find it, use it, and print a cutting sheet.`;
    $('share-done-view').href = `#/kits/${id}`;
    $('share-done-copy').dataset.link = C.kitLink(id, location.href);
    showShareStep('done');
  });
  $('share-done-view').addEventListener('click', () => $('share-dialog').close());
  async function copyLink(link, target) {
    try { await navigator.clipboard.writeText(link); target.textContent = 'Link copied'; }
    catch { target.textContent = 'Copy failed'; }
    setTimeout(() => { target.textContent = 'Copy link'; }, 2000);
  }
  $('share-done-copy').addEventListener('click', event => copyLink(event.target.dataset.link, event.target));

  // ---------------------------------------------------------------- pages: #/kits, #/kits/<id>, #/admin
  const page = $('community');
  const libraryState = { query: '', brand: '', scale: '', line: '', sort: 'relevance', offset: 0, rows: [], done: false };
  let renderToken = 0;
  function route() {
    const target = C.parseRoute(location.hash);
    const onCommunity = target.page !== 'workbench';
    const changedPage = page.hidden === onCommunity;
    $('workbench').hidden = onCommunity;
    page.hidden = !onCommunity;
    for (const [link, active] of [[$('nav-workbench'), !onCommunity], [$('nav-kits'), onCommunity && target.page !== 'catalogue'], [$('nav-catalogue'), target.page === 'catalogue']]) {
      if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    }
    if (!onCommunity) return;
    if (window.RunnerAnalytics) window.RunnerAnalytics.page(`/${target.page === 'kit' ? 'kits/kit' : target.page}`);
    if (changedPage || target.page !== 'kits') window.scrollTo(0, 0);
    const token = ++renderToken;
    if (target.page === 'kits') renderLibrary(token);
    else if (target.page === 'kit') renderKit(target.id, token);
    else if (target.page === 'catalogue') renderCatalogue(token);
    else renderAdmin(token);
  }
  window.addEventListener('hashchange', route);
  function pageHeading(eyebrow, title, intro) {
    const head = element('div', 'community-head');
    const text = element('div');
    text.append(element('p', 'eyebrow', eyebrow), element('h2', '', title));
    head.append(text);
    if (intro) head.append(element('p', 'pane-description', intro));
    return head;
  }
  function offline(token, message) {
    if (token !== renderToken) return;
    page.replaceChildren(pageHeading('Community', 'Community kits'), element('p', 'output-warning', message || cloudError));
  }

  async function renderLibrary(token) {
    if (!(await ready)) { offline(token); return; }
    if (token !== renderToken) return;
    const form = element('form', 'library-filters');
    form.noValidate = true;
    const field = (label, control, wide) => {
      const wrap = element('div', `field${wide ? ' wide' : ''}`);
      const name = element('label', '', label);
      name.htmlFor = control.id;
      wrap.append(name, control);
      return wrap;
    };
    const search = Object.assign(element('input'), { id: 'library-query', type: 'search', placeholder: 'Kit name or product code', value: libraryState.query, autocomplete: 'off' });
    const brand = Object.assign(element('select'), { id: 'library-brand' });
    fillSelect(brand, brands.map(item => [item.slug, item.name]), 'Any brand');
    brand.value = libraryState.brand;
    const scale = Object.assign(element('select'), { id: 'library-scale' });
    fillSelect(scale, C.SCALES, 'Any scale');
    scale.value = libraryState.scale;
    const line = Object.assign(element('input'), { id: 'library-line', placeholder: 'Any line', value: libraryState.line, autocomplete: 'off' });
    line.setAttribute('list', 'line-options');
    const sort = Object.assign(element('select'), { id: 'library-sort' });
    fillSelect(sort, [['relevance', 'Best match'], ['newest', 'Newest'], ['confirmed', 'Most confirmed']]);
    sort.value = libraryState.sort;
    form.append(field('Search', search, true), field('Brand', brand), field('Scale', scale), field('Line', line), field('Sort', sort));
    const message = element('p', 'export-status');
    message.setAttribute('role', 'status');
    const grid = element('ul', 'kit-grid');
    const more = button('Load more', 'button secondary load-more', () => load(false));
    const toCatalogue = element('a', 'back-link', 'Browse every Bandai kit in the catalogue →');
    toCatalogue.href = '#/catalogue';
    page.replaceChildren(pageHeading('Community', 'Community kits', 'Kits typed in by other builders. Use one to skip the typing, then print your cutting sheet.'), form, message, grid, more, toCatalogue);
    async function load(reset) {
      if (reset) Object.assign(libraryState, { query: search.value.trim(), brand: brand.value, scale: scale.value, line: line.value.trim(), sort: sort.value, offset: 0, rows: [], done: false });
      const mine = ++renderToken;
      message.textContent = 'Loading kits…';
      more.hidden = true;
      let rows;
      try {
        rows = await cloud.searchKits({ ...libraryState, offset: libraryState.offset, limit: 30 });
      } catch (error) { if (mine === renderToken) message.textContent = `Could not load kits. ${error.message}`; return; }
      if (mine !== renderToken) return;
      libraryState.rows = libraryState.rows.concat(rows);
      libraryState.offset += rows.length;
      libraryState.done = rows.length < 30;
      paint();
    }
    function paint() {
      grid.replaceChildren(...libraryState.rows.map(kit => {
        const item = element('li');
        const card = element('a', 'kit-card');
        card.href = `#/kits/${kit.id}`;
        card.append(element('p', 'kit-meta', C.kitMeta(kit, brands)), element('h3', '', kit.title), element('p', 'kit-stats', kitStats(kit)));
        if (kit.exact_code) card.prepend(element('span', 'exact-badge', 'Exact match'));
        item.append(card);
        return item;
      }));
      const filtered = libraryState.query || libraryState.brand || libraryState.scale || libraryState.line;
      message.textContent = libraryState.rows.length ? `${plural(libraryState.rows.length, 'kit')}${libraryState.done ? '' : ' so far'}.`
        : filtered ? 'No kits match yet. If you build one, share it so the next builder can skip the typing.' : 'No kits shared yet. Be the first!';
      more.hidden = libraryState.done;
    }
    const reload = debounce(() => load(true), 300);
    form.addEventListener('input', reload);
    form.addEventListener('change', reload);
    form.addEventListener('submit', event => { event.preventDefault(); load(true); });
    if (libraryState.rows.length) paint(); else load(true);
  }

  async function renderKit(id, token) {
    if (!(await ready)) { offline(token); return; }
    page.replaceChildren(element('p', 'export-status', 'Loading kit…'));
    let kit;
    try { kit = await cloud.kit(id); } catch (error) { offline(token, `Could not load this kit. ${error.message}`); return; }
    if (token !== renderToken) return;
    const back = element('a', 'back-link', '← Community kits');
    back.href = '#/kits';
    if (!kit) { page.replaceChildren(back, pageHeading('Community', 'Kit not found', 'It may have been removed, or the link is incomplete.')); return; }
    const preview = C.projectFromKit(kit);
    const head = pageHeading(C.kitMeta(kit, brands), kit.title);
    head.classList.add('kit-head');
    head.append(element('p', 'kit-stats', kitStats(kit)));
    if (kit.series || kit.product_code) head.append(element('p', 'kit-meta', [kit.series, kit.product_code && `Product code ${kit.product_code}`].filter(Boolean).join(' · ')));
    if (kit.notes) head.append(element('p', 'kit-notes', kit.notes));
    const notices = [];
    if (kit.status !== 'published') notices.push(element('p', 'output-warning', kit.status === 'hidden' ? 'Hidden from the library while reports are reviewed.' : 'Removed from the library.'));

    const actions = element('div', 'kit-actions');
    const confirm = button('I built this, it\'s accurate', 'button secondary');
    let confirmed = false;
    const renderConfirm = () => {
      confirm.textContent = confirmed ? 'Confirmed ✓' : 'I built this, it\'s accurate';
      confirm.setAttribute('aria-pressed', String(confirmed));
    };
    if (user) cloud.confirmed(kit.id, user.id).then(value => { confirmed = value; renderConfirm(); }).catch(() => {});
    confirm.addEventListener('click', async () => {
      if (!user) { openSignIn('Sign in to confirm kits you have built.'); return; }
      try {
        if (confirmed) await cloud.unconfirmKit(kit.id, user.id); else await cloud.confirmKit(kit.id);
        confirmed = !confirmed;
        kit.confirmations_count += confirmed ? 1 : -1;
        renderConfirm();
        head.querySelector('.kit-stats').textContent = kitStats(kit);
      } catch (error) { status(error.message); }
    });
    const copy = button('Copy link', 'button secondary', event => copyLink(C.kitLink(kit.id, location.href), event.target));
    const report = button('Report', 'text-button', () => openReport(kit));
    actions.append(button('Use this kit', 'button primary', () => useKit(kit.id)), confirm, copy, report);

    const pdf = element('form', 'kit-pdf');
    const mode = Object.assign(element('select'), { id: 'kit-pdf-mode' });
    fillSelect(mode, [['section', 'By Section'], ['runner', 'By Runner'], ['both', 'Both']]);
    const pages = Object.assign(element('select'), { id: 'kit-pdf-pages' });
    fillSelect(pages, [['1', '1 page'], ['2', '2 pages'], ['3', '3 pages']]);
    const pdfStatus = element('span', 'export-status');
    const modeLabel = Object.assign(element('label', 'sr-only', 'PDF layout'), { htmlFor: mode.id });
    const pagesLabel = Object.assign(element('label', 'sr-only', 'A4 pages'), { htmlFor: pages.id });
    const download = element('button', 'button secondary', 'Download PDF');
    download.type = 'submit';
    pdf.append(modeLabel, mode, pagesLabel, pages, download, pdfStatus);
    pdf.addEventListener('submit', async event => {
      event.preventDefault();
      download.disabled = true;
      pdfStatus.textContent = 'Creating PDF…';
      try {
        const bytes = await window.PartsExport.createPDF(preview, mode.value, Number(pages.value));
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        const link = Object.assign(element('a'), { href: url, download: window.PartsExport.fileName(preview, mode.value, Number(pages.value)) });
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        pdfStatus.textContent = '';
      } catch (error) { pdfStatus.textContent = `Could not create the PDF. ${error.message}`; }
      finally { download.disabled = false; }
    });

    const sheet = element('section', 'output-pane kit-sheet');
    const sheetHead = element('div', 'pane-heading');
    sheetHead.append(element('h3', '', 'Cutting list'), element('span', 'part-count', plural(kit.part_count, 'part')));
    const toggle = element('div', 'view-toggle');
    toggle.setAttribute('role', 'group');
    toggle.setAttribute('aria-label', 'Cutting list view');
    const list = element('div', 'kit-cutting-list');
    const views = [['section', 'By Section'], ['runner', 'By Runner']].map(([view, label]) => {
      const choice = button(label, '', () => { preview.view = view; paint(); });
      choice.dataset.view = view;
      return choice;
    });
    function paint() {
      for (const choice of views) choice.setAttribute('aria-pressed', String(choice.dataset.view === preview.view));
      list.replaceChildren(App.cuttingList(preview));
    }
    toggle.append(...views);
    sheet.append(sheetHead, toggle, list);
    paint();
    page.replaceChildren(back, head, ...notices, actions, pdf, sheet);
  }

  // The full Bandai catalogue, showing which kits already have a shared parts list.
  const catalogueState = { query: '', line: '', scale: '', lists: '', shown: 50 };
  async function renderCatalogue(token) {
    page.replaceChildren(pageHeading('Catalogue', 'Kit catalogue'), element('p', 'export-status', 'Loading the catalogue…'));
    let entries;
    try { entries = await Picker.load(); } catch (error) { offline(token, error.message); return; }
    await loadCounts();
    if (token !== renderToken) return;
    const form = element('form', 'library-filters');
    form.noValidate = true;
    const field = (label, control, wide) => {
      const wrap = element('div', `field${wide ? ' wide' : ''}`);
      wrap.append(Object.assign(element('label', '', label), { htmlFor: control.id }), control);
      return wrap;
    };
    const search = Object.assign(element('input'), { id: 'catalogue-query', type: 'search', placeholder: 'Kit name or product code', value: catalogueState.query, autocomplete: 'off' });
    const lineCounts = new Map();
    for (const entry of entries) if (entry.line) lineCounts.set(entry.line, (lineCounts.get(entry.line) || 0) + 1);
    const line = Object.assign(element('select'), { id: 'catalogue-line' });
    fillSelect(line, [...lineCounts].sort((a, b) => b[1] - a[1]).map(([value]) => [value, value]), 'Any grade');
    line.value = catalogueState.line;
    const scale = Object.assign(element('select'), { id: 'catalogue-scale' });
    fillSelect(scale, C.SCALES, 'Any scale');
    scale.value = catalogueState.scale;
    const lists = Object.assign(element('select'), { id: 'catalogue-lists' });
    fillSelect(lists, [['has', 'Has a parts list'], ['needs', 'Needs a parts list']], 'All kits');
    lists.value = catalogueState.lists;
    form.append(field('Search', search, true), field('Grade', line), field('Scale', scale), field('Parts list', lists));
    const message = element('p', 'export-status');
    message.setAttribute('role', 'status');
    const list = element('ul', 'kit-results');
    const more = button('Show more', 'button secondary load-more', () => { catalogueState.shown += 50; paint(); });
    const credit = element('p', 'legal-note');
    credit.append(document.createTextNode('Catalogue data from '), Object.assign(element('a', '', 'gunpla.fyi'), { href: 'https://gunpla.fyi', target: '_blank', rel: 'noopener noreferrer' }),
      document.createTextNode(', used with permission. Updated weekly.'));
    page.replaceChildren(pageHeading('Catalogue', 'Kit catalogue', `${entries.length.toLocaleString('en')} Bandai kits. See which ones already have a parts list, or be the first to add one.`),
      form, message, list, more, credit);
    const viewLists = entry => { Object.assign(libraryState, { query: entry.code, brand: '', scale: '', line: '', rows: [], offset: 0 }); location.hash = '#/kits'; };
    function matches() {
      const query = catalogueState.query;
      const found = query ? K.searchCatalogue(entries, query, { line: catalogueState.line, scale: catalogueState.scale, limit: entries.length })
        : entries.filter(entry => (!catalogueState.line || entry.line === catalogueState.line) && (!catalogueState.scale || entry.scale === catalogueState.scale));
      if (catalogueState.lists === 'has') return found.filter(listsFor);
      if (catalogueState.lists === 'needs') return found.filter(entry => !listsFor(entry));
      return found;
    }
    function paint() {
      const found = matches();
      list.replaceChildren(...found.slice(0, catalogueState.shown).map(entry => catalogueResult(entry, viewLists)));
      message.textContent = found.length ? `${plural(found.length, 'kit')}${found.length > catalogueState.shown ? `, showing ${catalogueState.shown}` : ''}.` : 'No kits match.';
      more.hidden = found.length <= catalogueState.shown;
    }
    const update = debounce(() => {
      Object.assign(catalogueState, { query: search.value.trim(), line: line.value, scale: scale.value, lists: lists.value, shown: 50 });
      paint();
    }, 200);
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    form.addEventListener('submit', event => { event.preventDefault(); update(); });
    paint();
  }

  async function loadCounts() {
    if (!(await ready)) return;
    try { codeCounts = await cloud.kitCodeCounts(); } catch { return; }
    if (Picker) Picker.setStatus(entry => entry.codeKey ? listsLabel(listsFor(entry)) : '');
  }

  // Reports
  let reportKit = null;
  $('report-reasons').append(...C.REPORT_REASONS.map(([value, label], index) => {
    const option = element('label', 'report-reason');
    const input = Object.assign(element('input'), { type: 'radio', name: 'report-reason', value, checked: index === 0 });
    option.append(input, document.createTextNode(` ${label}`));
    return option;
  }));
  function openReport(kit) {
    if (!user) { openSignIn('Sign in to report a kit.'); return; }
    reportKit = kit;
    $('report-details').value = '';
    $('report-status').textContent = '';
    $('report-submit').disabled = false;
    $('report-dialog').showModal();
  }
  $('report-form').addEventListener('submit', async event => {
    event.preventDefault();
    const reason = document.querySelector('input[name="report-reason"]:checked').value;
    $('report-submit').disabled = true;
    try {
      await cloud.reportKit(reportKit.id, reason, $('report-details').value);
      $('report-status').textContent = 'Thanks. The report was sent.';
      setTimeout(() => $('report-dialog').close(), 1200);
    } catch (error) {
      $('report-status').textContent = /duplicate/i.test(error.message) ? 'You have already reported this kit.' : `Could not send the report. ${error.message}`;
      $('report-submit').disabled = false;
    }
  });

  // Admin: reported and hidden kits, merging duplicates, and promoting typed-in brands.
  async function renderAdmin(token) {
    if (!(await ready)) { offline(token); return; }
    if (token !== renderToken) return;
    if (!profile || !profile.is_admin) {
      page.replaceChildren(pageHeading('Community', 'Admin', user ? 'This page is for library admins.' : 'Sign in with an admin account to review reports.'));
      return;
    }
    const flaggedList = element('ul', 'kit-results');
    const merge = element('form', 'kit-form admin-merge');
    const duplicate = Object.assign(element('input'), { id: 'merge-duplicate', placeholder: 'Duplicate kit link or ID', autocomplete: 'off' });
    const keep = Object.assign(element('input'), { id: 'merge-keep', placeholder: 'Kit to keep: link or ID', autocomplete: 'off' });
    const mergeStatus = element('p', 'export-status wide');
    const mergeButton = element('button', 'button primary', 'Merge');
    mergeButton.type = 'submit';
    const labelled = (label, control) => {
      const wrap = element('div', 'field');
      wrap.append(Object.assign(element('label', '', label), { htmlFor: control.id }), control);
      return wrap;
    };
    merge.append(labelled('Duplicate', duplicate), labelled('Keep', keep), mergeButton, mergeStatus);
    merge.addEventListener('submit', async event => {
      event.preventDefault();
      const from = uuidIn(duplicate.value), into = uuidIn(keep.value);
      if (!from || !into) { mergeStatus.textContent = 'Paste two kit links or IDs.'; return; }
      try { await cloud.mergeKits(from, into); mergeStatus.textContent = 'Merged. The duplicate now points to the kept kit.'; }
      catch (error) { mergeStatus.textContent = error.message; }
    });
    const brandList = element('ul', 'kit-results');
    page.replaceChildren(pageHeading('Community', 'Admin', 'Kits hide automatically after three reports. Restore the ones that are fine.'),
      element('h3', 'admin-heading', 'Reported and hidden kits'), flaggedList,
      element('h3', 'admin-heading', 'Merge duplicate kits'), merge,
      element('h3', 'admin-heading', 'Typed-in brands'), brandList);
    try {
      const flagged = await cloud.flaggedKits();
      flaggedList.replaceChildren(...(flagged.length ? flagged.map(kit => {
        const statusLine = `${kit.status} · ${plural(kit.reports_count, 'report')}`;
        const item = kitResult(kit, [
          button('Restore', 'button secondary', async () => { await cloud.setKitStatus(kit.id, 'published').catch(error => status(error.message)); renderAdmin(renderToken); }),
          button('Remove', 'button secondary', async () => { await cloud.setKitStatus(kit.id, 'removed').catch(error => status(error.message)); renderAdmin(renderToken); })
        ]);
        const detail = element('p', 'kit-stats', statusLine);
        item.querySelector('.kit-result-text').append(detail);
        cloud.kitReports(kit.id).then(reports => {
          if (reports.length) detail.textContent = `${statusLine}: ${reports.map(report => report.reason + (report.details ? ` ("${report.details}")` : '')).join(', ')}`;
        }).catch(() => {});
        return item;
      }) : [element('li', 'empty-section', 'Nothing to review.')]));
    } catch (error) { flaggedList.replaceChildren(element('li', 'output-warning', error.message)); }
    try {
      const counts = new Map();
      for (const row of await cloud.otherBrands()) {
        const name = String(row.brand_other || '').trim();
        if (!name) continue;
        const key = name.toLowerCase();
        counts.set(key, { name: (counts.get(key) || {}).name || name, count: ((counts.get(key) || {}).count || 0) + 1 });
      }
      brandList.replaceChildren(...(counts.size ? [...counts.values()].sort((a, b) => b.count - a.count).map(({ name, count }) => {
        const item = element('li', 'kit-result');
        item.append(element('div', 'kit-result-text', `${name} · ${plural(count, 'kit')}`),
          button('Add as a brand', 'button secondary', async () => {
            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
            try {
              const moved = await cloud.promoteBrand(name, slug, name);
              brands = await cloud.brands();
              fillBrandsAndScales();
              status(`Added ${name} as a brand and moved ${plural(moved, 'kit')}.`);
              renderAdmin(renderToken);
            } catch (error) { status(error.message); }
          }));
        return item;
      }) : [element('li', 'empty-section', 'No typed-in brands.')]));
    } catch (error) { brandList.replaceChildren(element('li', 'output-warning', error.message)); }
  }

  // ---------------------------------------------------------------- start
  renderAccount();
  renderShareButton();
  route();
  ready.then(async client => {
    if (!client) { $('sign-in-open').title = cloudError; return; }
    client.brands().then(list => { if (list.length) { brands = list; fillBrandsAndScales(); } }).catch(() => {});
    loadCounts();
    // Supabase recommends leaving its callback before doing more work with the client.
    client.onAuthChange((event, session) => setTimeout(() => setUser(session ? session.user : null), 0));
    try { const session = await client.session(); await setUser(session ? session.user : null); } catch { /* stay signed out */ }
  });
})();
