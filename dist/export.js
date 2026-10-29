/* Fitted A4 PDF generation. All fonts, layout, and PDF creation stay local. */
(function (root) {
  'use strict';
  const P = typeof module !== 'undefined' && module.exports ? require('./parts.js') : root.Parts;
  const PDF = typeof module !== 'undefined' && module.exports ? require('./vendor/pdf-lib.min.js') : root.PDFLib;
  const MODES = { section: 'By Section', runner: 'By Runner', both: 'Both' };
  const A4 = [595.28, 841.89];
  const MARGIN = 34;
  const WIDTH = A4[0] - MARGIN * 2;
  const GAP = 20;
  const BOTTOM = 55;
  function exportSummary(project) {
    return { parts: P.projectParts(project).length,
      invalid: project.sections.reduce((sum, section) => sum + P.parseParts(section.raw).invalid.length, 0) };
  }
  function fileName(project, mode, pages = 1) {
    const name = (project.name.trim() || 'Runner Order').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 100).trim();
    return `${name || 'Runner Order'} - ${MODES[mode] || 'Cutting list'} - ${pages} ${pages === 1 ? 'page' : 'pages'}.pdf`;
  }
  async function createPDF(project, mode, pageCount = 1) {
    if (!MODES[mode]) throw new Error('Choose By Section, By Runner, or Both.');
    if (![1, 2, 3].includes(pageCount)) throw new Error('Choose 1, 2, or 3 A4 pages.');
    if (!P.validateProject(project)) throw new Error('The project could not be exported.');
    const summary = exportSummary(project);
    if (!summary.parts) throw new Error('Add some parts before exporting.');
    if (summary.invalid) throw new Error('Check unrecognised entries before exporting.');
    const { PDFDocument, StandardFonts, rgb } = PDF;
    const doc = await PDFDocument.create();
    doc.setTitle(`${project.name.trim() || 'Runner Order'} - Cutting list (${MODES[mode]})`);
    doc.setAuthor('Runner Order'); doc.setCreator('Runner Order');
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const mono = await doc.embedFont(StandardFonts.Courier);
    const monoBold = await doc.embedFont(StandardFonts.CourierBold);
    const ink = rgb(.16, .19, .17), muted = rgb(.36, .39, .37);
    const rule = rgb(.80, .83, .81), pale = rgb(.95, .96, .95), accent = rgb(.17, .32, .25);
    const soft = rgb(.90, .93, .90), surface = rgb(1, 1, 1);
    const images = new Map();
    const measurements = new Map();
    let page;
    function metrics(text, font, size) {
      const key = JSON.stringify([text, font.name, size]);
      if (measurements.has(key)) return measurements.get(key);
      let result;
      try { font.encodeText(text); result = { width: font.widthOfTextAtSize(text, size), fallback: false }; }
      catch {
        if (!root.document) throw new Error('This name needs browser font support. Export it from the app.');
        const ctx = root.document.createElement('canvas').getContext('2d');
        if (!ctx) throw new Error('Your browser could not render a project or section name.');
        ctx.font = `${font === bold ? '600' : '400'} ${size}px system-ui, sans-serif`;
        result = { width: ctx.measureText(text).width, fallback: true };
      }
      measurements.set(key, result);
      return result;
    }
    function wrap(text, font, size, width) {
      const lines = [];
      for (const paragraph of String(text).replace(/\r/g, '').split('\n')) {
        let line = '';
        for (const char of paragraph) {
          if (line && metrics(line + char, font, size).width > width) {
            const space = line.lastIndexOf(' ');
            if (space > line.length / 2) { lines.push(line.slice(0, space)); line = line.slice(space + 1) + char; }
            else { lines.push(line); line = char; }
          } else line += char;
        }
        lines.push(line);
      }
      return lines;
    }
    async function text(value, x, top, size, font = regular, color = ink) {
      if (!value) return;
      const measured = metrics(value, font, size);
      if (!measured.fallback) { page.drawText(value, { x, y: top - size, size, font, color }); return; }
      // Browser font fallback covers Unicode names without fetching or bundling system fonts.
      const key = JSON.stringify([value, size, font.name, color]);
      let image = images.get(key);
      if (!image) {
        const canvas = root.document.createElement('canvas');
        canvas.width = Math.ceil((measured.width + 4) * 4);
        canvas.height = Math.ceil(size * 1.7 * 4);
        const ctx = canvas.getContext('2d'); ctx.scale(4, 4);
        ctx.font = `${font === bold ? '600' : '400'} ${size}px system-ui, sans-serif`;
        ctx.fillStyle = `rgb(${color.red * 255}, ${color.green * 255}, ${color.blue * 255})`;
        ctx.textBaseline = 'top'; ctx.fillText(value, 0, 0);
        image = await doc.embedPng(canvas.toDataURL('image/png')); images.set(key, image);
      }
      page.drawImage(image, { x, y: top - image.height / 4, width: image.width / 4, height: image.height / 4 });
    }
    const groups = [];
    if (mode !== 'runner') project.sections.forEach(section => {
      groups.push({ view: 'section', section: P.sectionName(section), runners: P.groupParts(P.parseParts(section.raw).parts) });
    });
    if (mode !== 'section') for (const runner of P.groupParts(P.projectParts(project))) groups.push({ view: 'runner', ...runner });
    let titleSize = 19;
    let titleLines = wrap(project.name.trim() || 'Model kit cutting list', bold, titleSize, WIDTH);
    while (titleLines.length > 3 && titleSize > 7) titleLines = wrap(project.name.trim() || 'Model kit cutting list', bold, --titleSize, WIDTH);
    const TOP = A4[1] - 80 - titleLines.length * titleSize * 1.25;
    const bodyHeight = TOP - BOTTOM;
    if (bodyHeight < 100) throw new Error('Shorten the project name so there is room for the cutting list.');

    function buildLayout(size, columns) {
      const width = (WIDTH - GAP * (columns - 1)) / columns;
      const refWidth = width * .27;
      // Section mode mirrors the app: section heading with count, "Runner" + code, then outlined part chips.
      const codeSize = size * .875, chipPad = size * .45, chipGap = size * .3;
      const label = metrics('Runner', regular, size * .75).width + size * .5;
      const codeWidth = runner => metrics(runner, monoBold, codeSize).width + size * .8;
      // "Runner" + code sit in a shared gutter beside the chips; codes too wide for it go above instead.
      const gutter = Math.min(width * .45, label + Math.max(0, ...groups.flatMap(group => (group.runners || []).map(runner => codeWidth(runner.runner))))) + size * .5;
      let previous;
      const built = groups.map(group => {
        function headers(full, cont) {
          const rows = [];
          function add(value, factor, color = ink, kind = 'text') {
            for (const valueLine of wrap(value, bold, size * factor, width)) rows.push({ value: valueLine, size: size * factor, color, kind, height: size * factor * 1.35 });
          }
          if (mode === 'both' && (full || !previous || previous.view !== group.view)) add(MODES[group.view].toUpperCase(), .85, muted);
          if (group.view === 'section') {
            const count = `${group.runners.reduce((sum, runner) => sum + runner.parts.length, 0)} parts`;
            const lines = wrap(cont ? `${group.section} (cont.)` : group.section, bold, size * 1.125, width - metrics(count, mono, size * .7).width - size);
            lines.forEach((valueLine, i) => rows.push({ value: valueLine, size: size * 1.125, kind: 'section', count: i ? '' : count, last: i === lines.length - 1, height: size * (i === lines.length - 1 ? 2.1 : 1.4) }));
          }
          if (group.runner) add(`Runner ${group.runner}`, 1, accent);
          if (group.view === 'runner') rows.push({ kind: 'table', height: size * 1.65 });
          return rows;
        }
        const first = headers(false, false), top = headers(true, false), continuation = headers(true, true);
        const rows = [];
        if (group.view === 'section') {
          for (const runner of group.runners) {
            const inline = label + codeWidth(runner.runner) + size * .5 <= gutter;
            const start = inline ? gutter : 0;
            const codes = inline ? [runner.runner] : wrap(runner.runner, monoBold, codeSize, width - label - size * .8);
            const lines = [];
            let line = [], used = 0;
            for (const part of runner.parts) {
              const values = wrap(P.partLabel(part), mono, size, width - start - chipPad * 2);
              const chipWidth = Math.max(...values.map(value => metrics(value, mono, size).width)) + chipPad * 2;
              if (line.length && start + used + chipWidth > width) { lines.push(line); line = []; used = 0; }
              line.push({ values, x: start + used, width: chipWidth, height: size * (values.length * 1.1 + .45) });
              used += chipWidth + chipGap;
              if (values.length > 1) { lines.push(line); line = []; used = 0; }
            }
            if (line.length) lines.push(line);
            // Long runners split into bounded rows that repeat the heading, so fitting never clips.
            for (let offset = 0; offset < lines.length; offset += 12) {
              const chunk = lines.slice(offset, offset + 12).map(items => ({ items, height: Math.max(...items.map(item => item.height)) }));
              const headingHeight = codes.length * codeSize * 1.15 + size * .3;
              rows.push({ kind: 'runner', codes, label, inline, headingHeight, lines: chunk,
                height: size * .4 + (inline ? 0 : headingHeight + size * .4) + chunk.reduce((sum, chipLine) => sum + chipLine.height + chipGap, 0) });
            }
          }
          if (!rows.length) rows.push({ kind: 'empty', height: size * 2.1 });
        } else {
          group.parts.forEach(part => {
            const refs = wrap(P.partLabel(part), mono, size, refWidth - size * 1.5);
            const sources = wrap(part.sectionName, regular, size, width - refWidth - size);
            const count = Math.max(refs.length, sources.length);
            // Split unusually long names into bounded rows so fitting never clips text.
            for (let offset = 0; offset < count; offset += 12) {
              const lines = Math.min(12, count - offset);
              rows.push({ kind: 'table', refs: refs.slice(offset, offset + lines), sources: sources.slice(offset, offset + lines), check: offset === 0, height: size * (lines * 1.3 + .8) });
            }
          });
        }
        previous = group;
        return { first, top, continuation, rows };
      });
      if (built.includes(null)) return null;
      return { size, columns, width, refWidth, codeSize, chipPad, chipGap, groups: built };
    }
    function flow(layout, capacity) {
      const slots = [[]];
      let used = 0;
      function next() { slots.push([]); used = 0; }
      for (const group of layout.groups) {
        let index = 0;
        while (index < group.rows.length) {
          let headers = index ? group.continuation : used === 0 ? group.top : group.first;
          let height = headers.reduce((sum, header) => sum + header.height, 0) + layout.size * .45;
          if (used > 0 && used + height + group.rows[index].height > capacity) { next(); headers = index ? group.continuation : group.top; height = headers.reduce((sum, header) => sum + header.height, 0) + layout.size * .45; }
          if (height + group.rows[index].height > capacity) return null;
          const segment = { headers, rows: [], top: used, headerHeight: height };
          slots[slots.length - 1].push(segment); used += height;
          while (index < group.rows.length && used + group.rows[index].height <= capacity + .001) {
            segment.rows.push(group.rows[index]); used += group.rows[index++].height;
          }
          used += layout.size * .85;
          if (index < group.rows.length) next();
        }
      }
      return slots;
    }
    let chosen;
    // Prefer normal text, then try two columns before reducing type size.
    // Prefer the largest text; at each size try fewer columns first.
    for (let size = 14; size >= .01 && !chosen; size = size > 4 ? size - .25 : size * .8) {
      for (const columns of [1, 2, 3]) {
        const layout = buildLayout(size, columns);
        const full = layout && flow(layout, bodyHeight);
        const limit = pageCount * columns;
        if (!full || full.length > limit) continue;
        // Balance content over the requested pages rather than filling page one first.
        let low = 0, high = bodyHeight;
        for (let pass = 0; pass < 24; pass++) {
          const middle = (low + high) / 2;
          const attempt = flow(layout, middle);
          if (attempt && attempt.length <= limit) high = middle; else low = middle;
        }
        chosen = { ...layout, slots: flow(layout, high + .01) };
        break;
      }
    }
    if (!chosen) throw new Error('This cutting list is too large to fit. Split the build into smaller projects.');
    const actualPages = Math.ceil(chosen.slots.length / chosen.columns);
    const date = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
    const { size, codeSize, chipPad, chipGap } = chosen;
    function roundRect(x, top, width, height, radius, options) {
      const r = Math.min(radius, width / 2, height / 2), w = width, h = height;
      page.drawSvgPath(`M${r},0H${w - r}Q${w},0 ${w},${r}V${h - r}Q${w},${h} ${w - r},${h}H${r}Q0,${h} 0,${h - r}V${r}Q0,0 ${r},0Z`, { x, y: top, ...options });
    }
    // The Runner Order mark: a runner frame with its letter tag, drawn on a 64-unit grid.
    function logo(x, top, width) {
      const scale = width / 64, line = { borderColor: accent, borderLineCap: 1, scale };
      page.drawSvgPath('M6 14H58V54H6Z', { x, y: top, borderWidth: 3.5, ...line });
      page.drawSvgPath('M6 14V8H20V14Z', { x, y: top, color: accent, borderWidth: 3.5, ...line });
      page.drawSvgPath('M6 34H58M32 14V54', { x, y: top, borderWidth: 2.5, ...line });
      page.drawSvgPath('M19 28V34M45 28V34M19 40V34M45 40V34', { x, y: top, borderWidth: 2, ...line });
      for (const [cx, cy] of [[19, 24], [45, 24], [19, 44], [45, 44]]) page.drawCircle({ x: x + cx * scale, y: top - cy * scale, size: 4 * scale, borderColor: accent, borderWidth: 3.5 * scale });
    }
    function checkbox(x, top) {
      page.drawRectangle({ x, y: top - size * .8, width: size * .65, height: size * .65, borderWidth: Math.max(.15, size * .045), borderColor: muted });
    }
    for (let pageIndex = 0; pageIndex < actualPages; pageIndex++) {
      page = doc.addPage(A4);
      logo(MARGIN, A4[1] - 29.5, 14);
      await text('RUNNER ORDER / CUTTING LIST', MARGIN + 20, A4[1] - 30, 9, bold, accent);
      await text(date, A4[0] - MARGIN - metrics(date, regular, 9).width, A4[1] - 30, 9, regular, muted);
      for (let i = 0; i < titleLines.length; i++) await text(titleLines[i], MARGIN, A4[1] - 49 - i * titleSize * 1.25, titleSize, bold);
      await text(`${MODES[mode]} / ${summary.parts} parts / ${project.sections.length} sections`, MARGIN, TOP + 22, 9, regular, muted);
      page.drawLine({ start: { x: MARGIN, y: TOP + 10 }, end: { x: A4[0] - MARGIN, y: TOP + 10 }, thickness: .6, color: rule });
      for (let column = 0; column < chosen.columns; column++) {
        const x = MARGIN + column * (chosen.width + GAP);
        const slot = chosen.slots[pageIndex * chosen.columns + column] || [];
        for (const segment of slot) {
          let top = TOP - segment.top;
          for (const header of segment.headers) {
            if (header.kind === 'table') {
              page.drawRectangle({ x, y: top - header.height, width: chosen.width, height: header.height, color: pale });
              await text('PART', x + size * 1.4, top - size * .3, size * .65, bold, muted);
              await text('SOURCE SECTION', x + chosen.refWidth, top - size * .3, size * .65, bold, muted);
            } else if (header.kind === 'section') {
              await text(header.value, x, top, header.size, bold);
              if (header.count) await text(header.count, x + chosen.width - metrics(header.count, mono, size * .7).width, top + size * .3 - header.size * .82 + size * .7 * .1, size * .7, mono, muted);
              if (header.last) page.drawLine({ start: { x, y: top - header.height + size * .2 }, end: { x: x + chosen.width, y: top - header.height + size * .2 }, thickness: Math.max(.2, size * .06), color: rule });
            } else await text(header.value, x, top, header.size, bold, header.color);
            top -= header.height;
          }
          top -= size * .45;
          for (const row of segment.rows) {
            if (row.kind === 'chips') for (const item of row.items) {
              checkbox(x + item.x, top);
              for (let i = 0; i < item.lines.length; i++) await text(item.lines[i], x + item.x + size * 1.25, top - i * size * 1.3, size, mono);
            }
            else if (row.kind === 'runner') {
              let lineTop = top - size * .4;
              const headingTop = row.inline ? lineTop - (row.lines[0].height - row.headingHeight) / 2 : lineTop;
              const codeWidth = Math.max(...row.codes.map(code => metrics(code, monoBold, codeSize).width)) + size * .8;
              await text('Runner', x, headingTop - (row.headingHeight - size * 1.05) / 2 - size * .17, size * .75, regular, muted);
              roundRect(x + row.label, headingTop, codeWidth, row.headingHeight, size * .25, { color: soft });
              for (let i = 0; i < row.codes.length; i++) await text(row.codes[i], x + row.label + size * .4, headingTop - size * .15 - i * codeSize * 1.15 + codeSize * .03, codeSize, monoBold, accent);
              if (!row.inline) lineTop -= row.headingHeight + size * .4;
              for (const line of row.lines) {
                for (const item of line.items) {
                  roundRect(x + item.x, lineTop, item.width, item.height, size * .3, { color: surface, borderColor: rule, borderWidth: Math.max(.25, size * .07) });
                  for (let i = 0; i < item.values.length; i++) await text(item.values[i], x + item.x + chipPad, lineTop - size * .2 - i * size * 1.1 + size * .07, size, mono);
                }
                lineTop -= line.height + chipGap;
              }
            }
            else if (row.kind === 'empty') await text('No parts entered.', x, top, size, regular, muted);
            else {
              if (row.check) checkbox(x, top);
              for (let i = 0; i < Math.max(row.refs.length, row.sources.length); i++) {
                await text(row.refs[i] || '', x + size * 1.4, top - i * size * 1.3, size, mono);
                await text(row.sources[i] || '', x + chosen.refWidth, top - i * size * 1.3, size);
              }
              page.drawLine({ start: { x, y: top - row.height + size * .35 }, end: { x: x + chosen.width, y: top - row.height + size * .35 }, thickness: Math.max(.15, size * .025), color: rule });
            }
            top -= row.height;
          }
        }
      }
      page.drawLine({ start: { x: MARGIN, y: 40 }, end: { x: A4[0] - MARGIN, y: 40 }, thickness: .6, color: rule });
      if (mode !== 'section') await text('Tick each box as you cut', MARGIN, 29, 8, regular, muted);
      const number = `${pageIndex + 1} / ${actualPages}`;
      await text(number, A4[0] - MARGIN - metrics(number, regular, 9).width, 29, 9, regular, muted);
    }
    return doc.save();
  }
  const api = { createPDF, exportSummary, fileName, A4 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PartsExport = api;
})(globalThis);
