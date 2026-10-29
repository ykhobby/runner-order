/* Accounts, cloud saves and the community kit library. Pure helpers are testable in Node;
   createCloud wraps a Supabase client and is only used in the browser. */
(function (root) {
  'use strict';
  const P = typeof module !== 'undefined' && module.exports ? require('./parts.js') : root.Parts;

  const SCALES = [['1/144', '1/144'], ['1/100', '1/100'], ['1/60', '1/60'], ['1/72', '1/72'], ['1/48', '1/48'],
    ['1/35', '1/35'], ['non-scale', 'Non-scale (SD, figures)'], ['other', 'Other scale']];
  const LINES = ['HG', 'RG', 'MG', 'PG', 'SD', 'EG', 'MGSD', 'Full Mechanics'];
  // Used until the live brand list loads, and when the library is offline.
  const BRANDS = [['bandai', 'Bandai'], ['motornuclear', 'MotorNuclear'], ['kotobukiya', 'Kotobukiya'], ['changlong', 'ChangLong'],
    ['fatcat', 'Fat Cat'], ['good-smile', 'Good Smile'], ['hasegawa', 'Hasegawa'], ['wave', 'Wave'], ['daban', 'Daban'], ['other', 'Other']]
    .map(([slug, name]) => ({ slug, name }));
  const REPORT_REASONS = [['wrong-parts', 'Wrong or missing parts'], ['duplicate', 'Duplicate of another kit'],
    ['spam', 'Spam or not a kit'], ['offensive', 'Offensive content'], ['other', 'Something else']];
  const KIT_SUMMARY = 'id,title,brand,brand_other,scale,line,series,product_code,notes,part_count,confirmations_count,status,owner,forked_from,created_at,updated_at';

  // Mirrors public.normalise_title / normalise_code in supabase/migrations so search and hints agree.
  function normaliseTitle(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')
      .replace(/\bmk(ii|iii|iv)\b/g, 'mk $1').replace(/\biv\b/g, '4').replace(/\biii\b/g, '3').replace(/\bii\b/g, '2')
      .replace(/\s+/g, ' ').trim();
  }
  function normaliseCode(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '') || null;
  }
  const clean = value => String(value || '').trim();

  // Kit details live on a project as project.kit and travel with it into the share form.
  function kitDetails(project) {
    const kit = project && project.kit && typeof project.kit === 'object' ? project.kit : {};
    return { title: clean(kit.title) || clean(project && project.name), brand: clean(kit.brand) || 'bandai', brandOther: clean(kit.brandOther),
      scale: clean(kit.scale) || '1/144', line: clean(kit.line), series: clean(kit.series), productCode: clean(kit.productCode),
      notes: clean(kit.notes), sharedKitId: kit.sharedKitId || null, sourceKitId: kit.sourceKitId || null };
  }
  function validateKitDetails(details) {
    const errors = {};
    const title = clean(details.title);
    if (title.length < 2 || title.length > 120) errors.title = 'Enter the kit name (2 to 120 characters).';
    if (!clean(details.brand)) errors.brand = 'Choose a brand.';
    if (details.brand === 'other' && !clean(details.brandOther)) errors.brandOther = 'Type the brand name.';
    if (clean(details.brandOther).length > 60) errors.brandOther = 'Keep the brand under 60 characters.';
    if (!SCALES.some(([value]) => value === details.scale)) errors.scale = 'Choose a scale.';
    if (clean(details.line).length > 40) errors.line = 'Keep the line under 40 characters.';
    if (clean(details.series).length > 80) errors.series = 'Keep the series under 80 characters.';
    if (clean(details.productCode).length > 40) errors.productCode = 'Keep the product code under 40 characters.';
    if (clean(details.notes).length > 1000) errors.notes = 'Keep notes under 1,000 characters.';
    return errors;
  }
  // A shared kit is a frozen copy of the section names and part text; section ids stay private.
  function kitFromProject(project, details) {
    const sections = project.sections.filter(section => P.parseParts(section.raw).parts.length)
      .map(section => ({ name: P.sectionName(section), raw: section.raw }));
    const invalid = project.sections.reduce((sum, section) => sum + P.parseParts(section.raw).invalid.length, 0);
    if (invalid) throw new Error('Check unrecognised entries before sharing.');
    if (!sections.length) throw new Error('Add some parts before sharing.');
    const errors = validateKitDetails(details);
    if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
    const optional = value => clean(value) || null;
    return {
      title: clean(details.title), brand: details.brand, brand_other: details.brand === 'other' ? clean(details.brandOther) : null,
      scale: details.scale, line: optional(details.line), series: optional(details.series), product_code: optional(details.productCode),
      notes: optional(details.notes), sections, part_count: P.projectParts(project).length
    };
  }
  // "Use this kit": a fresh, editable project that remembers which kit it came from.
  function projectFromKit(kit) {
    const project = P.createProject();
    project.name = clean(kit.title) || 'Community kit';
    for (const source of kit.sections || []) {
      const section = P.addSection(project);
      section.name = String(source.name || '');
      section.raw = String(source.raw || '');
    }
    project.kit = { title: clean(kit.title), brand: kit.brand || 'other', brandOther: clean(kit.brand_other), scale: kit.scale || 'other',
      line: clean(kit.line), series: clean(kit.series), productCode: clean(kit.product_code), sourceKitId: kit.id || null };
    return project;
  }
  function brandLabel(kit, brands = BRANDS) {
    if (kit.brand === 'other') return clean(kit.brand_other) || 'Other brand';
    return kit.brand_name || (brands.find(brand => brand.slug === kit.brand) || {}).name || kit.brand;
  }
  function scaleLabel(scale) {
    const match = SCALES.find(([value]) => value === scale);
    return match ? (scale === 'non-scale' ? 'Non-scale' : match[1]) : scale;
  }
  function kitMeta(kit, brands) {
    return [brandLabel(kit, brands), scaleLabel(kit.scale), clean(kit.line)].filter(Boolean).join(' · ');
  }
  function kitLink(id, base) {
    return `${String(base).replace(/#.*$/, '')}#/kits/${id}`;
  }
  // Hash routes: #/kits, #/kits/<id>, #/admin. Anything else is the workbench.
  function parseRoute(hash) {
    const match = String(hash || '').match(/^#\/(kits|admin)(?:\/([0-9a-f-]{36}))?\/?$/i);
    if (!match) return { page: 'workbench' };
    if (match[1].toLowerCase() === 'admin') return { page: 'admin' };
    return match[2] ? { page: 'kit', id: match[2].toLowerCase() } : { page: 'kits' };
  }

  function createCloud(config, supabaseLib) {
    if (!config || !config.supabaseUrl || !config.supabaseAnonKey || !supabaseLib) return null;
    const client = supabaseLib.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    const redirectTo = () => root.location.origin + root.location.pathname;
    async function data(request) {
      const { data: rows, error } = await request;
      if (error) throw new Error(error.message || 'The community library could not be reached.');
      return rows;
    }
    return {
      client,
      async session() { return (await data(client.auth.getSession())).session; },
      onAuthChange(callback) { return client.auth.onAuthStateChange((event, session) => callback(event, session)); },
      signInWithGoogle() { return data(client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectTo() } })); },
      signInWithEmail(email) { return data(client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo() } })); },
      signOut() { return data(client.auth.signOut()); },
      profile(id) { return data(client.from('profiles').select('id,display_name,is_admin').eq('id', id).maybeSingle()); },
      renameProfile(id, displayName) { return data(client.from('profiles').update({ display_name: displayName }).eq('id', id)); },
      deleteAccount() { return data(client.rpc('delete_account')); },
      listProjects() { return data(client.from('projects').select('id,name,data,updated_at')); },
      uploadProjects(rows) { return rows.length ? data(client.from('projects').upsert(rows, { onConflict: 'owner,id' })) : Promise.resolve([]); },
      brands() { return data(client.from('brands').select('slug,name').order('sort').order('name')); },
      searchKits({ query = '', brand = null, scale = null, line = null, sort = 'relevance', limit = 30, offset = 0 } = {}) {
        return data(client.rpc('search_kits', { q: query, p_brand: brand || null, p_scale: scale || null, p_line: clean(line) || null,
          p_sort: sort, p_limit: limit, p_offset: offset }));
      },
      async kit(id) {
        const kit = await data(client.from('kits').select(`${KIT_SUMMARY},sections`).eq('id', id).maybeSingle());
        if (kit && kit.owner) kit.owner_name = ((await data(client.from('profiles').select('display_name').eq('id', kit.owner).maybeSingle())) || {}).display_name;
        return kit;
      },
      async shareKit(row, existingId) {
        if (existingId) {
          const updated = await data(client.from('kits').update(row).eq('id', existingId).select('id'));
          if (updated.length) return updated[0].id;
        }
        return (await data(client.from('kits').insert(row).select('id').single())).id;
      },
      async confirmed(kitId, userId) {
        return !!(await data(client.from('kit_confirmations').select('kit_id').eq('kit_id', kitId).eq('user_id', userId).maybeSingle()));
      },
      confirmKit(kitId) { return data(client.from('kit_confirmations').insert({ kit_id: kitId })); },
      unconfirmKit(kitId, userId) { return data(client.from('kit_confirmations').delete().eq('kit_id', kitId).eq('user_id', userId)); },
      reportKit(kitId, reason, details) { return data(client.from('kit_reports').insert({ kit_id: kitId, reason, details: clean(details) || null })); },
      flaggedKits() {
        return data(client.from('kits').select(KIT_SUMMARY + ',reports_count').or('status.eq.hidden,reports_count.gt.0').order('updated_at', { ascending: false }).limit(100));
      },
      kitReports(kitId) { return data(client.from('kit_reports').select('reason,details,created_at').eq('kit_id', kitId)); },
      setKitStatus(kitId, status) { return data(client.from('kits').update({ status }).eq('id', kitId)); },
      mergeKits(duplicate, keep) { return data(client.rpc('merge_kits', { duplicate, keep })); },
      otherBrands() { return data(client.from('kits').select('brand_other').eq('brand', 'other').limit(500)); },
      promoteBrand(otherName, slug, name) { return data(client.rpc('promote_brand', { other_name: otherName, new_slug: slug, new_name: name })); }
    };
  }

  const api = { SCALES, LINES, BRANDS, REPORT_REASONS, normaliseTitle, normaliseCode, kitDetails, validateKitDetails, kitFromProject,
    projectFromKit, brandLabel, scaleLabel, kitMeta, kitLink, parseRoute, createCloud };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Cloud = api;
})(globalThis);
