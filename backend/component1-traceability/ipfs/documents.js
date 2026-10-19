const { createHash, timingSafeEqual } = require('node:crypto');
const multer = require('multer');
const { ApiError } = require('../blockchain/client');

const MAX_BYTES = 5 * 1024 * 1024;
const fail = (status, code, message) => { throw new ApiError(status, code, message); };
async function cidReference(value) {
  try {
    if (typeof value !== 'string' || value.length > 120) throw new Error();
    const raw = value.startsWith('ipfs://') ? value.slice(7) : value;
    const { CID } = await import('multiformats/cid');
    const cid = CID.parse(raw);
    if (![0x70, 0x55].includes(cid.code) || cid.multihash.code !== 0x12 || cid.multihash.size !== 32) throw new Error();
    return { cid: cid.toV1().toString(), reference: `ipfs://${cid.toV1().toString()}` };
  } catch { fail(400, 'INVALID_CID', 'Expected a bare CID or ipfs://CID (SHA-256 raw or dag-pb), without paths or queries.'); }
}
function fileType(buffer) {
  if (buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) return { mime: 'application/pdf', extension: 'pdf' };
  if (buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return { mime: 'image/png', extension: 'png' };
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return { mime: 'image/jpeg', extension: 'jpg' };
  fail(400, 'INVALID_FILE', 'Only PDF, PNG and JPEG document signatures are accepted.');
}
async function bounded(response, maximum) {
  if (Number(response.headers.get('content-length')) > maximum) { await response.body?.cancel(); fail(502, 'PROVIDER_RESPONSE_INVALID', 'Provider response exceeds the allowed size.'); }
  const chunks = []; let length = 0;
  if (!response.body) fail(502, 'PROVIDER_RESPONSE_INVALID', 'Provider returned an empty response.');
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > maximum) fail(502, 'PROVIDER_RESPONSE_INVALID', 'Provider response exceeds the allowed size.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
function httpsUrl(value, fallback) {
  const url = new URL(value || fallback);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
  return url;
}
class DocumentService {
  constructor(env = process.env, fetchImpl = fetch) { this.env = env; this.fetch = fetchImpl; }
  async upload(file, metadata) {
    if (!file || !file.buffer.length || file.size > MAX_BYTES) fail(400, 'INVALID_FILE', 'Supply one nonempty file up to 5 MiB.');
    if (!metadata || Object.keys(metadata).sort().join(',') !== 'batchId,documentType,publicApproved' ||
        !['medicine-certificate', 'laboratory-report'].includes(metadata.documentType) ||
        typeof metadata.batchId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(metadata.batchId) || metadata.publicApproved !== 'true') {
      fail(400, 'INVALID_METADATA', 'Supply batchId, documentType and publicApproved=true; no other metadata is permitted.');
    }
    const type = fileType(file.buffer);
    const extensions = type.extension === 'jpg' ? /\.(jpg|jpeg)$/i : new RegExp(`\\.${type.extension}$`, 'i');
    if (file.mimetype !== type.mime || !extensions.test(file.originalname)) fail(400, 'INVALID_FILE', 'File signature, MIME type and extension must agree.');
    const digest = createHash('sha256').update(file.buffer).digest('hex');
    // Only exact bytes reviewed out-of-band as public may leave this server.
    const approved = (this.env.IPFS_APPROVED_SHA256 || '').split(',').map(value => value.trim().toLowerCase());
    if (!approved.includes(digest)) fail(403, 'DOCUMENT_NOT_APPROVED', 'Document bytes have not been approved for public publication.');
    try {
      if (this.env.IPFS_PROVIDER !== 'pinata' || !this.env.IPFS_PROVIDER_TOKEN || this.env.IPFS_PROVIDER_TOKEN === this.env.IPFS_API_TOKEN) throw new Error();
      const url = httpsUrl(this.env.IPFS_PIN_ENDPOINT, 'https://api.pinata.cloud/pinning/pinFileToIPFS');
      const form = new FormData();
      // Original filenames and metadata are never sent to the public provider.
      form.append('file', new Blob([file.buffer], { type: type.mime }), `document.${type.extension}`);
      form.append('pinataOptions', JSON.stringify({ cidVersion: 1, wrapWithDirectory: false }));
      const response = await this.fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${this.env.IPFS_PROVIDER_TOKEN}` }, body: form, redirect: 'error', signal: AbortSignal.timeout(30000) });
      if (!response.ok) { await response.body?.cancel(); throw new Error(); }
      const result = JSON.parse((await bounded(response, 16384)).toString());
      const ref = await cidReference(result.IpfsHash);
      if (!Number.isSafeInteger(result.PinSize) || result.PinSize < file.size || typeof result.Timestamp !== 'string' || !Number.isFinite(Date.parse(result.Timestamp))) throw new Error();
      return { ...ref, sha256: digest, documentType: metadata.documentType, batchId: metadata.batchId, size: file.size };
    } catch { fail(502, 'IPFS_UPLOAD_FAILED', 'Pinning provider did not confirm a valid pinned document.'); }
  }
  async retrieve(value) {
    const ref = await cidReference(value);
    try {
      const root = httpsUrl(this.env.IPFS_GATEWAY_URL, 'https://gateway.pinata.cloud/ipfs/');
      const url = new URL(root.href.replace(/\/?$/, '/') + ref.cid);
      const response = await this.fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
      if (!response.ok) { await response.body?.cancel(); throw new Error(); }
      const buffer = await bounded(response, MAX_BYTES);
      const type = fileType(buffer);
      return { buffer, ...type, cid: ref.cid };
    } catch { fail(502, 'IPFS_RETRIEVAL_FAILED', 'Unable to retrieve a supported document from the configured gateway.'); }
  }
}
function installDocumentRoutes(app, { env = process.env, service = new DocumentService(env) } = {}) {
  let windowStart = 0, requests = 0, active = 0;
  const authorize = (req, _res, next) => {
    try {
      const secret = env.IPFS_API_TOKEN;
      if (typeof secret !== 'string' || secret.length < 32) fail(503, 'IPFS_DISABLED', 'Document API is not configured.');
      const actual = Buffer.from(req.get('authorization') || ''); const expected = Buffer.from(`Bearer ${secret}`);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) fail(401, 'UNAUTHORIZED', 'Document API authorization required.');
      const now = Date.now(); if (now - windowStart >= 60000) { windowStart = now; requests = 0; }
      if (++requests > 20 || active >= 2) fail(429, 'DOCUMENT_LIMIT', 'Document request limit exceeded. Retry later.');
      active++; let released = false;
      const release = () => { if (!released) { released = true; active--; } };
      req.releaseDocument = release; next();
    } catch (error) { next(error); }
  };
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1, fields: 3, parts: 4, fieldSize: 256, fieldNameSize: 32 } }).single('file');
  const base = '/api/v1/traceability/documents';
  app.post(base, authorize, (req, res, next) => upload(req, res, error => {
    if (error) { req.releaseDocument(); return next(new ApiError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, 'INVALID_UPLOAD', 'Multipart upload exceeds limits or has unexpected fields.')); }
    service.upload(req.file, req.body).then(data => res.json({ success: true, data })).catch(next).finally(req.releaseDocument);
  }));
  app.get(`${base}/:cid`, authorize, async (req, res, next) => {
    try {
      const result = await service.retrieve(req.params.cid);
      res.set('Content-Type', 'application/octet-stream');
      res.set('Content-Disposition', `attachment; filename="document.${result.extension}"`);
      res.set('Content-Security-Policy', "default-src 'none'; sandbox");
      res.send(result.buffer);
    } catch (error) { next(error); } finally { req.releaseDocument(); }
  });
}
module.exports = { DocumentService, installDocumentRoutes, cidReference, fileType, MAX_BYTES };
