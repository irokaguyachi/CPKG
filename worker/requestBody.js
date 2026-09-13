// Content-Length is only an early check: streamed bodies must be counted too.
export async function readJsonLimited(request, maxBytes) {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    if (request.body) await request.body.cancel().catch(() => {});
    return { status: 413, error: 'payload too large' };
  }
  if (!request.body) return { status: 400, error: 'invalid json' };
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        return { status: 413, error: 'payload too large' };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return { value: JSON.parse(text) };
  } catch (error) {
    await reader.cancel().catch(() => {});
    return { status: 400, error: 'invalid json' };
  } finally {
    reader.releaseLock();
  }
}
