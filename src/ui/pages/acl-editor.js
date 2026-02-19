/**
 * ACL editor page: view and edit ACL triples for a resource.
 */
import { htmlPage, htmlResponse, escapeHtml } from '../shell.js';
import { requireAuth } from '../../auth/middleware.js';
import { parseNTriples, serializeNTriples } from '../../rdf/ntriples.js';
import { parseTurtle } from '../../rdf/turtle-parser.js';
import { serializeTurtle } from '../../rdf/turtle-serializer.js';

/**
 * Handle GET /acl/**
 */
export async function renderAclEditor(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { config, storage, url } = reqCtx;
  const username = config.username;
  const path = url.pathname.replace(/^\/acl\/?/, '') || `${username}/`;
  const resourceIri = `${config.baseUrl}/${path}`;

  const aclData = await storage.get(`acl:${resourceIri}`);
  let turtleContent = '';
  if (aclData) {
    const triples = parseNTriples(aclData);
    turtleContent = serializeTurtle(triples, ['acl', 'foaf', 'rdf']);
  }

  const body = `
    <h1>ACL Editor</h1>

    <div class="card">
      <div class="text-muted" style="margin-bottom: 0.5rem;">
        Resource: <span class="mono">${escapeHtml(resourceIri)}</span>
      </div>
      <div class="text-muted" style="margin-bottom: 1rem;">
        ACL: <span class="mono">${escapeHtml(resourceIri)}.acl</span>
      </div>

      <form method="POST" action="/acl/${escapeHtml(path)}">
        <div class="form-group">
          <label for="acl-content">ACL (Turtle format)</label>
          <textarea id="acl-content" name="content" rows="15" class="mono" style="font-size: 0.85rem;">${escapeHtml(turtleContent)}</textarea>
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <button type="submit" class="btn">Save ACL</button>
          <a href="/storage/${escapeHtml(path)}" class="btn btn-secondary">Back to Storage</a>
        </div>
      </form>
    </div>

    <div class="card">
      <h2>ACL Reference</h2>
      <div class="text-muted" style="font-size: 0.85rem;">
        <pre class="mono">@prefix acl: &lt;http://www.w3.org/ns/auth/acl#&gt; .
@prefix foaf: &lt;http://xmlns.com/foaf/0.1/&gt; .

# Owner full access
&lt;#owner&gt; a acl:Authorization ;
    acl:agent &lt;${escapeHtml(config.webId)}&gt; ;
    acl:accessTo &lt;${escapeHtml(resourceIri)}&gt; ;
    acl:mode acl:Read, acl:Write, acl:Control .

# Public read access
&lt;#public&gt; a acl:Authorization ;
    acl:agentClass foaf:Agent ;
    acl:accessTo &lt;${escapeHtml(resourceIri)}&gt; ;
    acl:mode acl:Read .</pre>
      </div>
    </div>`;

  return htmlResponse(htmlPage('ACL Editor', body, { user: username, nav: 'storage' }));
}

/**
 * Handle POST /acl/**
 */
export async function handleAclUpdate(reqCtx) {
  const authCheck = requireAuth(reqCtx);
  if (authCheck) return authCheck;

  const { request, config, storage, url } = reqCtx;
  const path = url.pathname.replace(/^\/acl\/?/, '') || `${config.username}/`;
  const resourceIri = `${config.baseUrl}/${path}`;

  const form = await request.formData();
  const content = form.get('content') || '';

  // Parse Turtle and convert to N-Triples for storage
  const triples = parseTurtle(content, resourceIri + '.acl');
  const ntriples = serializeNTriples(triples);
  await storage.put(`acl:${resourceIri}`, ntriples);

  return new Response(null, { status: 302, headers: { 'Location': `/acl/${path}` } });
}
