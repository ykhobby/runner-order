// Generate the actual app's PDFs for layout and extracted-text QA.
const fs = require('node:fs/promises');
const P = require('../dist/parts.js');
const E = require('../dist/export.js');
(async () => {
  const project = P.createProject(); project.name = 'Workshop build';
  const first = P.addSection(project); first.name = 'Wing unit'; first.raw = 'a15 A16 B12 A3 F16 B1-12';
  const second = P.addSection(project); second.name = 'Equipment'; second.raw = 'A7 A22 B2 B1 3';
  for (const pages of [1, 2, 3]) await fs.writeFile(`output/pdf/fitted-${pages}-page.pdf`, await E.createPDF(project, 'both', pages));
  first.raw = Array.from({length: 700}, (_, i) => `A${700 - i}`).join(' ');
  second.name = 'A very detailed assembly name that should wrap clearly and retain every word on the cutting sheet '.repeat(5);
  for (const mode of ['section', 'runner', 'both']) for (const pages of [1, 2, 3]) {
    await fs.writeFile(`tmp/pdfs/stress-${mode}-${pages}.pdf`, await E.createPDF(project, mode, pages));
  }
})();
