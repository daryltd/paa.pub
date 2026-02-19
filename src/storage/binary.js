/**
 * Binary upload/download via s20e orchestrator.
 */
import { PREFIXES } from '../rdf/prefixes.js';
import { defaultAclNTriples } from '../solid/acl.js';

/**
 * Upload a binary file via the orchestrator.
 * @param {object} orchestrator
 * @param {string} resourceIri
 * @param {ArrayBuffer} binary
 * @param {string} contentType
 * @param {string} webId
 * @returns {Promise<object>} write result
 */
export async function uploadBinary(orchestrator, resourceIri, binary, contentType, webId) {
  const metadataNquads = buildMetadata(resourceIri, contentType, binary.byteLength);
  const aclNtriples = defaultAclNTriples(resourceIri, webId);

  return orchestrator.uploadBinary(
    resourceIri,
    binary,
    contentType,
    metadataNquads,
    aclNtriples,
    webId,
  );
}

/**
 * Download a binary file via the orchestrator.
 * @param {object} orchestrator
 * @param {string} resourceIri
 * @param {string|null} agent
 * @returns {Promise<{granted: boolean, data?: ArrayBuffer, contentType?: string}>}
 */
export async function downloadBinary(orchestrator, resourceIri, agent) {
  return orchestrator.serveBinary(resourceIri, agent);
}

function buildMetadata(resourceIri, contentType, byteLength) {
  const metaGraph = `${resourceIri}.meta`;
  const rdf = PREFIXES.rdf;
  const dcterms = PREFIXES.dcterms;
  const schema = PREFIXES.schema;
  const xsd = PREFIXES.xsd;

  return [
    `<${resourceIri}> <${rdf}type> <${schema}DigitalDocument> <${metaGraph}> .`,
    `<${resourceIri}> <${dcterms}format> "${contentType}" <${metaGraph}> .`,
    `<${resourceIri}> <${dcterms}extent> "${byteLength}"^^<${xsd}integer> <${metaGraph}> .`,
    `<${resourceIri}> <${dcterms}created> "${new Date().toISOString()}"^^<${xsd}dateTime> <${metaGraph}> .`,
  ].join('\n');
}
