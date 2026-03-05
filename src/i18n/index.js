/**
 * i18n runtime — parse Turtle translation store, resolve language, cache lookups.
 *
 * The translation store is a Turtle RDF document where each UI string is a
 * subject with rdfs:label predicates carrying language-tagged literals:
 *
 *   paa:nav_dashboard rdfs:label "Dashboard"@en-US .
 *   paa:nav_dashboard rdfs:label "Tableau de bord"@fr .
 *
 * This module parses the Turtle once at module level, builds a lookup map,
 * and exports functions to retrieve translations for a given language and
 * to resolve which language to use for a request.
 */

import { parseTurtle } from '../rdf/turtle-parser.js';
import STRINGS_TURTLE from './strings.ttl';

const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
const PAA_NS = 'http://paa.pub/i18n#';

/** Supported languages with display metadata. */
export const SUPPORTED_LANGUAGES = [
  { code: 'en-US', name: 'English', nativeName: 'English' },
  { code: 'fr', name: 'French', nativeName: 'Fran\u00e7ais' },
  { code: 'es', name: 'Spanish', nativeName: 'Espa\u00f1ol' },
  { code: 'he', name: 'Hebrew', nativeName: '\u05E2\u05D1\u05E8\u05D9\u05EA' },
  { code: 'zh', name: 'Chinese', nativeName: '\u4E2D\u6587' },
];

const SUPPORTED_CODES = new Set(SUPPORTED_LANGUAGES.map(l => l.code));

/** Languages that use right-to-left layout. */
export const RTL_LANGUAGES = new Set(['he']);

/**
 * Map<key, Map<lang, text>> built from parsed Turtle triples.
 * Key is the local part after the paa: namespace (e.g. "nav_dashboard").
 */
const strings = new Map();

// Parse the Turtle translation store once at module load.
const triples = parseTurtle(STRINGS_TURTLE);
for (const { subject, predicate, object } of triples) {
  // Only process rdfs:label triples on paa: subjects
  const pred = subject.startsWith('<') ? subject.slice(1, -1) : subject;
  if (!pred.startsWith(PAA_NS)) continue;
  const p = predicate.startsWith('<') ? predicate.slice(1, -1) : predicate;
  if (p !== RDFS_LABEL) continue;

  const key = pred.slice(PAA_NS.length);

  // Extract text and language tag from literal: "text"@lang
  const match = object.match(/^"((?:[^"\\]|\\.)*)"\s*@\s*(.+)$/);
  if (!match) continue;
  const text = match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
  const lang = match[2];

  if (!strings.has(key)) strings.set(key, new Map());
  strings.get(key).set(lang, text);
}

/** Cache of flat { key: text } objects per language. */
const cache = new Map();

/**
 * Get a flat { key: text } translation object for a language.
 * Falls back to en-US for any missing keys.
 * @param {string} lang - BCP 47 language tag
 * @returns {object}
 */
export function getTranslations(lang) {
  if (cache.has(lang)) return cache.get(lang);

  const result = {};
  for (const [key, langMap] of strings) {
    result[key] = langMap.get(lang) || langMap.get('en-US') || '';
  }

  cache.set(lang, result);
  return result;
}

/**
 * Resolve which language to use for a request.
 * Priority: user preference > Accept-Language header > default (en-US).
 * @param {Request} request
 * @param {object|null} userPrefs - user preferences object (may have .language)
 * @returns {string} BCP 47 language tag
 */
export function resolveLanguage(request, userPrefs) {
  // 1. User preference
  if (userPrefs && userPrefs.language && SUPPORTED_CODES.has(userPrefs.language)) {
    return userPrefs.language;
  }

  // 2. Accept-Language header
  const accept = request.headers.get('Accept-Language');
  if (accept) {
    const parsed = parseAcceptLanguage(accept);
    for (const tag of parsed) {
      if (SUPPORTED_CODES.has(tag)) return tag;
      // Try base language match (e.g. "fr-FR" → "fr")
      const base = tag.split('-')[0];
      for (const supported of SUPPORTED_CODES) {
        if (supported === base || supported.startsWith(base + '-')) return supported;
      }
    }
  }

  // 3. Default
  return 'en-US';
}

/**
 * Parse Accept-Language header into an ordered list of language tags.
 * Sorts by quality factor (q value) descending.
 * @param {string} header
 * @returns {string[]}
 */
function parseAcceptLanguage(header) {
  return header
    .split(',')
    .map(part => {
      const [tag, ...params] = part.trim().split(';');
      let q = 1;
      for (const p of params) {
        const m = p.trim().match(/^q\s*=\s*([\d.]+)$/);
        if (m) q = parseFloat(m[1]);
      }
      return { tag: tag.trim(), q };
    })
    .sort((a, b) => b.q - a.q)
    .map(x => x.tag);
}
