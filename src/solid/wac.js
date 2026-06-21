/**
 * Web Access Control (WAC) evaluation.
 *
 * Evaluates WAC ACL resources stored at `acl:{resourceIri}` as N-Triples.
 * Implements the WAC authorization algorithm:
 *   1. Find the effective ACL — the resource's own ACL, or walk up containers
 *   2. Parse Authorization resources from the ACL triples
 *   3. Match authorizations against the requesting agent
 *   4. Return the union of granted access modes
 *
 * WAC predicates:
 *   acl:accessTo   — applies to a specific resource
 *   acl:default    — applies to members of a container (inherited)
 *   acl:agent      — matches a specific WebID
 *   acl:agentClass — matches a class (foaf:Agent = public, acl:AuthenticatedAgent)
 *   acl:mode       — Read, Write, Append, Control
 */
import { parseNTriples } from '../rdf/ntriples.js';
import { PREFIXES } from '../rdf/prefixes.js';
import { parentContainer } from './containers.js';

const ACL = PREFIXES.acl;
const RDF_TYPE = PREFIXES.rdf + 'type';
const FOAF_AGENT = PREFIXES.foaf + 'Agent';

/**
 * Check WAC access for a resource.
 *
 * @param {object} storage - KV storage (has .get())
 * @param {string} resourceIri - the resource being accessed
 * @param {string|null} agentWebId - requesting agent's WebID (null = unauthenticated)
 * @returns {Promise<{modes: Set<string>, found: boolean}>}
 *   modes: set of granted mode IRIs (e.g. "http://www.w3.org/ns/auth/acl#Read")
 *   found: whether any WAC ACL was found in the hierarchy
 */
export async function checkWacAccess(storage, resourceIri, agentWebId) {
  // Step 1: Find the effective ACL — check the resource's own ACL first
  const ownAcl = await storage.get(`acl:${resourceIri}`);
  if (ownAcl) {
    const triples = parseNTriples(ownAcl);
    const modes = evaluateAcl(triples, resourceIri, agentWebId, false);
    return { modes, found: true };
  }

  // Step 2: Walk up the container hierarchy looking for acl:default authorizations
  let current = resourceIri;
  while (true) {
    const container = parentContainer(current);
    if (!container) break;

    const containerAcl = await storage.get(`acl:${container}`);
    if (containerAcl) {
      const triples = parseNTriples(containerAcl);
      const modes = evaluateAcl(triples, container, agentWebId, true);
      return { modes, found: true };
    }

    current = container;
  }

  // No ACL found anywhere in the hierarchy
  return { modes: new Set(), found: false };
}

/**
 * Evaluate an ACL document's authorization rules.
 *
 * @param {Array} triples - parsed N-Triples from the ACL document
 * @param {string} targetIri - the resource/container the ACL belongs to
 * @param {string|null} agentWebId - requesting agent's WebID
 * @param {boolean} inherited - if true, only consider acl:default authorizations
 * @returns {Set<string>} granted mode IRIs
 */
function evaluateAcl(triples, targetIri, agentWebId, inherited) {
  // Group triples by subject to find Authorization resources
  const bySubject = new Map();
  for (const t of triples) {
    const s = unwrap(t.subject);
    if (!bySubject.has(s)) bySubject.set(s, []);
    bySubject.get(s).push(t);
  }

  const grantedModes = new Set();

  for (const [subject, subjectTriples] of bySubject) {
    // Must be an acl:Authorization
    const isAuth = subjectTriples.some(t =>
      unwrap(t.predicate) === RDF_TYPE && unwrap(t.object) === ACL + 'Authorization'
    );
    if (!isAuth) continue;

    // Check access scope: acl:accessTo or acl:default
    let appliesToTarget = false;
    if (inherited) {
      // For inherited ACLs, only acl:default authorizations apply
      appliesToTarget = subjectTriples.some(t =>
        unwrap(t.predicate) === ACL + 'default' && unwrap(t.object) === targetIri
      );
    } else {
      // For the resource's own ACL, acl:accessTo must match
      appliesToTarget = subjectTriples.some(t =>
        unwrap(t.predicate) === ACL + 'accessTo' && unwrap(t.object) === targetIri
      );
    }
    if (!appliesToTarget) continue;

    // Check if the agent matches
    const agentMatches = matchesAgent(subjectTriples, agentWebId);
    if (!agentMatches) continue;

    // Collect all modes from this authorization
    for (const t of subjectTriples) {
      if (unwrap(t.predicate) === ACL + 'mode') {
        grantedModes.add(unwrap(t.object));
      }
    }
  }

  return grantedModes;
}

/**
 * Check if an authorization's agent predicates match the requesting agent.
 */
function matchesAgent(triples, agentWebId) {
  for (const t of triples) {
    const pred = unwrap(t.predicate);
    const obj = unwrap(t.object);

    // acl:agent — exact WebID match
    if (pred === ACL + 'agent' && agentWebId && obj === agentWebId) {
      return true;
    }

    // acl:agentClass foaf:Agent — public access (any agent, including unauthenticated)
    if (pred === ACL + 'agentClass' && obj === FOAF_AGENT) {
      return true;
    }

    // acl:agentClass acl:AuthenticatedAgent — any authenticated agent
    if (pred === ACL + 'agentClass' && obj === ACL + 'AuthenticatedAgent' && agentWebId) {
      return true;
    }
  }

  return false;
}

/**
 * Convert WAC modes to a simple access object compatible with existing code.
 *
 * @param {Set<string>} modes - set of WAC mode IRIs
 * @returns {{readable: boolean, writable: boolean, appendable: boolean, controllable: boolean}}
 */
export function wacModesToAccess(modes) {
  const writable = modes.has(ACL + 'Write');
  return {
    readable: modes.has(ACL + 'Read'),
    writable,
    appendable: writable || modes.has(ACL + 'Append'),
    controllable: modes.has(ACL + 'Control'),
  };
}

/** Strip angle brackets from an N-Triples term. */
function unwrap(term) {
  if (term.startsWith('<') && term.endsWith('>')) return term.slice(1, -1);
  return term;
}
