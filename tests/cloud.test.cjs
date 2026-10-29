const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../dist/parts.js');
const L = require('../dist/projects.js');
const C = require('../dist/cloud.js');

function project(name = 'HG Zaku II') {
  const result = P.createProject(); result.name = name;
  const head = P.addSection(result); head.name = 'Head'; head.raw = 'A1 A2, B3';
  P.addSection(result).name = 'Empty for now';
  return result;
}
const details = { title: 'HG Zaku II', brand: 'bandai', scale: '1/144', line: 'HG', productCode: '5060661' };

test('title and product-code normalisation matches the database search', () => {
  // Same cases as tests/sql/rls.test.sql, so hints in the app agree with search_kits.
  for (const value of ['Zaku II', 'zaku-2', 'ZAKU  2']) assert.equal(C.normaliseTitle(value), 'zaku 2');
  assert.equal(C.normaliseTitle('Gundam Mk-II'), 'gundam mk 2');
  assert.equal(C.normaliseTitle('Gundam MkII'), 'gundam mk 2');
  assert.equal(C.normaliseTitle('RX-78-2 Gundam (Ver. 2.0)'), 'rx 78 2 gundam ver 2 0');
  assert.equal(C.normaliseTitle('V Gundam'), 'v gundam');
  assert.equal(C.normaliseCode(' 5060661 '), '5060661');
  assert.equal(C.normaliseCode('BAN-2468'), 'ban2468');
  assert.equal(C.normaliseCode(''), null);
});

test('shared kits are a frozen copy of named sections with parts', () => {
  const row = C.kitFromProject(project(), details);
  assert.deepEqual(row.sections, [{ name: 'Head', raw: 'A1 A2, B3' }]);
  assert.equal(row.part_count, 3);
  assert.equal(row.brand_other, null);
  assert.equal(row.series, null);
  assert.equal(row.product_code, '5060661');
  assert.ok(!('id' in row.sections[0]), 'section ids stay private');
});

test('sharing is blocked for unrecognised entries, empty projects and missing details', () => {
  const bad = project(); bad.sections[0].raw += ' ???';
  assert.throws(() => C.kitFromProject(bad, details), /unrecognised/);
  assert.throws(() => C.kitFromProject(P.createProject(), details), /Add some parts/);
  assert.throws(() => C.kitFromProject(project(), { ...details, title: 'x' }), /kit name/);
  assert.throws(() => C.kitFromProject(project(), { ...details, brand: 'other', brandOther: ' ' }), /brand name/);
  assert.throws(() => C.kitFromProject(project(), { ...details, scale: '1/12' }), /scale/);
  assert.equal(C.kitFromProject(project(), { ...details, brand: 'other', brandOther: 'Snail Shell' }).brand_other, 'Snail Shell');
});

test('"Use this kit" creates an editable project that remembers its source', () => {
  const copy = C.projectFromKit({ id: 'k1', title: 'HG Zaku II', brand: 'bandai', scale: '1/144', line: 'HG', product_code: '5060661',
    sections: [{ name: 'Head', raw: 'A1 A2' }, { name: 'Legs', raw: 'B1' }] });
  assert.ok(P.validateProject(copy));
  assert.deepEqual(copy.sections.map(section => [section.name, section.raw]), [['Head', 'A1 A2'], ['Legs', 'B1']]);
  assert.notEqual(copy.sections[0].id, copy.sections[1].id);
  assert.equal(copy.kit.sourceKitId, 'k1');
  assert.deepEqual(C.kitDetails(copy), { title: 'HG Zaku II', brand: 'bandai', brandOther: '', scale: '1/144', line: 'HG', series: '',
    productCode: '5060661', notes: '', sharedKitId: null, sourceKitId: 'k1' });
  // Old projects without kit details get sensible defaults.
  assert.equal(C.kitDetails(project('Old build')).title, 'Old build');
});

test('labels, links and routes', () => {
  assert.equal(C.kitMeta({ brand: 'bandai', scale: '1/144', line: 'HG' }), 'Bandai · 1/144 · HG');
  assert.equal(C.kitMeta({ brand: 'other', brand_other: 'Snail Shell', scale: 'non-scale' }), 'Snail Shell · Non-scale');
  const id = '10000000-0000-0000-0000-000000000001';
  assert.equal(C.kitLink(id, 'https://ykhobby.github.io/runner-order/#/kits'), `https://ykhobby.github.io/runner-order/#/kits/${id}`);
  assert.deepEqual(C.parseRoute(`#/kits/${id}`), { page: 'kit', id });
  assert.deepEqual(C.parseRoute('#/kits'), { page: 'kits' });
  assert.deepEqual(C.parseRoute('#/admin'), { page: 'admin' });
  assert.deepEqual(C.parseRoute('#/catalogue'), { page: 'catalogue' });
  assert.deepEqual(C.parseRoute('#workspace'), { page: 'workbench' });
  assert.deepEqual(C.parseRoute(''), { page: 'workbench' });
});

test('cloud merge adds new projects, takes newer copies and lists what to upload', () => {
  const library = L.createLibrary();
  library.current = project('Local only'); L.saveCurrent(library);
  library.current = project('Shared build'); library.activeId = null; const shared = L.saveCurrent(library);
  shared.updatedAt = '2026-10-01T00:00:00.000Z';
  library.current = P.createProject(); library.activeId = null;
  const newer = { ...project('Shared build'), sections: [{ id: 's1', name: 'Arms', raw: 'C1' }] };
  const result = L.mergeCloud(library, [
    { id: shared.id, name: 'Shared build', data: newer, updated_at: '2026-10-20T00:00:00Z' },
    { id: 'from-phone', name: 'Phone build', data: project('Phone build'), updated_at: '2026-10-21T00:00:00Z' },
    { id: 'broken', name: 'x', data: { nope: true }, updated_at: '2026-10-21T00:00:00Z' }
  ]);
  assert.deepEqual(result.added, ['Phone build']);
  assert.deepEqual(result.updated, ['Shared build']);
  assert.equal(library.projects.find(entry => entry.id === shared.id).project.sections[0].name, 'Arms');
  assert.deepEqual(result.toUpload.map(id => library.projects.find(entry => entry.id === id).project.name), ['Local only']);
  assert.ok(L.validateLibrary(library));
});

test('cloud merge never overwrites unsaved edits and keeps names unique', () => {
  const library = L.createLibrary();
  library.current = project('Gus'); const entry = L.saveCurrent(library);
  library.current.sections[0].raw = 'A1 A2 A3 (unsaved)';
  const result = L.mergeCloud(library, [
    { id: entry.id, name: 'Gus', data: project('Gus'), updated_at: '2099-01-01T00:00:00Z' },
    { id: 'other-device', name: 'gus', data: project('gus'), updated_at: '2026-10-21T00:00:00Z' }
  ]);
  assert.deepEqual(result.conflicts, ['Gus']);
  assert.equal(library.current.sections[0].raw, 'A1 A2 A3 (unsaved)');
  assert.deepEqual(result.added, ['gus (2)']);
  assert.ok(L.validateLibrary(library));
  assert.deepEqual(Object.keys(L.projectRow(entry)).sort(), ['data', 'id', 'name', 'updated_at']);
});

test('createCloud stays off until Supabase is configured', () => {
  assert.equal(C.createCloud({ supabaseUrl: '', supabaseAnonKey: '' }, {}), null);
  assert.equal(C.createCloud({ supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k' }, null), null);
});
