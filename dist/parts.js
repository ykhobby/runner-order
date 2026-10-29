/* Pure parsing, sorting, project operations, and storage. Also usable in Node tests. */
(function (root) {
  'use strict';
  const STORAGE_KEY = 'runner-notes.project.v1';
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  const sectionName = section => section.name.trim() || 'Untitled section';
  const partLabel = part => /\d/.test(part.runner) ? `${part.runner}-${part.number}` : `${part.runner}${part.number}`;

  function parseParts(raw) {
    const parts = [];
    const invalid = [];
    // Commas and line breaks end an entry group. Only spaces may join a runner to a number.
    for (const group of raw.split(/[,\r\n]+/)) {
      const tokens = group.trim().replace(/(^|\s)([a-z][a-z0-9]*)[ \t]*([-:])[ \t]*(\d+)(?=\s|$)/gi,
        '$1$2$3$4').split(/\s+/).filter(Boolean);
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        let match = token.match(/^([a-z][a-z0-9]*)[-:](\d+)$/i);
        if (!match && /^[a-z][a-z0-9]*$/i.test(token) && /^\d+$/.test(tokens[i + 1] || '')) {
          match = [token, token, tokens[++i]];
        }
        if (!match) match = token.match(/^([a-z]+)(\d+)$/i);
        const number = match ? Number(match[2]) : NaN;
        if (match && Number.isSafeInteger(number)) parts.push({ runner: match[1].toUpperCase(), number });
        else invalid.push(token);
      }
    }
    return { parts, invalid };
  }

  function compareParts(a, b) {
    return collator.compare(a.runner, b.runner) || a.number - b.number;
  }

  function groupParts(parts) {
    const groups = new Map();
    for (const part of [...parts].sort(compareParts)) {
      if (!groups.has(part.runner)) groups.set(part.runner, []);
      groups.get(part.runner).push(part);
    }
    return [...groups].map(([runner, parts]) => ({ runner, parts }));
  }

  function projectParts(project) {
    return project.sections.flatMap(section => parseParts(section.raw).parts.map(part => ({
      ...part, sectionId: section.id, sectionName: sectionName(section)
    })));
  }

  function createProject() { return { version: 1, name: '', view: 'section', sections: [] }; }
  function newId() {
    return globalThis.crypto?.randomUUID?.() || `section-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  function addSection(project) {
    const section = { id: newId(), name: '', raw: '' };
    project.sections.push(section);
    return section;
  }
  function moveSection(project, id, delta) {
    const index = project.sections.findIndex(section => section.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= project.sections.length) return false;
    const [section] = project.sections.splice(index, 1);
    project.sections.splice(target, 0, section);
    return true;
  }
  function deleteSection(project, id) {
    const index = project.sections.findIndex(section => section.id === id);
    if (index < 0) return null;
    return { section: project.sections.splice(index, 1)[0], index };
  }
  function restoreSection(project, deletion) {
    if (!deletion || project.sections.some(section => section.id === deletion.section.id)) return false;
    project.sections.splice(Math.min(deletion.index, project.sections.length), 0, deletion.section);
    return true;
  }

  function validateProject(value) {
    if (!value || value.version !== 1 || typeof value.name !== 'string' ||
      !['section', 'runner'].includes(value.view) || !Array.isArray(value.sections)) return false;
    const ids = new Set();
    return value.sections.every(section => {
      if (!section || typeof section.id !== 'string' || !section.id || ids.has(section.id) ||
        typeof section.name !== 'string' || typeof section.raw !== 'string') return false;
      ids.add(section.id);
      return true;
    });
  }
  function loadProject(storage) {
    try {
      const saved = storage.getItem(STORAGE_KEY);
      if (saved === null) return { project: createProject(), error: null };
      const project = JSON.parse(saved);
      if (!validateProject(project)) throw new Error('Invalid project');
      return { project, error: null };
    } catch {
      return { project: createProject(), error: 'Your saved project could not be read. New edits will replace it if saving is available.' };
    }
  }
  function saveProject(storage, project) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(project));
      return true;
    } catch { return false; }
  }

  const api = { STORAGE_KEY, parseParts, compareParts, groupParts, projectParts, partLabel, sectionName,
    createProject, addSection, moveSection, deleteSection, restoreSection, validateProject, loadProject, saveProject };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Parts = api;
})(globalThis);
