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
import defaultIndexTemplate from '../templates/default-index.html';
import { requireAuth } from '../../auth/middleware.js';
import { readProfileTriples, writeTriplesToKV } from '../../solid/ldp.js';
import { parseNTriples, iri, unwrapIri, unwrapLiteral, literal } from '../../rdf/ntriples.js';
import { PREFIXES, shortenPredicate, loadMergedPrefixes } from '../../rdf/prefixes.js';

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
 * Convert a predicate IRI to the Mustache-safe key used in profile templates.
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

  const { config, storage } = reqCtx;
  const url = reqCtx.url;

  const data = await buildEditorData(storage, config);

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

  const { config, storage, request } = reqCtx;
  const webId = config.webId;
  const profileIri = `${config.baseUrl}/${config.username}/profile/card`;

  // Parse form data
  const formData = await request.formData();

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
 * POST /profile/reset-index — reset root container index.html to the default template.
 */
export async function handleProfileIndexReset(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { config, storage, env } = reqCtx;
  const indexHtmlIri = `${config.baseUrl}/${config.username}/index.html`;

  const htmlBytes = new TextEncoder().encode(defaultIndexTemplate);
  await storage.putBlob(`blob:${indexHtmlIri}`, htmlBytes, 'text/html');

  // Also delete paa_custom/index.html override if it exists
  const customIndexIri = `${config.baseUrl}/${config.username}/paa_custom/index.html`;
  const customBlob = await storage.getBlob(`blob:${customIndexIri}`);
  if (customBlob) {
    // Delete blob, idx, metadata, ACP
    try { await storage.deleteBlob(`blob:${customIndexIri}`); } catch {}
    const idx = await storage.get(`idx:${customIndexIri}`);
    if (idx) {
      const parsed = JSON.parse(idx);
      for (const subj of parsed.subjects || []) {
        await storage.delete(`doc:${customIndexIri}:${subj}`);
      }
      await storage.delete(`idx:${customIndexIri}`);
    }
    await storage.delete(`doc:${customIndexIri}.meta:${customIndexIri}`);
    await env.APPDATA.delete(`acp:${customIndexIri}`);

    // Remove containment from paa_custom/ container
    const paaCustomIri = `${config.baseUrl}/${config.username}/paa_custom/`;
    const docKey = `doc:${paaCustomIri}:${paaCustomIri}`;
    const parentDoc = await storage.get(docKey);
    if (parentDoc) {
      const triples = parseNTriples(parentDoc);
      const filtered = triples.filter(t =>
        !(unwrapIri(t.predicate) === PREFIXES.ldp + 'contains' && unwrapIri(t.object) === customIndexIri)
      );
      const { serializeNTriples: serNT } = await import('../../rdf/ntriples.js');
      await storage.put(docKey, serNT(filtered));
    }
  }

  return new Response(null, {
    status: 302,
    headers: { 'Location': '/profile?reset=1' },
  });
}

/**
 * Build the template data object for the profile editor.
 */
async function buildEditorData(storage, config) {
  const allTriples = await readProfileTriples(storage, config);
  const webId = config.webId;
  const mergedPrefixes = await loadMergedPrefixes(storage, config.baseUrl, config.username);

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

  return data;
}
