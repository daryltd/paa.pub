/**
 * Profile editor — view and edit WebID profile triples.
 *
 * Routes:
 *   GET  /profile              — render the editor form
 *   POST /profile              — save profile changes
 *   POST /profile/reset-index  — reset root container index.html to default
 *
 * The profile document lives at /{username}/profile/card and contains triples
 * about the WebID subject (/{username}/profile/card#me). Triples are categorized:
 *
 *   - **Editable fields**: foaf:name, foaf:nick, foaf:img, foaf:mbox,
 *     foaf:homepage, vcard:note, vcard:role, schema:description
 *   - **System fields** (read-only): rdf:type, solid:oidcIssuer, space:storage,
 *     ldp:inbox, TypeIndex references, security keys
 *   - **Custom triples**: any other predicates on the WebID subject
 *
 * On save, system triples are preserved unchanged, editable fields are replaced
 * with form values, and custom triples are replaced with the submitted set.
 * Triples with other subjects (e.g., document-level triples) are preserved.
 */
import { renderPage } from '../shell.js';
import template from '../templates/profile-editor.html';
import { DEFAULT_LAYOUT } from '../layout-renderer.js';
import { requireAuth } from '../../auth/middleware.js';
import { readProfileTriples, writeTriplesToKV } from '../../solid/ldp.js';
import { iri, unwrapIri, unwrapLiteral, literal } from '../../rdf/ntriples.js';
import { PREFIXES, shortenPredicate, loadCustomPrefixes, saveCustomPrefixes, loadPredicateCatalog, discoverNsPredicates, saveNsPredicates, BUILTIN_NS_PREDICATES } from '../../rdf/prefixes.js';

/**
 * Editable predicate IRIs mapped to form field names.
 */
const EDITABLE_FIELDS = {
  [`${PREFIXES.foaf}name`]: 'name',
  [`${PREFIXES.foaf}nick`]: 'nick',
  [`${PREFIXES.foaf}img`]: 'img',
  [`${PREFIXES.foaf}mbox`]: 'email',
  [`${PREFIXES.foaf}homepage`]: 'homepage',
  [`${PREFIXES.vcard}note`]: 'bio',
  [`${PREFIXES.vcard}role`]: 'role',
  [`${PREFIXES.schema}description`]: 'description',
};

/** Reverse mapping: form field name → predicate IRI */
const FIELD_TO_PREDICATE = Object.fromEntries(
  Object.entries(EDITABLE_FIELDS).map(([k, v]) => [v, k])
);

/** System predicates that should not be user-editable. */
const SYSTEM_PREDICATES = new Set([
  `${PREFIXES.rdf}type`,
  `${PREFIXES.solid}oidcIssuer`,
  `${PREFIXES.space}storage`,
  `${PREFIXES.ldp}inbox`,
  `${PREFIXES.solid}privateTypeIndex`,
  `${PREFIXES.solid}publicTypeIndex`,
  `${PREFIXES.foaf}isPrimaryTopicOf`,
]);

const SYSTEM_PREFIX = 'https://w3id.org/security#';

function isSystemPredicate(predicateIri) {
  return SYSTEM_PREDICATES.has(predicateIri) || predicateIri.startsWith(SYSTEM_PREFIX);
}

/**
 * Convert a predicate IRI to the template-safe key used in profile layouts.
 */
function predicateToKey(predicateIri, prefixes) {
  const map = prefixes || PREFIXES;
  for (const [prefix, ns] of Object.entries(map)) {
    if (predicateIri.startsWith(ns)) {
      return prefix + '_' + predicateIri.slice(ns.length);
    }
  }
  const pos = Math.max(predicateIri.lastIndexOf('#'), predicateIri.lastIndexOf('/'));
  return pos >= 0 ? predicateIri.slice(pos + 1) : predicateIri;
}

/**
 * GET /profile — render the profile editor form.
 */
export async function renderProfileEditor(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { config, storage, env } = reqCtx;
  const url = reqCtx.url;

  const data = await buildEditorData(storage, config, env);

  // Pass through flash messages from redirect
  if (url.searchParams.has('saved')) {
    data.success = 'Profile updated successfully.';
  } else if (url.searchParams.has('reset')) {
    data.success = 'Profile page reset to default template.';
  }

  return renderPage('Edit Profile', template, data, { user: config.username, nav: 'profile', storage, baseUrl: config.baseUrl });
}

