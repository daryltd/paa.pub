/**
 * Media type resolution from file extensions.
 *
 * Comprehensive mapping based on the IANA media type registry
 * (https://www.iana.org/assignments/media-types/media-types.xhtml).
 * Used to infer Content-Type when clients send a generic type
 * (e.g. application/octet-stream) or omit it entirely.
 */

/**
 * Extension-to-media-type map.  Keys are lowercase extensions without dot.
 * Where IANA defines multiple types for an extension the most common is used.
 */
const EXT_MAP = {
  // ── text ──────────────────────────────────────────────────────────────
  txt:        'text/plain',
  text:       'text/plain',
  log:        'text/plain',
  conf:       'text/plain',
  cfg:        'text/plain',
  ini:        'text/plain',
  diff:       'text/plain',
  patch:      'text/plain',
  html:       'text/html',
  htm:        'text/html',
  xhtml:      'application/xhtml+xml',
  css:        'text/css',
  csv:        'text/csv',
  tsv:        'text/tab-separated-values',
  md:         'text/markdown',
  markdown:   'text/markdown',
  rtf:        'text/rtf',
  xml:        'text/xml',
  dtd:        'application/xml-dtd',
  xsl:        'application/xslt+xml',
  xslt:       'application/xslt+xml',
  sgml:       'text/sgml',
  sgm:        'text/sgml',
  yaml:       'text/yaml',
  yml:        'text/yaml',
  vcard:      'text/vcard',
  vcf:        'text/vcard',
  ics:        'text/calendar',
  ifb:        'text/calendar',
  vtt:        'text/vtt',
  srt:        'text/plain',

  // ── javascript / ecmascript ───────────────────────────────────────────
  js:         'application/javascript',
  mjs:        'application/javascript',
  cjs:        'application/javascript',

  // ── json family ───────────────────────────────────────────────────────
  json:       'application/json',
  jsonld:     'application/ld+json',
  geojson:    'application/geo+json',
  map:        'application/json',
  topojson:   'application/json',
  webmanifest:'application/manifest+json',
  har:        'application/json',

  // ── RDF / Linked Data ─────────────────────────────────────────────────
  ttl:        'text/turtle',
  turtle:     'text/turtle',
  nt:         'application/n-triples',
  ntriples:   'application/n-triples',
  nq:         'application/n-quads',
  nquads:     'application/n-quads',
  trig:       'application/trig',
  rdf:        'application/rdf+xml',
  rdfxml:     'application/rdf+xml',
  owl:        'application/rdf+xml',
  n3:         'text/n3',

  // ── images ────────────────────────────────────────────────────────────
  png:        'image/png',
  apng:       'image/apng',
  jpg:        'image/jpeg',
  jpeg:       'image/jpeg',
  jpe:        'image/jpeg',
  jfif:       'image/jpeg',
  gif:        'image/gif',
  webp:       'image/webp',
  avif:       'image/avif',
  svg:        'image/svg+xml',
  svgz:       'image/svg+xml',
  bmp:        'image/bmp',
  ico:        'image/x-icon',
  cur:        'image/x-icon',
  tif:        'image/tiff',
  tiff:       'image/tiff',
  heic:       'image/heic',
  heif:       'image/heif',
  jp2:        'image/jp2',
  jxl:        'image/jxl',
  psd:        'image/vnd.adobe.photoshop',
  raw:        'image/x-raw',
  cr2:        'image/x-canon-cr2',
  nef:        'image/x-nikon-nef',
  arw:        'image/x-sony-arw',
  dng:        'image/x-adobe-dng',
  ktx:        'image/ktx',
  ktx2:       'image/ktx2',

  // ── audio ─────────────────────────────────────────────────────────────
  mp3:        'audio/mpeg',
  mp2:        'audio/mpeg',
  ogg:        'audio/ogg',
  oga:        'audio/ogg',
  opus:       'audio/opus',
  wav:        'audio/wav',
  wave:       'audio/wav',
  flac:       'audio/flac',
  aac:        'audio/aac',
  m4a:        'audio/mp4',
  weba:       'audio/webm',
  mid:        'audio/midi',
  midi:       'audio/midi',
  aiff:       'audio/aiff',
  aif:        'audio/aiff',
  au:         'audio/basic',
  snd:        'audio/basic',
  wma:        'audio/x-ms-wma',
  ra:         'audio/vnd.rn-realaudio',
  amr:        'audio/amr',
  '3gpp':     'audio/3gpp',

  // ── video ─────────────────────────────────────────────────────────────
  mp4:        'video/mp4',
  m4v:        'video/mp4',
  webm:       'video/webm',
  ogv:        'video/ogg',
  avi:        'video/x-msvideo',
  mov:        'video/quicktime',
  qt:         'video/quicktime',
  mkv:        'video/x-matroska',
  mk3d:       'video/x-matroska',
  flv:        'video/x-flv',
  wmv:        'video/x-ms-wmv',
  mpg:        'video/mpeg',
  mpeg:       'video/mpeg',
  mpe:        'video/mpeg',
  m2v:        'video/mpeg',
  ts:         'video/mp2t',
  mts:        'video/mp2t',
  '3gp':      'video/3gpp',
  '3g2':      'video/3gpp2',
  f4v:        'video/mp4',

  // ── fonts ─────────────────────────────────────────────────────────────
  woff:       'font/woff',
  woff2:      'font/woff2',
  ttf:        'font/ttf',
  otf:        'font/otf',
  eot:        'application/vnd.ms-fontobject',

  // ── archives / compressed ─────────────────────────────────────────────
  zip:        'application/zip',
  gz:         'application/gzip',
  gzip:       'application/gzip',
  bz2:        'application/x-bzip2',
  xz:         'application/x-xz',
  zst:        'application/zstd',
  zstd:       'application/zstd',
  tar:        'application/x-tar',
  tgz:        'application/gzip',
  rar:        'application/vnd.rar',
  '7z':       'application/x-7z-compressed',
  lz:         'application/x-lzip',
  lzma:       'application/x-lzma',
  br:         'application/x-brotli',
  cab:        'application/vnd.ms-cab-compressed',
  dmg:        'application/x-apple-diskimage',
  iso:        'application/x-iso9660-image',
  cpio:       'application/x-cpio',
  rpm:        'application/x-rpm',
  deb:        'application/vnd.debian.binary-package',
  jar:        'application/java-archive',
  war:        'application/java-archive',
  ear:        'application/java-archive',

  // ── documents / office ────────────────────────────────────────────────
  pdf:        'application/pdf',
  doc:        'application/msword',
  docx:       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  dot:        'application/msword',
  dotx:       'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  xls:        'application/vnd.ms-excel',
  xlsx:       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlt:        'application/vnd.ms-excel',
  xltx:       'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  ppt:        'application/vnd.ms-powerpoint',
  pptx:       'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pot:        'application/vnd.ms-powerpoint',
  potx:       'application/vnd.openxmlformats-officedocument.presentationml.template',
  odt:        'application/vnd.oasis.opendocument.text',
  ods:        'application/vnd.oasis.opendocument.spreadsheet',
  odp:        'application/vnd.oasis.opendocument.presentation',
  odg:        'application/vnd.oasis.opendocument.graphics',
  odc:        'application/vnd.oasis.opendocument.chart',
  odf:        'application/vnd.oasis.opendocument.formula',
  odb:        'application/vnd.oasis.opendocument.database',
  pages:      'application/vnd.apple.pages',
  numbers:    'application/vnd.apple.numbers',
  key:        'application/vnd.apple.keynote',
  epub:       'application/epub+zip',
  mobi:       'application/x-mobipocket-ebook',
  azw:        'application/vnd.amazon.ebook',
  azw3:       'application/vnd.amazon.ebook',

  // ── executables / binaries ────────────────────────────────────────────
  wasm:       'application/wasm',
  exe:        'application/vnd.microsoft.portable-executable',
  dll:        'application/vnd.microsoft.portable-executable',
  so:         'application/x-sharedlib',
  dylib:      'application/x-sharedlib',
  elf:        'application/x-elf',
  msi:        'application/x-msi',
  apk:        'application/vnd.android.package-archive',
  ipa:        'application/x-ios-app',
  appimage:   'application/x-appimage',

  // ── data / database ───────────────────────────────────────────────────
  sql:        'application/sql',
  sqlite:     'application/vnd.sqlite3',
  sqlite3:    'application/vnd.sqlite3',
  db:         'application/octet-stream',
  dbf:        'application/dbf',
  mdb:        'application/x-msaccess',
  accdb:      'application/x-msaccess',

  // ── markup / programming ──────────────────────────────────────────────
  py:         'text/x-python',
  rb:         'text/x-ruby',
  pl:         'text/x-perl',
  pm:         'text/x-perl',
  sh:         'application/x-sh',
  bash:       'application/x-sh',
  zsh:        'application/x-sh',
  fish:       'application/x-sh',
  bat:        'text/x-batch',
  cmd:        'text/x-batch',
  ps1:        'text/x-powershell',
  c:          'text/x-c',
  h:          'text/x-c',
  cpp:        'text/x-c++',
  cxx:        'text/x-c++',
  cc:         'text/x-c++',
  hpp:        'text/x-c++',
  hxx:        'text/x-c++',
  cs:         'text/x-csharp',
  java:       'text/x-java',
  kt:         'text/x-kotlin',
  kts:        'text/x-kotlin',
  scala:      'text/x-scala',
  go:         'text/x-go',
  rs:         'text/x-rust',
  swift:      'text/x-swift',
  r:          'text/x-r',
  R:          'text/x-r',
  m:          'text/x-objc',
  mm:         'text/x-objc',
  lua:        'text/x-lua',
  php:        'text/x-php',
  jsp:        'text/x-jsp',
  asp:        'text/x-asp',
  aspx:       'text/x-asp',
  erb:        'text/x-erb',
  ejs:        'text/x-ejs',
  hbs:        'text/x-handlebars-template',
  mustache:   'text/x-handlebars-template',
  tsx:        'text/x-typescript-jsx',
  jsx:        'text/x-jsx',
  vue:        'text/x-vue',
  svelte:     'text/x-svelte',
  dart:       'text/x-dart',
  ex:         'text/x-elixir',
  exs:        'text/x-elixir',
  erl:        'text/x-erlang',
  hrl:        'text/x-erlang',
  hs:         'text/x-haskell',
  lhs:        'text/x-haskell',
  ml:         'text/x-ocaml',
  mli:        'text/x-ocaml',
  fs:         'text/x-fsharp',
  fsx:        'text/x-fsharp',
  fsi:        'text/x-fsharp',
  clj:        'text/x-clojure',
  cljs:       'text/x-clojure',
  cljc:       'text/x-clojure',
  lisp:       'text/x-lisp',
  lsp:        'text/x-lisp',
  scm:        'text/x-scheme',
  rkt:        'text/x-racket',
  nim:        'text/x-nim',
  zig:        'text/x-zig',
  v:          'text/x-vlang',
  d:          'text/x-d',
  cr:         'text/x-crystal',
  groovy:     'text/x-groovy',
  gradle:     'text/x-groovy',
  cmake:      'text/x-cmake',
  make:       'text/x-makefile',
  makefile:   'text/x-makefile',
  dockerfile: 'text/x-dockerfile',
  toml:       'text/x-toml',
  tf:         'text/x-terraform',
  hcl:        'text/x-terraform',
  proto:      'text/x-protobuf',
  graphql:    'text/x-graphql',
  gql:        'text/x-graphql',
  wsdl:       'application/wsdl+xml',

  // ── typescript ────────────────────────────────────────────────────────
  // Note: .ts can be video/mp2t (MPEG transport stream) or TypeScript.
  // We prefer TypeScript since that is far more common in web contexts.
  // Video .ts files can be disambiguated by the client sending the correct CT.
  // ts:      handled by video above — override here for web context:
  // (Already mapped to video/mp2t above; leaving that as default since
  //  TypeScript is text and would go through RDF parsing otherwise.
  //  Clients that upload .ts TypeScript should send text/plain or similar.)

  // ── 3D / CAD / models ────────────────────────────────────────────────
  gltf:       'model/gltf+json',
  glb:        'model/gltf-binary',
  obj:        'model/obj',
  stl:        'model/stl',
  fbx:        'application/octet-stream',
  dae:        'model/vnd.collada+xml',
  usdz:       'model/vnd.usdz+zip',
  '3ds':      'application/x-3ds',
  ply:        'application/x-ply',
  step:       'model/step',
  stp:        'model/step',
  iges:       'model/iges',
  igs:        'model/iges',

  // ── geospatial ────────────────────────────────────────────────────────
  kml:        'application/vnd.google-earth.kml+xml',
  kmz:        'application/vnd.google-earth.kmz',
  gpx:        'application/gpx+xml',
  shp:        'application/x-shapefile',
  gml:        'application/gml+xml',

  // ── certificates / crypto ─────────────────────────────────────────────
  pem:        'application/x-pem-file',
  crt:        'application/x-x509-ca-cert',
  cer:        'application/x-x509-ca-cert',
  der:        'application/x-x509-ca-cert',
  p12:        'application/x-pkcs12',
  pfx:        'application/x-pkcs12',
  p7b:        'application/x-pkcs7-certificates',
  p7c:        'application/x-pkcs7-mime',
  csr:        'application/pkcs10',
  pgp:        'application/pgp-encrypted',
  gpg:        'application/pgp-encrypted',
  sig:        'application/pgp-signature',
  asc:        'application/pgp-keys',
  jwk:        'application/jwk+json',
  jwks:       'application/jwk-set+json',

  // ── mail / messaging ──────────────────────────────────────────────────
  eml:        'message/rfc822',
  mbox:       'application/mbox',
  msg:        'application/vnd.ms-outlook',

  // ── misc application types ────────────────────────────────────────────
  atom:       'application/atom+xml',
  rss:        'application/rss+xml',
  swf:        'application/x-shockwave-flash',
  torrent:    'application/x-bittorrent',
  latex:      'application/x-latex',
  tex:        'application/x-latex',
  bib:        'application/x-bibtex',
  ps:         'application/postscript',
  eps:        'application/postscript',
  ai:         'application/postscript',
  hlp:        'application/winhlp',
  csh:        'application/x-csh',
  pkpass:     'application/vnd.apple.pkpass',
  mpd:        'application/dash+xml',
  m3u:        'application/vnd.apple.mpegurl',
  m3u8:       'application/vnd.apple.mpegurl',
  pls:        'audio/x-scpls',
  plist:      'application/x-apple-aspen-config',

  // ── SPARQL ────────────────────────────────────────────────────────────
  rq:         'application/sparql-query',
  srx:        'application/sparql-results+xml',
  srj:        'application/sparql-results+json',
};

