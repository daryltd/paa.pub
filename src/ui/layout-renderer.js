/**
 * Layout renderer — renders a profile page from a JSON layout and profile data.
 *
 * The layout is a tree of nodes (HTML elements) with template variable
 * substitution, conditional rendering, and repeat/iteration support.
 * Output includes RDFa attributes for semantic web compatibility.
 *
 * Exports:
 *   renderLayout(layout, profileData) → string   Full HTML document
 *   DEFAULT_LAYOUT                                Built-in default layout
 */

// --- Tag validation ---

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

const ALLOWED_TAGS = new Set([
  // Head-only
  'link', 'meta',
  // Head leaf
  'style', 'script',
  // Structure
  'header', 'nav', 'main', 'footer', 'section', 'article', 'aside', 'div',
  // Content
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'a', 'pre', 'code', 'blockquote',
  'strong', 'em', 'small', 'b', 'i', 'u', 'sub', 'sup', 'mark', 'abbr', 'time',
  // Void
  'img', 'br', 'hr',
  // List/Table
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
  // Other
  'details', 'summary', 'figure', 'figcaption', 'picture', 'video', 'audio', 'source',
]);

const RAW_CONTENT_TAGS = new Set(['script', 'style']);

const RDFA_ATTRS = new Set(['about', 'typeof', 'property', 'rel', 'resource', 'prefix', 'vocab', 'datatype', 'content', 'inlist']);

/**
 * Check if a tag name is valid: either in the allowlist or a custom element (contains hyphen).
 */
function isValidTag(tag) {
  if (!tag || typeof tag !== 'string') return false;
  const t = tag.toLowerCase();
  if (ALLOWED_TAGS.has(t)) return true;
  // Custom elements must contain a hyphen and only have alphanumeric/hyphens
  if (t.includes('-') && /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(t)) return true;
  return false;
}

/**
 * Check if an attribute name is valid.
 */
function isValidAttrName(name) {
  if (!name || typeof name !== 'string') return false;
  return /^[a-zA-Z_][a-zA-Z0-9\-_:.]*$/.test(name);
}

// --- HTML escaping ---

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>"']/g, c => ESC_MAP[c]);
}

function escapeAttr(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>"]/g, c => ESC_MAP[c]);
}

// --- Template substitution ---

/**
 * Replace {{key}} patterns with values from data, falling back to globalData.
 * Returns empty string for missing keys.
 */
function substitute(str, data, globalData) {
  if (typeof str !== 'string') return '';
  return str.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (data && data[key] !== undefined && data[key] !== null) return String(data[key]);
    if (globalData && globalData[key] !== undefined && globalData[key] !== null) return String(globalData[key]);
    return '';
  });
}

// --- Node rendering ---

/**
 * Render a single node and its children to HTML.
 * @param {object} node - Layout node
 * @param {object} data - Current scope data (may be item data in repeat context)
 * @param {object} globalData - Top-level profile data
 * @returns {string} HTML string
 */
function renderNode(node, data, globalData) {
  if (!node || !node.tag) return '';
  if (!isValidTag(node.tag)) return '';

  const tag = node.tag.toLowerCase();

  // Check conditional
  if (node.conditional) {
    const val = data[node.conditional] !== undefined ? data[node.conditional] : globalData[node.conditional];
    if (!val) return '';
  }

  // Handle repeat
  if (node.repeat) {
    const list = data[node.repeat] || globalData[node.repeat];
    if (!Array.isArray(list) || list.length === 0) return '';
    let result = '';
    for (const item of list) {
      // Render the node once per item, with item as local data
      const itemNode = { ...node, repeat: null };
      result += renderNode(itemNode, item, globalData);
    }
    return result;
  }

  // Build attributes
  let attrStr = '';
  const allAttrs = {};

  // Merge regular attrs
  if (node.attrs && typeof node.attrs === 'object') {
    for (const [name, val] of Object.entries(node.attrs)) {
      if (isValidAttrName(name)) {
        allAttrs[name] = substitute(String(val), data, globalData);
      }
    }
  }

  // Merge RDFa attrs
  if (node.rdfa && typeof node.rdfa === 'object') {
    for (const [name, val] of Object.entries(node.rdfa)) {
      if (RDFA_ATTRS.has(name) || isValidAttrName(name)) {
        allAttrs[name] = substitute(String(val), data, globalData);
      }
    }
  }

  for (const [name, val] of Object.entries(allAttrs)) {
    attrStr += ` ${name}="${escapeAttr(val)}"`;
  }

  // Void elements — self-closing, no content or children
  if (VOID_ELEMENTS.has(tag)) {
    return `<${tag}${attrStr}>`;
  }

  let inner = '';

  // Content
  if (node.content != null) {
    const substituted = substitute(node.content, data, globalData);
    if (RAW_CONTENT_TAGS.has(tag)) {
      inner = substituted;
    } else {
      inner = escapeHtml(substituted);
    }
  }

  // Children (only if no content set, or tag supports both)
  if (node.children && Array.isArray(node.children) && !RAW_CONTENT_TAGS.has(tag)) {
    for (const child of node.children) {
      inner += renderNode(child, data, globalData);
    }
  }

  return `<${tag}${attrStr}>${inner}</${tag}>`;
}

