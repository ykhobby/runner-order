// Rebuilds dist/catalogue.json from gunpla.fyi's kit list (github.com/stevenla/gunpla-db), used with the owner's permission.
// Usage: node scripts/import-catalogue.mjs [folder with products.json and series.json]
// Without a folder it downloads the latest lists from GitHub. Box art and other images are never copied.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildCatalogue } = require('../dist/catalogue.js');
const SOURCE = 'https://raw.githubusercontent.com/stevenla/gunpla-db/master/src/lib/data';
const OUTPUT = new URL('../dist/catalogue.json', import.meta.url);

async function load(name) {
  if (process.argv[2]) return JSON.parse(await readFile(`${process.argv[2]}/${name}.json`, 'utf8'));
  const response = await fetch(`${SOURCE}/${name}.json`);
  if (!response.ok) throw new Error(`Could not download ${name}.json (${response.status})`);
  return response.json();
}

const [products, series] = await Promise.all([load('products'), load('series')]);
if (!Array.isArray(products) || products.length < 500) throw new Error('The product list looks incomplete; keeping the current catalogue.');
const catalogue = buildCatalogue(products, series);
let previous = null;
try { previous = JSON.parse(await readFile(OUTPUT, 'utf8')); } catch { /* first run */ }
// Only the kit list decides whether anything changed, so an unchanged catalogue doesn't create a commit every week.
if (previous && JSON.stringify(previous.kits) === JSON.stringify(catalogue.kits)) {
  console.log(`Catalogue unchanged (${catalogue.kits.length} kits).`);
} else {
  await writeFile(OUTPUT, JSON.stringify(catalogue) + '\n');
  console.log(`Wrote ${catalogue.kits.length} kits to dist/catalogue.json${previous ? ` (was ${previous.kits.length})` : ''}.`);
}
