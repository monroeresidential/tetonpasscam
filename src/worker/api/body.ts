import type { Context } from 'hono';

import type { Env } from '../env';

export type CappedBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 413; body: { error: string } }
  | { ok: false; status: 400; body: { error: string } };

/**
 * Reads and parses a POST body with a hard byte cap, so an unauthenticated
 * caller can't force the Worker to buffer an arbitrarily large request (no
 * size limit existed before this -- `deviceId`, alert `note`, etc. were only
 * bounded AFTER the whole body had already been read into memory and
 * JSON-parsed).
 *
 * Two layers, since `Content-Length` is caller-supplied and not
 * trustworthy on its own (absent for chunked-encoded requests; a caller
 * could also just lie and send more bytes than declared):
 *  1. If `Content-Length` is present and already exceeds `maxBytes`, reject
 *     immediately without reading anything.
 *  2. Read the body stream manually, counting bytes as they arrive, and
 *     abort (cancel the stream, return 413) the moment the running total
 *     exceeds `maxBytes` -- this is the layer that actually enforces the
 *     cap regardless of what `Content-Length` claimed.
 *
 * JSON-parses only after the size check passes. Malformed JSON -> 400,
 * same outcome (a 400) the previous `c.req.json().catch(() => ({}))` +
 * downstream field validation always produced for an unparsable body, just
 * returned directly here instead of falling through to whichever field
 * happens to be "missing" from the `{}` fallback.
 */
export async function readJsonCapped(
  c: Context<{ Bindings: Env }>,
  maxBytes: number,
): Promise<CappedBodyResult> {
  const contentLengthHeader = c.req.header('Content-Length');
  if (contentLengthHeader !== undefined) {
    const declaredLength = Number(contentLengthHeader);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      return { ok: false, status: 413, body: { error: 'payload too large' } };
    }
  }

  const text = await readCappedText(c.req.raw, maxBytes);
  if (text === null) {
    return { ok: false, status: 413, body: { error: 'payload too large' } };
  }

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, body: { error: 'invalid json' } };
  }
}

/** Reads `request`'s body stream up to `maxBytes` + 1 bytes, returning the
 *  decoded text, or `null` if the running total ever exceeds `maxBytes`
 *  (the +1 is just so a body of EXACTLY `maxBytes` doesn't need reading one
 *  more chunk to confirm there's nothing left). A body-less request (no
 *  stream at all) decodes to `''`, matching `Request.text()`'s own
 *  behavior. */
async function readCappedText(request: Request, maxBytes: number): Promise<string | null> {
  const stream = request.body;
  if (!stream) return '';

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const buf = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(buf);
}
