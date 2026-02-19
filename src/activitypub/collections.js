/**
 * Followers/Following OrderedCollection endpoints.
 */

/**
 * Handle GET /{user}/followers and /{user}/following
 */
export async function handleCollections(reqCtx) {
  const { url, params, config, env } = reqCtx;
  const username = params.user;

  if (username !== config.username) {
    return new Response('Not Found', { status: 404 });
  }

  const pathname = url.pathname;
  const isFollowers = pathname.endsWith('/followers');
  const collectionType = isFollowers ? 'followers' : 'following';
  const collectionUrl = `${config.baseUrl}/${username}/${collectionType}`;

  const kvKey = isFollowers ? `ap_followers:${username}` : `ap_following:${username}`;
  const data = await env.APPDATA.get(kvKey);
  const items = JSON.parse(data || '[]');

  const page = url.searchParams.get('page');
  const pageSize = 20;

  if (page === null) {
    const collection = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'OrderedCollection',
      id: collectionUrl,
      totalItems: items.length,
    };
    if (items.length > 0) {
      collection.first = `${collectionUrl}?page=0`;
    }
    return jsonResponse(collection);
  }

  const pageNum = parseInt(page, 10);
  const start = pageNum * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  const collectionPage = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    type: 'OrderedCollectionPage',
    id: `${collectionUrl}?page=${pageNum}`,
    partOf: collectionUrl,
    orderedItems: pageItems,
  };
  if (start + pageSize < items.length) {
    collectionPage.next = `${collectionUrl}?page=${pageNum + 1}`;
  }
  if (pageNum > 0) {
    collectionPage.prev = `${collectionUrl}?page=${pageNum - 1}`;
  }

  return jsonResponse(collectionPage);
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data, null, 2), {
    headers: { 'Content-Type': 'application/activity+json' },
  });
}
