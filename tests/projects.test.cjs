const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../dist/parts.js');
const L = require('../dist/projects.js');
function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
function populated(name = 'Build A') {
  const library = L.createLibrary(); library.current.name = name;
  const section = P.addSection(library.current); section.name = 'Wing'; section.raw = ' a15,\nB1 12 ??? ';
  return library;
}
test('saves named inputs independently and updates the active saved project', () => {
  const library = populated();
  const first = L.saveCurrent(library);
  library.current.sections[0].raw = 'A3';
  assert.equal(first.project.sections[0].raw, ' a15,\nB1 12 ??? ');
  L.saveCurrent(library);
  assert.equal(library.projects.length, 1);
  assert.equal(first.project.sections[0].raw, 'A3');
  library.current.name = 'Renamed build'; L.saveCurrent(library);
  assert.equal(first.project.name, 'Renamed build');
});
test('new project preserves named and unnamed drafts, including invalid/raw text', () => {
  const library = populated(); const original = JSON.stringify(library.current);
  const saved = L.startNew(library);
  assert.equal(JSON.stringify(saved.project), original);
  assert.deepEqual(library.current, P.createProject());
  assert.equal(library.activeId, null);
  P.addSection(library.current).raw = 'B2-7';
  assert.equal(L.startNew(library).project.name, 'Untitled project');
  P.addSection(library.current).raw = 'B3-7';
  assert.equal(L.startNew(library).project.name, 'Untitled project 2');
});
test('opens previous projects, preserves edits when switching, and restores all state', () => {
  const library = populated(); const first = L.saveCurrent(library);
  L.startNew(library); library.current.name = 'Build B';
  P.addSection(library.current).raw = 'A7'; library.current.view = 'runner';
  const second = L.saveCurrent(library);
  library.current.sections[0].raw = 'A7 A8';
  L.openProject(library, first.id);
  assert.equal(library.current.name, 'Build A');
  assert.equal(library.current.sections[0].raw, ' a15,\nB1 12 ??? ');
  L.openProject(library, second.id);
  assert.equal(library.current.sections[0].raw, 'A7 A8');
  assert.equal(library.current.view, 'runner');
  assert.throws(() => L.openProject(library, 'missing'), /no longer available/);
});
test('does not overwrite another build with the same normalised name', () => {
  const library = populated('Build A'); L.saveCurrent(library); L.startNew(library);
  library.current.name = ' build a '; P.addSection(library.current).raw = 'A99';
  assert.throws(() => L.saveCurrent(library), /already exists/);
  assert.equal(library.projects.length, 1);
  assert.equal(library.current.sections[0].raw, 'A99');
  // Switching away saves the clashing draft under a numbered name; the original build is untouched.
  const saved = L.startNew(library);
  assert.equal(saved.project.name, 'build a (2)');
  assert.equal(library.projects.length, 2);
  assert.equal(library.projects[0].project.name, 'Build A');
  library.current.name = '';
  assert.throws(() => L.saveCurrent(library), /Enter a project name/);
});
test('migrates the old single-project draft and persists the full library across reloads', () => {
  const store = storage(); const legacy = populated().current;
  P.saveProject(store, legacy);
  const loaded = L.loadLibrary(store);
  assert.deepEqual(loaded.library.current, legacy);
  L.saveCurrent(loaded.library);
  assert.equal(L.saveLibrary(store, loaded.library), true);
  assert.deepEqual(L.loadLibrary(store), loaded);
  assert.deepEqual(P.loadProject(store).project, legacy);
});
test('handles missing, blocked, and corrupt storage without silently clearing stored data', () => {
  const store = storage();
  assert.deepEqual(L.loadLibrary(store), { library: L.createLibrary(), error: null });
  store.setItem(L.STORAGE_KEY, '{broken');
  assert.ok(L.loadLibrary(store).error);
  assert.equal(store.getItem(L.STORAGE_KEY), '{broken');
  assert.ok(L.loadLibrary(null).error);
  assert.equal(L.saveLibrary({ setItem() { throw new Error('Quota'); } }, L.createLibrary()), false);
  assert.equal(L.validateLibrary({ ...L.createLibrary(), activeId: 'missing' }), false);
});
test('exports and imports project files without overwriting existing builds', () => {
  const library = populated('Gus'); L.saveCurrent(library);
  const file = L.projectFile(library.current);
  assert.equal(JSON.parse(file).format, 'runner-notes.project');
  const imported = L.readProjectFile(file);
  assert.deepEqual(imported, library.current);
  const result = L.importProject(library, imported);
  assert.equal(result.entry.project.name, 'Gus (2)');
  assert.equal(library.projects.length, 2);
  assert.equal(library.current.sections[0].raw, ' a15,\nB1 12 ??? ');
  assert.equal(library.activeId, result.entry.id);
  assert.ok(L.validateLibrary(library));
  // A bare project (no wrapper) is accepted too.
  assert.equal(L.readProjectFile(JSON.stringify(imported)).name, 'Gus');
  assert.equal(L.projectFileName({ name: 'A/B: kit?' }), 'A-B- kit- - Runner Order project.json');
});
test('rejects files that are not valid project files', () => {
  assert.throws(() => L.readProjectFile('not json'), /not a Runner Order project/);
  assert.throws(() => L.readProjectFile('{"format":"runner-notes.project","version":1,"project":{}}'), /damaged/);
  assert.throws(() => L.readProjectFile('{"format":"runner-notes.project","version":2}'), /newer version/);
  assert.throws(() => L.readProjectFile('x'.repeat(6 * 1024 * 1024)), /too large/);
});
test('switching projects numbers a clashing name instead of blocking the switch', () => {
  const library = populated('MG Zaku II'); L.saveCurrent(library);
  L.startNew(library);
  library.current.name = 'mg zaku ii';
  const saved = L.startNew(library);
  assert.equal(saved.project.name, 'mg zaku ii (2)');
  assert.equal(library.projects.length, 2);
  library.current.name = 'MG Zaku II';
  assert.throws(() => L.saveCurrent(library), /already exists/, 'an explicit save still asks for a different name');
});
