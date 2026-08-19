// src/utils/http-client.js
// Thin wrappers over Node's built-in fetch (Node 18+), replacing axios /
// form-data / the twilio SDK. Zero runtime dependencies is deliberate:
// Netlify's v2 function bundler externalizes CJS node_modules requires
// WITHOUT shipping the modules (production MODULE_NOT_FOUND, 2026-07-11),
// so the only provably safe dependency footprint is none.
//
// Errors are normalized to the axios-like shape the pipeline's error
// classification expects: `error.response.status` for HTTP errors and
// `error.code === 'ECONNABORTED'` / message containing "timeout" for
// timeouts.

function normalizeError(error, url) {
  if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    const timeoutError = new Error(`Request timeout: ${url}`);
    timeoutError.code = 'ECONNABORTED';
    return timeoutError;
  }
  return error;
}

async function toHttpError(response) {
  const error = new Error(`HTTP ${response.status} from ${response.url}`);
  error.response = { status: response.status };
  try {
    error.response.data = await response.json();
  } catch (e) { /* non-JSON error body */ }
  // Surface the provider's own explanation (OpenAI: {error:{message}},
  // Twilio: {message}) in error.message so logs and the operator alert say
  // *why* -- "HTTP 400" alone is undiagnosable once logs have rotated.
  const detail = extractErrorDetail(error.response.data);
  if (detail) {
    error.message += `: ${detail}`;
  }
  return error;
}

function extractErrorDetail(data) {
  if (!data || typeof data !== 'object') return null;
  const candidate = (data.error && typeof data.error === 'object' && data.error.message)
    || (typeof data.error === 'string' && data.error)
    || data.message;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim().slice(0, 300) : null;
}

/**
 * GET a binary resource. Returns { data: Buffer, contentLength }.
 */
async function getBuffer(url, { headers = {}, timeoutMs = 15000 } = {}) {
  let response;
  try {
    response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw normalizeError(error, url);
  }
  if (!response.ok) {
    throw await toHttpError(response);
  }
  const data = Buffer.from(await response.arrayBuffer());
  return {
    data,
    contentLength: response.headers.get('content-length') || data.length
  };
}

/**
 * GET a URL and parse the JSON response. Used for lightweight Twilio
 * resource reads (e.g. polling a message's delivery status).
 */
async function getJson(url, { headers = {}, timeoutMs = 15000 } = {}) {
  let response;
  try {
    response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw normalizeError(error, url);
  }
  if (!response.ok) {
    throw await toHttpError(response);
  }
  return response.json();
}

/**
 * POST a body (JSON object, FormData, or URLSearchParams) and parse the
 * JSON response. Content-Type is set automatically: explicitly for JSON,
 * by fetch itself for FormData (multipart boundary) and URLSearchParams.
 */
async function postJson(url, body, { headers = {}, timeoutMs = 30000 } = {}) {
  const isJsonBody = !(body instanceof FormData) && !(body instanceof URLSearchParams);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: isJsonBody ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: isJsonBody ? JSON.stringify(body) : body,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw normalizeError(error, url);
  }
  if (!response.ok) {
    throw await toHttpError(response);
  }
  return response.json();
}

module.exports = {
  getBuffer,
  getJson,
  postJson,
  extractErrorDetail
};