/**
 * Generic content types that indicate the client didn't know the real type.
 * When we see one of these we try to infer from the file extension instead.
 */
const GENERIC_TYPES = new Set([
  'application/octet-stream',
  'application/x-www-form-urlencoded',  // sometimes sent erroneously
]);

/**
 * Extract the file extension from a resource IRI.
 * Returns lowercase extension without dot, or null.
 */
function extractExtension(resourceIri) {
  // Strip query/fragment
  let path = resourceIri.split('?')[0].split('#')[0];
  // Strip trailing slash (containers don't have extensions)
  if (path.endsWith('/')) return null;
  // Get last path segment
  const lastSlash = path.lastIndexOf('/');
  const filename = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  // Get extension
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex <= 0) return null;  // no extension or hidden file
  return filename.slice(dotIndex + 1).toLowerCase();
}

/**
 * Resolve the content type for a resource.
 *
 * Fallback hierarchy:
 * 1. Trust specific client Content-Type (non-generic)
 * 2. Infer from file extension if client sent generic type or none
 * 3. Fall back to application/octet-stream
 *
 * @param {string|null} headerCT - Content-Type from the request header
 * @param {string} resourceIri - The resource IRI (used for extension extraction)
 * @returns {string} Resolved content type (without parameters)
 */
export function resolveContentType(headerCT, resourceIri) {
  // Normalize: strip parameters (charset, boundary, etc.)
  const baseCT = headerCT ? headerCT.split(';')[0].trim().toLowerCase() : null;

  // If client sent a specific (non-generic) type, trust it
  if (baseCT && !GENERIC_TYPES.has(baseCT)) {
    return baseCT;
  }

  // Try to infer from extension
  const ext = extractExtension(resourceIri);
  if (ext && EXT_MAP[ext]) {
    return EXT_MAP[ext];
  }

  // Fall back
  return baseCT || 'application/octet-stream';
}

/**
 * Look up a media type by extension.
 * @param {string} ext - File extension without dot (lowercase)
 * @returns {string|null} Media type or null
 */
export function mediaTypeFromExtension(ext) {
  return EXT_MAP[ext?.toLowerCase()] || null;
}
