// Public metadata only. Authentication hashes and bookmark contents never enter
// this index. A bounded, resumable scan runs on the existing minute cron.
const INDEX_KEY = 'indexes/library-v1.json';
const BUILD_KEY = 'indexes/library-build-v1.json';
const PAGE_BUDGET = 8;

function metadataRow(object) {
  const meta = object.customMetadata || {};
  return {
    code: object.key.slice('library/'.length, -5),
    name: meta.name || '',
    itemCount: Number(meta.itemCount) || 0,
    createdAt: Number(meta.createdAt || meta.updatedAt) || 0,
    updatedAt: Number(meta.updatedAt) || 0
  };
}

export async function refreshLibraryIndex(env) {
  const bucket = env.FAVORITES_BUCKET;
  const current = await bucket.head(INDEX_KEY);
  const baseEtag = current ? current.etag : null;
  const saved = await bucket.get(BUILD_KEY);
  let build = saved ? await saved.json() : null;
  if (!build || build.baseEtag !== baseEtag || !Array.isArray(build.items)) {
    build = { baseEtag, items: [], cursor: undefined };
  }
  for (let pageNumber = 0; pageNumber < PAGE_BUDGET; pageNumber++) {
    const page = await bucket.list({
      prefix: 'library/', cursor: build.cursor, limit: 1000,
      include: ['customMetadata']
    });
    for (const object of page.objects) {
      if (/^library\/[A-Za-z0-9_-]{1,32}\.json$/.test(object.key)) {
        build.items.push(metadataRow(object));
      }
    }
    if (!page.truncated) {
      // A publish/update/delete may have updated the index during this scan.
      // Never overwrite that newer index with an older snapshot.
      const written = await bucket.put(INDEX_KEY, JSON.stringify({
        items: build.items, generatedAt: Date.now()
      }), {
        onlyIf: baseEtag ? { etagMatches: baseEtag } : { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: 'application/json' }
      });
      await bucket.delete(BUILD_KEY);
      return written ? build.items : null;
    }
    build.cursor = page.cursor;
  }
  await bucket.put(BUILD_KEY, JSON.stringify(build), {
    httpMetadata: { contentType: 'application/json' }
  });
  return null;
}

export async function readLibraryIndex(env) {
  const object = await env.FAVORITES_BUCKET.get(INDEX_KEY);
  if (object) return (await object.json()).items;
  // Bootstrap a small existing library before the first cron has run. Large
  // libraries resume on the cron; callers receive 503 instead of partial data.
  return refreshLibraryIndex(env);
}

export async function updateLibraryIndex(env, code, record) {
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const object = await env.FAVORITES_BUCKET.get(INDEX_KEY);
      if (!object) return; // The cron will bootstrap from the source objects.
      const index = await object.json();
      const items = index.items.filter(row => row.code !== code);
      if (record) items.push({
        code, name: record.name, itemCount: record.items.length,
        createdAt: record.createdAt || record.updatedAt, updatedAt: record.updatedAt
      });
      if (await env.FAVORITES_BUCKET.put(INDEX_KEY, JSON.stringify({
        items, generatedAt: Date.now()
      }), {
        onlyIf: { etagMatches: object.etag },
        httpMetadata: { contentType: 'application/json' }
      })) return;
    }
    throw new Error('index update contention');
  } catch (error) {
    // The source write succeeded. A failed index update is repaired by cron.
    console.error('library index update failed', error.message);
  }
}