/**
 * POST /profile — handle profile update.
 */
export async function handleProfileUpdate(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { config, storage, request, env } = reqCtx;
  const webId = config.webId;
  const profileIri = `${config.baseUrl}/${config.username}/profile/card`;

  // Parse form data
  const formData = await request.formData();

  // Save layout JSON if submitted
  const layoutJsonRaw = formData.get('layout_json');
  if (layoutJsonRaw !== null) {
    try {
      const layout = JSON.parse(layoutJsonRaw);
      if (layout && layout.version && Array.isArray(layout.head) && Array.isArray(layout.body)) {
        await env.APPDATA.put(`profile_layout:${config.username}`, JSON.stringify(layout));
      }
    } catch (e) {
      // Ignore invalid JSON — keep existing layout
    }
  }

  // Save custom prefixes if submitted, and discover predicates for new namespaces
  const customPrefixesRaw = formData.get('custom_prefixes_json');
  if (customPrefixesRaw !== null) {
    try {
      const prefixMap = JSON.parse(customPrefixesRaw);
      if (typeof prefixMap === 'object' && prefixMap !== null && !Array.isArray(prefixMap)) {
        await saveCustomPrefixes(env.APPDATA, config.username, prefixMap);

        // Discover predicates for custom namespaces that haven't been indexed yet
        for (const nsIri of Object.values(prefixMap)) {
          if (BUILTIN_NS_PREDICATES[nsIri]) continue;
          const stored = await env.APPDATA.get(`ns_predicates:${nsIri}`);
          if (stored) continue;
          try {
            const discovered = await discoverNsPredicates(nsIri);
            if (discovered.length > 0) {
              await saveNsPredicates(env.APPDATA, nsIri, discovered);
            }
          } catch (e) {
            // Discovery failed — user can still type predicates manually
          }
        }
      }
    } catch (e) {
      // Ignore invalid JSON — keep existing prefixes
    }
  }

  // Read existing triples for the entire profile document
  const allTriples = await readProfileTriples(storage, config);

  // Separate triples by subject
  const webIdTriples = allTriples.filter(t => unwrapIri(t.subject) === webId);
  const otherTriples = allTriples.filter(t => unwrapIri(t.subject) !== webId);

  // Partition WebID triples into system vs editable vs custom
  const systemTriples = webIdTriples.filter(t => {
    const pred = unwrapIri(t.predicate);
    return isSystemPredicate(pred);
  });

  // Build new editable triples from form fields
  const newEditableTriples = [];
  for (const [fieldName, predicateIri] of Object.entries(FIELD_TO_PREDICATE)) {
    const value = (formData.get(fieldName) || '').trim();
    if (!value) continue;

    let object;
    if (fieldName === 'email') {
      object = iri('mailto:' + value);
    } else if (fieldName === 'img' || fieldName === 'homepage') {
      object = iri(value);
    } else {
      object = literal(value);
    }

    newEditableTriples.push({
      subject: iri(webId),
      predicate: iri(predicateIri),
      object,
    });
  }

  // Build new custom triples from form arrays
  const customPredicates = formData.getAll('custom_predicate[]');
  const customObjects = formData.getAll('custom_object[]');
  const newCustomTriples = [];
  for (let i = 0; i < customPredicates.length; i++) {
    const pred = (customPredicates[i] || '').trim();
    const obj = (customObjects[i] || '').trim();
    if (!pred || !obj) continue;

    // Determine if object looks like an IRI
    const object = obj.startsWith('http://') || obj.startsWith('https://') ? iri(obj) : literal(obj);
    newCustomTriples.push({
      subject: iri(webId),
      predicate: iri(pred),
      object,
    });
  }

  // Combine: system triples (preserved) + new editable + new custom + other-subject triples
  const finalTriples = [
    ...systemTriples,
    ...newEditableTriples,
    ...newCustomTriples,
    ...otherTriples,
  ];

  await writeTriplesToKV(storage, profileIri, finalTriples);

  return new Response(null, {
    status: 302,
    headers: { 'Location': '/profile?saved=1' },
  });
}

/**
 * POST /profile/discover-ns — discover predicates for a namespace IRI (AJAX).
 */
