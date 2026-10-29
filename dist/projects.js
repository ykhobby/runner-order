/* Browser-local named projects and the current draft, stored in one atomic record. */
(function (root) {
  'use strict';
  const P = typeof module !== 'undefined' && module.exports ? require('./parts.js') : root.Parts;
  const STORAGE_KEY = 'runner-notes.projects.v1';
  const clone = value => JSON.parse(JSON.stringify(value));
  const nameKey = name => name.trim().normalize('NFKC').toLocaleLowerCase('en');
  function createLibrary(current = P.createProject()) {
    return { version: 1, current, activeId: null, projects: [] };
  }
  function validateLibrary(library) {
    if (!library || library.version !== 1 || !P.validateProject(library.current) || !Array.isArray(library.projects)) return false;
    const ids = new Set();
    const names = new Set();
    for (const entry of library.projects) {
      if (!entry || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id) || !P.validateProject(entry.project) ||
        !entry.project.name.trim() || names.has(nameKey(entry.project.name)) || typeof entry.updatedAt !== 'string') return false;
      ids.add(entry.id);
      names.add(nameKey(entry.project.name));
    }
    return library.activeId === null || ids.has(library.activeId);
  }
  function loadLibrary(storage) {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw !== null) {
        const library = JSON.parse(raw);
        if (!validateLibrary(library)) throw new Error('Invalid project library');
        return { library, error: null };
      }
      // Keep the existing single-project draft intact when upgrading the app.
      const legacy = P.loadProject(storage);
      return { library: createLibrary(legacy.project), error: legacy.error };
    } catch {
      return { library: createLibrary(), error: 'Saved projects could not be read. Keep any existing browser data until you have recovered your work.' };
    }
  }
  function saveLibrary(storage, library) {
    try { storage.setItem(STORAGE_KEY, JSON.stringify(library)); return true; }
    catch { return false; }
  }
  function saveCurrent(library, allowUntitled = false) {
    let name = library.current.name.trim();
    if (!name && !allowUntitled) throw new Error('Enter a project name before saving.');
    if (!name) {
      name = 'Untitled project';
      let suffix = 2;
      while (library.projects.some(entry => nameKey(entry.project.name) === nameKey(name))) name = `Untitled project ${suffix++}`;
    }
    const collision = library.projects.find(entry => nameKey(entry.project.name) === nameKey(name) && entry.id !== library.activeId);
    if (collision) throw new Error(`A saved project named "${collision.project.name}" already exists. Choose a different name or open that project.`);
    let entry = library.projects.find(entry => entry.id === library.activeId);
    if (!entry) {
      entry = { id: root.crypto?.randomUUID?.() || `project-${Date.now()}-${Math.random().toString(36).slice(2)}` };
      library.projects.push(entry);
    }
    library.current.name = name;
    entry.project = clone(library.current);
    entry.updatedAt = new Date().toISOString();
    library.activeId = entry.id;
    return entry;
  }
  function preserveCurrent(library) {
    if (library.current.name.trim() || library.current.sections.length) return saveCurrent(library, true);
    return null;
  }
  function startNew(library) {
    const saved = preserveCurrent(library);
    library.current = P.createProject();
    library.activeId = null;
    return saved;
  }
  function openProject(library, id) {
    if (!library.projects.some(entry => entry.id === id)) throw new Error('That saved project is no longer available.');
    const saved = preserveCurrent(library);
    const entry = library.projects.find(entry => entry.id === id);
    library.current = clone(entry.project);
    library.activeId = entry.id;
    return { saved, entry };
  }
  // Portable project files: a small JSON wrapper so builds can be backed up, moved, or shared.
  const FILE_FORMAT = 'runner-notes.project';
  const MAX_FILE_SIZE = 5 * 1024 * 1024;
  function projectFile(project) {
    return JSON.stringify({ format: FILE_FORMAT, version: 1, exportedAt: new Date().toISOString(), project }, null, 2);
  }
  function projectFileName(project) {
    const name = (project.name.trim() || 'Untitled project').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 100).trim();
    return `${name || 'Untitled project'} - Runner Order project.json`;
  }
  function readProjectFile(text) {
    if (typeof text !== 'string' || text.length > MAX_FILE_SIZE) throw new Error('That file is too large to be a Runner Order project.');
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('That file is not a Runner Order project.'); }
    if (data && data.format === FILE_FORMAT && data.version !== 1) throw new Error('That project was made with a newer version of Runner Order.');
    const project = data && data.format === FILE_FORMAT ? data.project : data;
    if (!P.validateProject(project)) throw new Error('That file is not a Runner Order project, or it is damaged.');
    return clone(project);
  }
  function importProject(library, project) {
    const saved = preserveCurrent(library);
    const base = project.name.trim() || 'Imported project';
    let name = base, suffix = 2;
    // Imports never overwrite an existing build; a clashing name gets a numbered copy.
    while (library.projects.some(entry => nameKey(entry.project.name) === nameKey(name))) name = `${base} (${suffix++})`;
    library.current = clone(project);
    library.current.name = name;
    library.activeId = null;
    return { saved, entry: saveCurrent(library) };
  }
  const api = { STORAGE_KEY, createLibrary, validateLibrary, loadLibrary, saveLibrary, saveCurrent, startNew, openProject,
    projectFile, projectFileName, readProjectFile, importProject };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Projects = api;
})(globalThis);
