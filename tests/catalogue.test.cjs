const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../dist/catalogue.js');

const products = [
  { id: '1', nameEn: '1/144 HG AILE STRIKE GUNDAM', nameJp: 'HG 1/144 エールストライクガンダム', partNo: '1114204', releaseDate: '2002-11-16', brand: 'HG', series: '機動戦士ガンダム SEED' },
  { id: '2', nameEn: 'HGUC 1/144 GM SNIPER II', nameJp: '', partNo: '2346809', releaseDate: '2017-01', brand: 'HG', series: 'unknown series' },
  { id: '3', nameEn: 'RG 1/144 RX-178 GUNDAM Mk-Ⅱ(AEUG)', nameJp: '', partNo: '2894225', releaseDate: 'N/A', brand: 'RG', series: '' },
  { id: '4', nameEn: '', nameJp: 'ポケモンプラモコレクション 51 アルセウス', partNo: '2596035', releaseDate: '2022-04', brand: 'ポケモンプラモコレクション', series: '' },
  { id: '5', nameEn: 'SDBD:R EX VALKYLANDER', nameJp: '', partNo: '', releaseDate: '2020-01', brand: 'その他', series: '' },
  { id: '6', nameEn: 'MG 1/100 ZAKU II VER.2.0', nameJp: '', partNo: '2056761', releaseDate: '2007-06', brand: 'MG', series: '' },
  { id: '7', nameEn: '', nameJp: '', partNo: '9', releaseDate: '', brand: 'HG', series: '' }
];
const series = { '機動戦士ガンダム SEED': { nameEn: 'Mobile Suit Gundam SEED' } };

test('names become readable title case without breaking model codes', () => {
  assert.equal(K.titleCase('MS-06R-1A SHIN MATSUNAGA’S ZAKU II'), 'MS-06R-1A Shin Matsunaga’s Zaku II');
  assert.equal(K.titleCase('GM SNIPER II'), 'GM Sniper II');
  assert.equal(K.titleCase('ReZEL TYPE-C (GR)'), 'ReZEL Type-C (GR)');
  assert.equal(K.titleCase('GUNDAM MK-II A.E.U.G. (WHITE)'), 'Gundam Mk-II A.E.U.G. (White)');
  assert.equal(K.titleCase('STRIKE FREEDOM GUNDAM VER.2.0 OF THE SEED'), 'Strike Freedom Gundam Ver.2.0 of the SEED');
  assert.equal(K.titleCase('ECLIPSE GUNDAM+RAIJIN STRIKER'), 'Eclipse Gundam+Raijin Striker');
});

test('grade and scale are split off in either order', () => {
  assert.deepEqual(K.splitName('HGUC 1/144 GM'), { line: 'HGUC', scale: '1/144', rest: 'GM' });
  assert.deepEqual(K.splitName('1/144 HG GM'), { line: 'HG', scale: '1/144', rest: 'GM' });
  assert.deepEqual(K.splitName('SDBD:R EX VALKYLANDER'), { line: 'SDBD', scale: '', rest: 'EX VALKYLANDER' });
  assert.deepEqual(K.splitName('1/100 FREEDOM GUNDAM'), { line: '', scale: '1/100', rest: 'FREEDOM GUNDAM' });
  assert.equal(K.splitName('RG 1/144 FREEDOM GUNDAM -APEX LEGENDS™ CRYPTO VER.-').rest, 'FREEDOM GUNDAM -APEX LEGENDS CRYPTO VER.-', 'trademark signs dropped');
});

test('the catalogue keeps facts only and translates categories and series', () => {
  const catalogue = K.buildCatalogue(products, series, '2026-10-29');
  assert.deepEqual(catalogue.fields, K.FIELDS);
  assert.equal(catalogue.kits.length, 6, 'nameless products are skipped');
  const byId = Object.fromEntries(catalogue.kits.map(row => [row[0], row]));
  assert.deepEqual(byId['1'], ['1', 'Aile Strike Gundam', 'HG', '1/144', '1114204', '2002-11', 'Mobile Suit Gundam SEED', 'HG 1/144 エールストライクガンダム']);
  assert.equal(byId['2'][6], 'unknown series', 'untranslated series kept as is');
  assert.equal(byId['3'][1], 'RX-178 Gundam Mk-II(AEUG)', 'full-width numerals normalised');
  assert.equal(byId['3'][5], '', 'unknown dates left blank');
  assert.deepEqual([byId['4'][1], byId['4'][2], byId['4'][3]], ['ポケモンプラモコレクション 51 アルセウス', 'Pokémon Plamo', 'non-scale']);
  assert.equal(byId['5'][2], 'SDBD');
  assert.equal(catalogue.kits[0][0], '4', 'newest first');
  assert.equal(catalogue.kits.at(-1)[0], '3', 'undated last');
});

test('search needs every word, ranks exact product codes first and filters by grade family', () => {
  const entries = K.parseCatalogue(K.buildCatalogue(products, series));
  assert.deepEqual(K.searchCatalogue(entries, 'zaku 2').map(entry => entry.id), ['6']);
  assert.deepEqual(K.searchCatalogue(entries, 'sniper ii').map(entry => entry.id), ['2']);
  assert.deepEqual(K.searchCatalogue(entries, 'gundam mk2').map(entry => entry.id), ['3']);
  assert.deepEqual(K.searchCatalogue(entries, '1114204').map(entry => entry.id), ['1']);
  assert.deepEqual(K.searchCatalogue(entries, 'エール').map(entry => entry.id), ['1'], 'Japanese names are searchable');
  assert.deepEqual(K.searchCatalogue(entries, 'gundam', { line: 'hg' }).map(entry => entry.id), ['1'], 'HG also matches HGUC and HGCE families');
  assert.deepEqual(K.searchCatalogue(entries, 'gm', { line: 'HG' }).map(entry => entry.id), ['2']);
  assert.deepEqual(K.searchCatalogue(entries, 'gundam', { scale: '1/144' }).map(entry => entry.id).sort(), ['1', '3']);
  assert.deepEqual(K.searchCatalogue(entries, '   '), []);
  assert.throws(() => K.parseCatalogue({ nope: true }), /could not be read/);
});

test('picking a catalogue kit fills the project details', () => {
  const [entry] = K.searchCatalogue(K.parseCatalogue(K.buildCatalogue(products, series)), '2346809');
  assert.equal(K.projectName(entry), 'HGUC GM Sniper II');
  assert.equal(K.entryMeta(entry), 'Bandai · 1/144 · HGUC · 2017');
  assert.deepEqual(K.kitFromEntry(entry), { title: 'GM Sniper II', brand: 'bandai', brandOther: '', scale: '1/144', line: 'HGUC',
    series: 'unknown series', productCode: '2346809', catalogueId: '2' });
});
