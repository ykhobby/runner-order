const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../dist/parts.js');

test('parses mixed case, spaces, commas, and newlines; sorts numbers naturally', () => {
  const result = P.parseParts('a15 A16, b12\nA3 F16\tA7 A22');
  assert.deepEqual(result.invalid, []);
  assert.deepEqual(P.groupParts(result.parts).map(group => [group.runner, group.parts.map(p => p.number)]),
    [['A', [3, 7, 15, 16, 22]], ['B', [12]], ['F', [16]]]);
});

test('handles numeric runner formats and the documented compact-code ambiguity', () => {
  const result = P.parseParts('b1-12 B1 3 B1:7, a2 : 22 A2 - 1\nB112 AA9 Z0');
  assert.deepEqual(result.invalid, []);
  assert.deepEqual(result.parts, [
    { runner: 'B1', number: 12 }, { runner: 'B1', number: 3 }, { runner: 'B1', number: 7 },
    { runner: 'A2', number: 22 }, { runner: 'A2', number: 1 }, { runner: 'B', number: 112 },
    { runner: 'AA', number: 9 }, { runner: 'Z', number: 0 }
  ]);
  assert.equal(P.partLabel(result.parts[0]), 'B1-12');
  assert.equal(P.partLabel(result.parts[5]), 'B112');
});

test('naturally sorts A, A1, A2, A10, B, B1, B2, B10', () => {
  const parts = P.parseParts('B10-2 A10-1 B2:15 A2-22 A1-7 B1-3 A3 B2:3 B9').parts;
  assert.deepEqual(P.groupParts(parts).map(g => g.runner), ['A', 'A1', 'A2', 'A10', 'B', 'B1', 'B2', 'B10']);
  assert.deepEqual(P.groupParts(parts).find(g => g.runner === 'B2').parts.map(p => p.number), [3, 15]);
});

test('flags invalid entries, rejects unsafe numbers, and preserves each duplicate occurrence', () => {
  const result = P.parseParts('A3 A3, ??? A- B1:two 12 A1.5 1A3 A9007199254740992');
  assert.deepEqual(result.parts, [{ runner: 'A', number: 3 }, { runner: 'A', number: 3 }]);
  assert.deepEqual(result.invalid, ['???', 'A-', 'B1:two', '12', 'A1.5', '1A3', 'A9007199254740992']);
  assert.deepEqual(P.parseParts('  ,\n\t'), { parts: [], invalid: [] });
  assert.deepEqual(P.parseParts('A3, 12').invalid, ['12']);
});

test('adds, renames, reorders, deletes, and restores freely defined sections', () => {
  const project = P.createProject();
  const first = P.addSection(project);
  const second = P.addSection(project);
  assert.notEqual(first.id, second.id);
  first.name = 'Wing pack';
  second.name = 'Accessories';
  assert.equal(P.sectionName(first), 'Wing pack');
  assert.equal(P.moveSection(project, second.id, -1), true);
  assert.deepEqual(project.sections.map(s => s.name), ['Accessories', 'Wing pack']);
  assert.equal(P.moveSection(project, second.id, -1), false);
  assert.equal(P.moveSection(project, 'missing', 1), false);
  assert.equal(P.moveSection(project, first.id, 1), false);
  const deletion = P.deleteSection(project, second.id);
  assert.deepEqual(project.sections.map(s => s.name), ['Wing pack']);
  assert.equal(P.restoreSection(project, deletion), true);
  assert.equal(P.restoreSection(project, deletion), false);
  assert.deepEqual(project.sections.map(s => s.name), ['Accessories', 'Wing pack']);
  assert.equal(P.deleteSection(project, 'missing'), null);
});

test('runner mode combines sections, keeps sources, and keeps section order for equal part numbers', () => {
  const project = P.createProject();
  const first = P.addSection(project);
  const second = P.addSection(project);
  first.name = 'Custom assembly'; first.raw = 'A15 A3 B12';
  second.name = '  '; second.raw = 'A3 A7 B2';
  const a = P.groupParts(P.projectParts(project))[0];
  assert.deepEqual(a.parts.map(p => [P.partLabel(p), p.sectionName]), [
    ['A3', 'Custom assembly'], ['A3', 'Untitled section'], ['A7', 'Untitled section'], ['A15', 'Custom assembly']
  ]);
  assert.equal(first.raw, 'A15 A3 B12');
});

function memoryStorage() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}
test('saves and restores project name, section names, order, exact original text, and selected view', () => {
  const storage = memoryStorage();
  const project = P.createProject();
  project.name = 'My build'; project.view = 'runner';
  const first = P.addSection(project); first.name = 'Custom 1'; first.raw = ' a15,\nB1 12  ??? ';
  const second = P.addSection(project); second.name = 'Custom 2';
  P.moveSection(project, second.id, -1);
  assert.equal(P.saveProject(storage, project), true);
  assert.deepEqual(P.loadProject(storage), { project, error: null });
  assert.deepEqual(P.loadProject(memoryStorage()), { project: P.createProject(), error: null });
});

test('handles unavailable storage, corrupted saved JSON, and invalid or duplicate section records', () => {
  const storage = memoryStorage();
  storage.setItem(P.STORAGE_KEY, '{broken');
  assert.ok(P.loadProject(storage).error);
  assert.equal(storage.getItem(P.STORAGE_KEY), '{broken');
  assert.ok(P.loadProject(null).error);
  assert.equal(P.saveProject({ setItem() { throw new Error('Quota'); } }, P.createProject()), false);
  for (const value of [null, {}, { ...P.createProject(), view: 'other' },
    { ...P.createProject(), sections: [{ id: 'x', name: 'x', raw: 1 }] },
    { ...P.createProject(), sections: [{ id: 'x', name: 'x', raw: '' }, { id: 'x', name: 'y', raw: '' }] }]) {
    assert.equal(P.validateProject(value), false);
  }
});
