const express = require('express');
const { TraceabilityClient, loadSettings, publicError } = require('./blockchain/client');
const validate = require('./validators/requests');
const { installDocumentRoutes, cidReference } = require('./ipfs/documents');

function createApp({ client, env = process.env, documentService } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('json replacer', (_key, value) => typeof value === 'bigint' ? value.toString() : value);
  app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('X-Content-Type-Options', 'nosniff'); next(); });
  app.use(express.json({ limit: '32kb' }));
  installDocumentRoutes(app, { env, service: documentService });
  const getClient = () => client || (client = new TraceabilityClient(loadSettings(env)));
  const route = handler => async (req, res, next) => {
    try { res.json({ success: true, data: await handler(req) }); } catch (error) { next(error); }
  };
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'component1-traceability' }));
  app.get('/health/blockchain', route(async () => { await getClient().ready(); return { status: 'ok' }; }));
  const base = '/api/v1/traceability/batches';
  const batchId = req => validate.text(req.params.batchId, 'batchId');
  app.get(`${base}/:batchId`, route(req => getClient().read('getBatch', [batchId(req)])));
  app.get(`${base}/:batchId/pending-transfer`, route(req => getClient().read('getPendingTransfer', [batchId(req)])));
  app.get(`${base}/:batchId/history`, route(req => getClient().read('getTransferHistory', [batchId(req)])));
  app.get(`${base}/:batchId/status`, route(async req => {
    const id = batchId(req);
    const result = await getClient().read('getBatch', [id]);
    const expiry = await getClient().read('isBatchExpired', [id]);
    return { batchId: id, recalled: result['0'].recalled, expired: expiry['0'] };
  }));
  app.post(`${base}/transactions/register`, route(async req => {
    const input = validate.body(req.body, ['sender', 'batch']);
    const batch = validate.registration(input.batch);
    const certificate = await cidReference(batch.certificateReference);
    const report = await cidReference(batch.documentReference);
    return getClient().prepare('registerBatch', [{ ...batch, certificateReference: certificate.reference, documentReference: report.reference }], validate.address(input.sender, 'sender'));
  }));
  app.post(`${base}/:batchId/transactions/initiate-transfer`, route(req => {
    const input = validate.body(req.body, ['sender', 'recipient']);
    return getClient().prepare('initiateTransfer', [batchId(req), validate.address(input.recipient, 'recipient')], validate.address(input.sender, 'sender'));
  }));
  for (const action of ['confirm-transfer', 'cancel-transfer', 'reject-transfer']) {
    app.post(`${base}/:batchId/transactions/${action}`, route(async req => {
      const input = validate.body(req.body, ['sender', 'transferId']);
      const id = batchId(req), sender = validate.address(input.sender, 'sender'), transfer = validate.transferId(input.transferId);
      // Rejection is the recipient's use of the existing cancelTransfer method.
      if (action === 'reject-transfer') {
        const pending = await getClient().read('getPendingTransfer', [id]);
        if (pending['0'].to.toLowerCase() !== sender.toLowerCase()) {
          const { ApiError } = require('./blockchain/client');
          throw new ApiError(403, 'NotRecipient', 'Only the pending recipient can prepare a rejection.');
        }
      }
      return getClient().prepare(action === 'confirm-transfer' ? 'confirmTransfer' : 'cancelTransfer', [id, transfer], sender);
    }));
  }
  app.post(`${base}/:batchId/transactions/recall`, route(req => {
    const input = validate.body(req.body, ['sender', 'reason']);
    return getClient().prepare('recallBatch', [batchId(req), validate.text(input.reason, 'reason')], validate.address(input.sender, 'sender'));
  }));
  app.use((_req, res) => res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Route not found.' }));
  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.too.large') return res.status(413).json({ success: false, error: 'REQUEST_TOO_LARGE', message: 'Request body exceeds 32 KB.' });
    if (error.type === 'entity.parse.failed' || error instanceof URIError) return res.status(400).json({ success: false, error: 'INVALID_REQUEST', message: 'Malformed JSON or URL.' });
    const safe = publicError(error);
    return res.status(safe.status).json({ success: false, error: safe.code, message: safe.message });
  });
  return app;
}
if (require.main === module) createApp().listen(Number(process.env.PORT) || 5001, process.env.HOST || '127.0.0.1', () => console.log('Component 1 traceability API listening.'));
module.exports = { createApp };