export async function handleDiscoverNs(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { config, env, request } = reqCtx;
  const formData = await request.formData();
  const nsIri = (formData.get('ns_iri') || '').trim();

  if (!nsIri) {
    return new Response(JSON.stringify({ error: 'Missing ns_iri' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const discovered = await discoverNsPredicates(nsIri);
    if (discovered.length > 0) {
      await saveNsPredicates(env.APPDATA, nsIri, discovered);
    }
    return new Response(JSON.stringify({ count: discovered.length, predicates: discovered }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || 'Discovery failed', count: 0, predicates: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * POST /profile/reset-index — reset root container index.html to the default template.
 */
export async function handleProfileIndexReset(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { config, env } = reqCtx;

  // Delete custom layout — profile page will render with DEFAULT_LAYOUT
  await env.APPDATA.delete(`profile_layout:${config.username}`);

  return new Response(null, {
    status: 302,
    headers: { 'Location': '/profile?reset=1' },
  });
}

/**
 * Build the template data object for the profile editor.
 */
async function buildEditorData(storage, config, env) {
  const allTriples = await readProfileTriples(storage, config);
  const webId = config.webId;
  const customPrefixes = await loadCustomPrefixes(env.APPDATA, config.username);
  const mergedPrefixes = { ...PREFIXES, ...customPrefixes };

  const data = {
    username: config.username,
    webId,
    name: '',
    nick: '',
    img: '',
    email: '',
    homepage: '',
    bio: '',
    role: '',
    description: '',
    customTriples: [],
    systemTriples: [],
    hasSystemTriples: false,
  };

  for (const t of allTriples) {
    const subjectIri = unwrapIri(t.subject);
    if (subjectIri !== webId) continue;

    const predicateIri = unwrapIri(t.predicate);
    const fieldName = EDITABLE_FIELDS[predicateIri];

    // Determine the object value
    let objectValue;
    if (t.object.startsWith('<')) {
      objectValue = unwrapIri(t.object);
    } else {
      objectValue = unwrapLiteral(t.object);
    }

    if (fieldName) {
      let val = objectValue;
      if (fieldName === 'email' && val.startsWith('mailto:')) {
        val = val.slice(7);
      }
      data[fieldName] = val;
    } else if (isSystemPredicate(predicateIri)) {
      data.systemTriples.push({
        predicate: predicateIri,
        predicateShort: shortenPredicate(predicateIri, mergedPrefixes),
        object: objectValue,
      });
    } else {
      // Custom triple
      data.customTriples.push({
        predicate: predicateIri,
        predicateShort: shortenPredicate(predicateIri, mergedPrefixes),
        templateKey: predicateToKey(predicateIri, mergedPrefixes),
        object: objectValue,
      });
    }
  }

  data.hasSystemTriples = data.systemTriples.length > 0;
  data.prefixesJson = JSON.stringify(mergedPrefixes);

  // Custom prefix management data
  const customPrefixList = Object.entries(customPrefixes).map(([name, ns]) => ({ name, ns }));
  data.customPrefixList = customPrefixList;
  data.hasCustomPrefixes = customPrefixList.length > 0;
  data.customPrefixesJson = JSON.stringify(customPrefixes);

  // Predicate catalog for namespace browsing
  const catalog = await loadPredicateCatalog(env.APPDATA, mergedPrefixes);
  data.namespaceCatalogJson = JSON.stringify(catalog);

  // Page builder: load layout JSON
  const layoutRaw = await env.APPDATA.get(`profile_layout:${config.username}`);
  data.layoutJson = layoutRaw || JSON.stringify(DEFAULT_LAYOUT);

  // Available profile fields for binding picker
  const profileFields = [
    { key: 'name', label: 'Name (foaf:name)' },
    { key: 'nick', label: 'Nickname (foaf:nick)' },
    { key: 'img', label: 'Avatar URL (foaf:img)' },
    { key: 'email', label: 'Email (foaf:mbox)' },
    { key: 'homepage', label: 'Homepage (foaf:homepage)' },
    { key: 'bio', label: 'Bio (vcard:note)' },
    { key: 'role', label: 'Role (vcard:role)' },
    { key: 'description', label: 'Description (schema:description)' },
    { key: 'webId', label: 'WebID' },
    { key: 'username', label: 'Username' },
    { key: 'domain', label: 'Domain' },
    { key: 'baseUrl', label: 'Base URL' },
  ];
  // Add custom triple keys dynamically
  for (const ct of data.customTriples) {
    if (ct.templateKey) {
      profileFields.push({ key: ct.templateKey, label: ct.predicateShort + ' (scalar)' });
      profileFields.push({ key: ct.templateKey + '_list', label: ct.predicateShort + ' (list)' });
      profileFields.push({ key: 'has_' + ct.templateKey, label: ct.predicateShort + ' (conditional)' });
    }
  }
  data.profileFieldsJson = JSON.stringify(profileFields);

  return data;
}

/**
 * POST /profile/preview-layout — render a layout preview with current profile data.
 */
export async function handlePreviewLayout(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { config, storage, env, request } = reqCtx;
  const formData = await request.formData();
  const layoutJsonRaw = formData.get('layout_json');

  if (!layoutJsonRaw) {
    return new Response('Missing layout_json', { status: 400 });
  }

  let layout;
  try {
    layout = JSON.parse(layoutJsonRaw);
  } catch (e) {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { renderLayout } = await import('../layout-renderer.js');
  const { buildProfileTemplateData } = await import('../../solid/ldp.js');
  const profileData = await buildProfileTemplateData(storage, config, env.APPDATA);
  const html = renderLayout(layout, profileData);

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/**
 * GET /profile/components — list user's registered components (JSON).
 */
export async function handleListComponents(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { config, env } = reqCtx;
  const raw = await env.APPDATA.get(`component_registry:${config.username}`);
  const components = raw ? JSON.parse(raw) : [];

  return new Response(JSON.stringify(components), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * POST /profile/components — register or update a component.
 */
export async function handleSaveComponent(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { config, env, request } = reqCtx;
  const formData = await request.formData();
  const name = (formData.get('name') || '').trim();
  const description = (formData.get('description') || '').trim();
  const file = (formData.get('file') || '').trim();
  const published = formData.get('published') === 'true';

  if (!name || !file) {
    return new Response(JSON.stringify({ error: 'name and file are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const raw = await env.APPDATA.get(`component_registry:${config.username}`);
  const components = raw ? JSON.parse(raw) : [];

  const existing = components.findIndex(c => c.name === name);
  const entry = { name, description, file, published };
  if (existing >= 0) {
    components[existing] = entry;
  } else {
    components.push(entry);
  }

  await env.APPDATA.put(`component_registry:${config.username}`, JSON.stringify(components));

  // If published, set ACP to public-read on the JS file
  if (published) {
    const fileIri = `${config.baseUrl}${file}`;
    await env.APPDATA.put(`acp:${fileIri}`, JSON.stringify({
      mode: 'public', agents: [], inherit: false,
    }));
  }

  return new Response(JSON.stringify(entry), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * POST /profile/import-component — import a component from a remote URL.
 */
export async function handleImportComponent(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { config, env, storage, request } = reqCtx;
  const formData = await request.formData();
  const url = (formData.get('url') || '').trim();

  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Fetch the remote component JS
    const resp = await fetch(url);
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: `Fetch failed: ${resp.status}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const jsContent = await resp.arrayBuffer();

    // Extract component name from URL path
    const urlPath = new URL(url).pathname;
    const fileName = urlPath.split('/').pop() || 'component.js';
    const componentName = fileName.replace(/\.js$/, '');

    // Save to local paa_custom/components/
    const localPath = `/${config.username}/paa_custom/components/${fileName}`;
    const localIri = `${config.baseUrl}${localPath}`;

    // Store as binary blob
    const metaDoc = [
      `<${localIri}> <http://purl.org/dc/terms/format> "application/javascript" .`,
      `<${localIri}> <http://purl.org/dc/terms/extent> "${jsContent.byteLength}"^^<http://www.w3.org/2001/XMLSchema#integer> .`,
    ].join('\n');

    await storage.putBlob(`blob:${localIri}`, jsContent, 'application/javascript');
    await storage.put(`idx:${localIri}`, JSON.stringify({ binary: true }));
    await storage.put(`doc:${localIri}.meta:${localIri}`, metaDoc);

    // Register locally
    const raw = await env.APPDATA.get(`component_registry:${config.username}`);
    const components = raw ? JSON.parse(raw) : [];
    const existing = components.findIndex(c => c.name === componentName);
    const entry = { name: componentName, description: `Imported from ${url}`, file: localPath, published: false };
    if (existing >= 0) {
      components[existing] = entry;
    } else {
      components.push(entry);
    }
    await env.APPDATA.put(`component_registry:${config.username}`, JSON.stringify(components));

    return new Response(JSON.stringify({ name: componentName, file: localPath }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || 'Import failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
