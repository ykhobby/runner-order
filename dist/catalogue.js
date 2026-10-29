/* The Bandai kit catalogue, built from gunpla.fyi's data (github.com/stevenla/gunpla-db) with the owner's permission.
   buildCatalogue turns its raw lists into catalogue.json; parse and search run in the browser for autocomplete. */
(function (root) {
  'use strict';
  const FIELDS = ['id', 'title', 'line', 'scale', 'code', 'released', 'series', 'nameJp'];
  // Grade and line prefixes as they appear at the start of gunpla-db's English names.
  const LINE_PREFIX = /^(HG[A-Z]*|MG[A-Z]*|RG|PG(?: UNLEASHED)?|RE\/100|30MM|30MS|30MF|SDBD(?::R)?|SDBF|SDEX|SDCS|SD|EG|ENTRY GRADE|FULL MECHANICS|Figure-rise Standard(?: Amplified)?)\b[:\s]*/i;
  // gunpla-db's own categories, used when a name carries no prefix (and to translate the Japanese ones).
  const CATEGORY_LINES = Object.fromEntries(Object.entries({ 'ENTRY GRADE': 'EG', '30 MINUTES LABEL': '30MM', 'FULL MECHANICS': 'Full Mechanics', 'SDガンダム クロスシルエット': 'SDCS',
    'ポケモンプラモコレクション': 'Pokémon Plamo', 'アクションベース': 'Action Base', 'オプションパーツセット': 'Option Parts', 'メガサイズモデル': 'Mega Size', 'その他': '' }).map(([key, value]) => [key.normalize('NFKC'), value]));
  const SMALL_WORDS = new Set(['OF', 'THE', 'AND', 'FOR', 'WITH', 'A', 'AN', 'IN', 'ON', 'TO']);
  // Factions, series and model codes that are written in capitals.
  const ACRONYMS = new Set(['AEUG', 'ZAFT', 'ORB', 'OMNI', 'SEED', 'MSV', 'UC', 'GBN', 'GBFT', 'AGE', 'IBO', 'OZ', 'GN', 'TR', 'DX', 'EX', 'SP', 'NT', 'MSA', 'PMX', 'AMS', 'MSN', 'ORX', 'RGM', 'RX', 'OO', 'XVX', 'IFS', 'GPB', 'RE', 'HD', 'FA', 'HWS', 'ABC', 'ECOAS', 'EFSF', 'ARX', 'PG', 'MG', 'RG', 'HG', 'EG', 'SD', 'GBF', 'BB', 'LED', 'CG', 'EW', 'OVA', 'TV', 'MSIGLOO', 'HGUC', 'IWSP']);
  const ROMAN = /^(II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV)$/;

  // "MS-06R-1A SHIN MATSUNAGA’S ZAKU II" -> "MS-06R-1A Shin Matsunaga’s Zaku II".
  // Model numbers, roman numerals, short consonant-only codes (GM, ZZ) and mixed-case words (ReZEL) keep their case.
  function titleCase(name) {
    return String(name).split(/(\s+|[()[\]"“”])/).map((word, index) => {
      if (!/[A-Za-z]/.test(word) || /\s/.test(word)) return word;
      const bare = word.replace(/[^A-Za-z0-9-]/g, '');
      if (/^VER\./i.test(word)) return `Ver.${word.slice(4)}`;
      if (/\d/.test(bare) || /[a-z]/.test(word) && /[A-Z]/.test(word.slice(1)) && word !== word.toUpperCase()) return word;
      if (/^([A-Z]\.)+[A-Z]?\.?$/.test(word) || ACRONYMS.has(bare.toUpperCase()) && bare === bare.toUpperCase()) return word;
      if (ROMAN.test(bare) || /^[B-DF-HJ-NP-TV-Z]{1,3}$/.test(bare) || /^[B-DF-HJ-NP-TV-Z]{2,}(II|III|IV)$/.test(bare)) return word;
      if (/^MK-?(II|III|IV|V)$/i.test(bare)) return word.replace(/^mk/i, 'Mk');
      if (index > 0 && SMALL_WORDS.has(bare.toUpperCase())) return word.toLowerCase();
      return word.split(/([-+])/).map(part => /^(II|III|IV|V|[-+])$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join('');
    }).join('').replace(/\s+/g, ' ').trim();
  }
  // Names put the grade and scale first, in either order: "HGUC 1/144 GM" or "1/144 HG GM".
  function splitName(name) {
    // Some source names carry spreadsheet quoting (wrapped in quotes, inner quotes doubled); undo it.
    let rest = String(name || '').replace(/[™®©]/g, '').normalize('NFKC').replace(/\s+/g, ' ').trim().replace(/^"(.*)"$/, '$1').replace(/""/g, '"');
    let line = '';
    let scale = '';
    for (let pass = 0; pass < 2; pass++) {
      const ratio = rest.match(/^1\/(\d+)\s+/);
      if (ratio && !scale) { scale = `1/${ratio[1]}`; rest = rest.slice(ratio[0].length); }
      const prefix = rest.match(LINE_PREFIX);
      if (prefix && !line) { line = prefix[1].replace(/:R$/i, ''); rest = rest.slice(prefix[0].length); }
    }
    return { line, scale, rest: rest.trim() };
  }
  const SCALES = new Set(['1/144', '1/100', '1/60', '1/72', '1/48', '1/35']);
  function lineLabel(line) {
    const upper = line.toUpperCase();
    if (upper === 'ENTRY GRADE') return 'EG';
    if (upper === 'FULL MECHANICS') return 'Full Mechanics';
    if (/^figure-rise standard/i.test(line)) return 'Figure-rise Standard';
    if (upper === 'PG UNLEASHED') return 'PG Unleashed';
    return upper;
  }
  function buildCatalogue(products, series = {}, generated = new Date().toISOString().slice(0, 10)) {
    const kits = [];
    for (const product of products) {
      const english = String(product.nameEn || '').trim();
      const japanese = String(product.nameJp || '').trim();
      const parts = splitName(english || japanese);
      if (!parts.rest) continue;
      const category = String(product.brand || '').normalize('NFKC');
      const line = parts.line ? lineLabel(parts.line) : (category in CATEGORY_LINES ? CATEGORY_LINES[category] : lineLabel(category));
      const scale = parts.scale ? (SCALES.has(parts.scale) ? parts.scale : 'other') : (/^SD|^Pok|Figure-rise/i.test(line) ? 'non-scale' : '');
      const seriesName = (series[product.series] && series[product.series].nameEn) || String(product.series || '');
      kits.push([String(product.id), english ? titleCase(parts.rest) : parts.rest, line, scale, String(product.partNo || ''),
        (String(product.releaseDate || '').match(/^\d{4}(-\d{2})?/) || [''])[0], seriesName, japanese]);
    }
    kits.sort((a, b) => (b[5] || '').localeCompare(a[5] || '') || a[1].localeCompare(b[1]));
    return { source: 'gunpla.fyi (github.com/stevenla/gunpla-db), used with permission', generated, fields: FIELDS, kits };
  }

  // ---------------------------------------------------------------- browser side
  const normalise = value => String(value || '').toLowerCase().normalize('NFKC').replace(/[^a-z0-9぀-ヿ一-鿿]+/g, ' ')
    .replace(/\bmk(ii|iii|iv|\d)\b/g, 'mk $1').replace(/\biv\b/g, '4').replace(/\biii\b/g, '3').replace(/\bii\b/g, '2').replace(/\s+/g, ' ').trim();
  const code = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  function parseCatalogue(data) {
    if (!data || !Array.isArray(data.fields) || !Array.isArray(data.kits)) throw new Error('The kit catalogue could not be read.');
    return data.kits.map(row => {
      const entry = {};
      data.fields.forEach((field, index) => { entry[field] = row[index] || ''; });
      entry.search = normalise(`${entry.line} ${entry.title} ${entry.nameJp} ${entry.series}`);
      entry.codeKey = code(entry.code);
      return entry;
    });
  }
  // Every typed word must appear; whole-word and early matches rank first, then newer kits.
  function searchCatalogue(entries, query, { line = '', scale = '', limit = 8 } = {}) {
    const words = normalise(query).split(' ').filter(Boolean);
    const typedCode = code(query);
    if (!words.length) return [];
    const lineKey = String(line).toLowerCase();
    const results = [];
    for (const entry of entries) {
      if (lineKey && !entry.line.toLowerCase().startsWith(lineKey)) continue;
      if (scale && entry.scale !== scale) continue;
      let score;
      if (typedCode.length >= 5 && entry.codeKey === typedCode) score = 1000;
      else {
        const haystack = ` ${entry.search} `;
        if (!words.every(word => haystack.includes(word))) continue;
        score = words.reduce((sum, word) => sum + (haystack.includes(` ${word} `) ? 3 : 1), 0) - entry.search.indexOf(words[0]) / 100;
      }
      results.push({ entry, score });
    }
    results.sort((a, b) => b.score - a.score || (b.entry.released || '').localeCompare(a.entry.released || ''));
    return results.slice(0, limit).map(result => result.entry);
  }
  // "HGUC GM Sniper II": the name a new project gets when picked from the catalogue.
  function projectName(entry) {
    return [entry.line, entry.title].filter(Boolean).join(' ');
  }
  function kitFromEntry(entry) {
    return { title: entry.title, brand: 'bandai', brandOther: '', scale: entry.scale || '', line: entry.line, series: entry.series,
      productCode: entry.code, catalogueId: entry.id };
  }
  function entryMeta(entry) {
    return ['Bandai', entry.scale === 'non-scale' ? 'Non-scale' : entry.scale === 'other' ? '' : entry.scale, entry.line, entry.released.slice(0, 4)]
      .filter(Boolean).join(' · ');
  }

  const api = { FIELDS, titleCase, splitName, buildCatalogue, normalise, parseCatalogue, searchCatalogue, projectName, kitFromEntry, entryMeta };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Catalogue = api;
})(globalThis);