// --- Main render function ---

/**
 * Render a complete HTML document from a layout and profile data.
 * @param {object} layout - Page layout JSON
 * @param {object} profileData - Profile template data from buildProfileTemplateData()
 * @returns {string} Full HTML document string
 */
export function renderLayout(layout, profileData) {
  if (!layout || !layout.meta) {
    layout = DEFAULT_LAYOUT;
  }

  const data = profileData || {};
  const meta = layout.meta || {};

  const title = substitute(meta.title || '', data, data);
  const lang = meta.lang || 'en';
  const prefix = meta.prefix || '';

  // Render head nodes
  let headContent = '';
  headContent += `<meta charset="utf-8">`;
  headContent += `<meta name="viewport" content="width=device-width, initial-scale=1">`;
  headContent += `<title>${escapeHtml(title)}</title>`;

  if (Array.isArray(layout.head)) {
    for (const node of layout.head) {
      headContent += renderNode(node, data, data);
    }
  }

  // Render body nodes
  let bodyContent = '';
  if (Array.isArray(layout.body)) {
    for (const node of layout.body) {
      bodyContent += renderNode(node, data, data);
    }
  }

  return `<!DOCTYPE html>\n<html lang="${escapeAttr(lang)}" prefix="${escapeAttr(prefix)}">\n<head>${headContent}</head>\n<body>${bodyContent}</body>\n</html>`;
}

// --- Default layout ---

/**
 * Default layout for the public profile page.
 * Renders a profile card with avatar, name, role, details, and custom groups.
 */
export const DEFAULT_LAYOUT = {
  version: 1,
  meta: {
    title: '{{name}} - {{domain}}',
    lang: 'en',
    prefix: 'foaf: http://xmlns.com/foaf/0.1/ vcard: http://www.w3.org/2006/vcard/ns# schema: https://schema.org/',
  },
  head: [
    { id: 'dh1', tag: 'link', attrs: { rel: 'stylesheet', href: '/css/base.css' } },
  ],
  body: [
    {
      id: 'db1', tag: 'main', rdfa: { about: '{{webId}}', typeof: 'foaf:Person' },
      children: [
        // Card with avatar, name, role
        { id: 'db2', tag: 'div', attrs: { class: 'card' }, children: [
          { id: 'db3', tag: 'img', attrs: { src: '{{img}}', alt: '{{name}}', class: 'avatar img-preview mb-075' }, rdfa: { property: 'foaf:img' }, conditional: 'img' },
          { id: 'db4', tag: 'h1', content: '{{name}}', rdfa: { property: 'foaf:name' } },
          { id: 'db5', tag: 'p', attrs: { class: 'text-muted' }, content: '{{role}}', rdfa: { property: 'vcard:role' }, conditional: 'role' },
        ]},
        // Details card with bio, description, email, homepage, nick
        { id: 'db6', tag: 'div', attrs: { class: 'card' }, children: [
          { id: 'db7', tag: 'h2', content: 'Details' },
          { id: 'db8', tag: 'p', content: '{{bio}}', rdfa: { property: 'vcard:note' }, conditional: 'bio' },
          { id: 'db9', tag: 'p', content: '{{description}}', rdfa: { property: 'schema:description' }, conditional: 'description' },
          { id: 'db10', tag: 'p', conditional: 'email', children: [
            { id: 'db10a', tag: 'span', content: 'Email: ' },
            { id: 'db10b', tag: 'a', attrs: { href: 'mailto:{{email}}' }, content: '{{email}}', rdfa: { rel: 'foaf:mbox' } },
          ]},
          { id: 'db11', tag: 'p', conditional: 'homepage', children: [
            { id: 'db11a', tag: 'span', content: 'Web: ' },
            { id: 'db11b', tag: 'a', attrs: { href: '{{homepage}}' }, content: '{{homepage}}', rdfa: { rel: 'foaf:homepage' } },
          ]},
          { id: 'db12', tag: 'p', conditional: 'nick', children: [
            { id: 'db12a', tag: 'span', content: 'Nickname: ' },
            { id: 'db12b', tag: 'span', content: '{{nick}}', rdfa: { property: 'foaf:nick' } },
          ]},
        ]},
        // WebID link
        { id: 'db13', tag: 'div', attrs: { class: 'card' }, children: [
          { id: 'db14', tag: 'a', attrs: { href: '{{webId}}', class: 'mono text-muted text-sm' }, content: 'WebID' },
        ]},
      ],
    },
  ],
};
