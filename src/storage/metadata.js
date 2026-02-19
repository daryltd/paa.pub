/**
 * File metadata generation using Dublin Core terms.
 */
import { PREFIXES } from '../rdf/prefixes.js';

/**
 * Generate metadata N-Quads for a file.
 * @param {string} resourceIri
 * @param {string} contentType
 * @param {number} byteLength
 * @param {string} [filename]
 * @returns {string} N-Quads
 */
export function generateMetadata(resourceIri, contentType, byteLength, filename) {
  const metaGraph = `${resourceIri}.meta`;
  const dcterms = PREFIXES.dcterms;
  const rdf = PREFIXES.rdf;
  const schema = PREFIXES.schema;
  const xsd = PREFIXES.xsd;

  const quads = [
    `<${resourceIri}> <${rdf}type> <${schema}DigitalDocument> <${metaGraph}> .`,
    `<${resourceIri}> <${dcterms}format> "${contentType}" <${metaGraph}> .`,
    `<${resourceIri}> <${dcterms}extent> "${byteLength}"^^<${xsd}integer> <${metaGraph}> .`,
    `<${resourceIri}> <${dcterms}created> "${new Date().toISOString()}"^^<${xsd}dateTime> <${metaGraph}> .`,
  ];

  if (filename) {
    quads.push(`<${resourceIri}> <${dcterms}title> "${escapeNQ(filename)}" <${metaGraph}> .`);
  }

  return quads.join('\n');
}

function escapeNQ(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
