const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../dist/parts.js');
const E = require('../dist/export.js');
const { PDFDocument } = require('../dist/vendor/pdf-lib.min.js');

function sample() {
  const project = P.createProject();
  project.name = 'Workshop build';
  const first = P.addSection(project); first.name = 'Wing unit'; first.raw = 'a15 A16 B12 A3 F16 B1-12';
  const second = P.addSection(project); second.name = 'Equipment'; second.raw = 'A7 A22 B2 B1 3';
  return project;
}

test('defaults every output mode, including Both, to one real A4 page', async () => {
  const counts = [];
  for (const mode of ['section', 'runner', 'both']) {
    const bytes = await E.createPDF(sample(), mode);
    assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), '%PDF-');
    const doc = await PDFDocument.load(bytes);
    counts.push(doc.getPageCount());
    assert.match(doc.getTitle(), /Workshop build - Cutting list/);
    for (const page of doc.getPages()) assert.deepEqual(page.getSize(), { width: E.A4[0], height: E.A4[1] });
  }
  assert.deepEqual(counts, [1, 1, 1]);
});

test('fits large cutting lists into each selected page count without modifying inputs', async () => {
  const project = sample();
  project.sections[0].raw = Array.from({ length: 700 }, (_, i) => `A${700 - i}`).join(' ');
  const original = JSON.stringify(project);
  for (const mode of ['section', 'runner', 'both']) for (const pages of [1, 2, 3]) {
    const pdf = await PDFDocument.load(await E.createPDF(project, mode, pages));
    assert.equal(pdf.getPageCount(), pages);
  }
  assert.equal(JSON.stringify(project), original);
});

test('long section names and unspaced references wrap without generation errors', async () => {
  const project = sample();
  project.sections[0].name = 'A very detailed custom assembly name '.repeat(20);
  project.sections[0].raw = `${'LONGRUNNER'.repeat(8)}-12 A3`;
  const bytes = await E.createPDF(project, 'both');
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
});

test('blocks incomplete or empty exports and invalid modes', async () => {
  await assert.rejects(E.createPDF(P.createProject(), 'section'), /Add some parts/);
  const project = sample(); project.sections[0].raw += ' ???';
  await assert.rejects(E.createPDF(project, 'both'), /unrecognised/);
  await assert.rejects(E.createPDF(sample(), 'other'), /Choose/);
  await assert.rejects(E.createPDF(sample(), 'both', 4), /1, 2, or 3/);
  assert.deepEqual(E.exportSummary(project), { parts: 10, invalid: 1 });
});

test('uses descriptive safe download filenames with an optional project name', () => {
  const project = sample();
  assert.equal(E.fileName(project, 'both', 3), 'Workshop build - Both - 3 pages.pdf');
  project.name = 'A/B: kit?';
  assert.equal(E.fileName(project, 'runner'), 'A-B- kit- - By Runner - 1 page.pdf');
  project.name = '';
  assert.equal(E.fileName(project, 'section'), 'Runner Order - By Section - 1 page.pdf');
});
test('spreads small lists over two or three pages, without empty pages for a single part', async () => {
  for (const mode of ['section', 'runner', 'both']) for (const pages of [2, 3]) {
    assert.equal((await PDFDocument.load(await E.createPDF(sample(), mode, pages))).getPageCount(), pages);
  }
  const project = P.createProject(); P.addSection(project).raw = 'A3';
  assert.equal((await PDFDocument.load(await E.createPDF(project, 'section', 3))).getPageCount(), 1);
});
