/**
 * i18n runtime — parse translations, resolve language, cache lookups.
 *
 * Translations are stored as RDF triples in Turtle format (strings.js).
 * Each string key is a paa: namespace IRI with rdfs:label predicates
 * carrying language-tagged literals.
 *
 * Language resolution priority:
 *   1. User preference (KV: user_prefs:{username})
 *   2. Deployment variable (PAA_LANGUAGE)
 *   3. Accept-Language header
 *   4. Default: en-US
 */
import { parseTurtle } from '../rdf/turtle-parser.js';
import { STRINGS_TURTLE } from './strings.js';

const PAA_NS = 'http://paa.pub/i18n#';
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';

export const SUPPORTED_LANGUAGES = [
  { code: 'en-US', name: 'English', nativeName: 'English' },
  { code: 'fr', name: 'French', nativeName: 'Fran\u00e7ais' },
  { code: 'es', name: 'Spanish', nativeName: 'Espa\u00f1ol' },
  { code: 'he', name: 'Hebrew', nativeName: '\u05e2\u05d1\u05e8\u05d9\u05ea' },
  { code: 'zh', name: 'Chinese', nativeName: '\u4e2d\u6587' },
];

export const RTL_LANGUAGES = new Set(['he']);

const SUPPORTED_CODES = new Set(SUPPORTED_LANGUAGES.map(l => l.code));

// ── Parse translations once at module level ──────────

/** Map<key, Map<lang, text>> */
const translationMap = new Map();

const triples = parseTurtle(STRINGS_TURTLE);
for (const { subject, predicate, object } of triples) {
  // Only process rdfs:label triples on paa: subjects
  const pred = predicate.replace(/^<|>$/g, '');
  if (pred !== RDFS_LABEL) continue;

  const subj = subject.replace(/^<|>$/g, '');
  if (!subj.startsWith(PAA_NS)) continue;

  const key = subj.slice(PAA_NS.length);

  // Parse language-tagged literal: "text"@lang
  const match = object.match(/^"((?:[^"\\]|\\.)*)"\s*@\s*(.+)$/);
  if (!match) continue;

  const text = match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
  const lang = match[2];

  if (!translationMap.has(key)) {
    translationMap.set(key, new Map());
  }
  translationMap.get(key).set(lang, text);
}

// ── Translation cache ────────────────────────────────

const cache = new Map();

/**
 * Get a flat { key: text } object for the given language.
 * Falls back to en-US for missing keys.
 * @param {string} lang - BCP 47 language tag
 * @returns {Object<string, string>}
 */
export function getTranslations(lang) {
  if (cache.has(lang)) return cache.get(lang);

  const result = {};
  for (const [key, langMap] of translationMap) {
    result[key] = langMap.get(lang) || langMap.get('en-US') || key;
  }

  cache.set(lang, result);
  return result;
}

/**
 * Resolve the effective language for a request.
 *
 * Priority: userPrefs.language > configLang > Accept-Language > en-US
 *
 * @param {Request} request
 * @param {string} configLang - PAA_LANGUAGE from config
 * @param {object|null} userPrefs - parsed user preferences from KV
 * @returns {string} BCP 47 language tag
 */
export function resolveLanguage(request, configLang, userPrefs) {
  // 1. User preference
  if (userPrefs?.language && SUPPORTED_CODES.has(userPrefs.language)) {
    return userPrefs.language;
  }

  // 2. Deployment variable
  if (configLang && SUPPORTED_CODES.has(configLang)) {
    return configLang;
  }

  // 3. Accept-Language header
  const accept = request.headers.get('Accept-Language');
  if (accept) {
    const parsed = parseAcceptLanguage(accept);
    for (const tag of parsed) {
      if (SUPPORTED_CODES.has(tag)) return tag;
      // Try base language (e.g. "fr-FR" → "fr")
      const base = tag.split('-')[0];
      for (const code of SUPPORTED_CODES) {
        if (code === base || code.startsWith(base + '-')) return code;
      }
    }
  }

  // 4. Default
  return 'en-US';
}

/**
 * Parse an Accept-Language header into an ordered list of language tags.
 * @param {string} header
 * @returns {string[]} tags sorted by quality (descending)
 */
function parseAcceptLanguage(header) {
  return header
    .split(',')
    .map(part => {
      const [tag, ...rest] = part.trim().split(';');
      const qMatch = rest.join(';').match(/q\s*=\s*([\d.]+)/);
      return { tag: tag.trim(), q: qMatch ? parseFloat(qMatch[1]) : 1 };
    })
    .filter(({ tag }) => tag && tag !== '*')
    .sort((a, b) => b.q - a.q)
    .map(({ tag }) => tag);
}
