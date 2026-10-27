import { ok } from '../reply';
import { bodyJson, request, setup } from '../__fixtures__/fakes';

describe('lan server', () => {
  it('rejects protected paths without a token from remote addresses', async () => {
    const { server } = await setup();
    const res = await server.handle(request('/api/state'));
    expect(res).toMatchObject({ status: 401, body: 'Unauthorized' });
    expect(res.headers?.['Content-Type']).toBe('text/plain; charset=utf-8');
    expect((await server.handle(request('/upload'))).status).toBe(401);
  });

  it('serves the web UI and /api/pair without a token', async () => {
    const { server } = await setup();
    expect((await server.handle(request('/'))).status).toBe(200);
    expect((await server.handle(request('/api/pair', { query: { code: 'bad' } }))).status).toBe(403);
  });

  it('pairs over HTTP and then accepts the header or parameter token', async () => {
    const { server, pairing } = await setup();
    const code = pairing.getCode();
    const res = await server.handle(
      request('/api/pair', { method: 'POST', form: { code, name: 'Phone' }, headers: { 'user-agent': 'Safari' } }),
    );
    expect(res.status).toBe(200);
    expect(res.headers?.['Content-Type']).toBe('application/json');
    const { token, name } = bodyJson(res) as { token: string; name: string };
    expect(name).toBe('Phone');
    expect(pairing.devices()[0]).toMatchObject({ agent: 'Safari', ip: '192.168.1.20' });
    expect(pairing.getCode()).not.toBe(code);

    expect((await server.handle(request('/api/state', { headers: { 'x-token': token } }))).status).toBe(200);
    const state = await server.handle(request('/api/state', { query: { token } }));
    expect(bodyJson(state).token).toBe(token);
  });

  it('unpairs by target token', async () => {
    const { pairing, call } = await setup();
    const device = await pairing.pair(pairing.getCode(), 'p', '', '1.1.1.1');
    expect(await call('/api/unpair', { target: 'nope' })).toMatchObject({ status: 404, body: 'device not found' });
    expect(await call('/api/unpair', { target: device?.token ?? '' })).toMatchObject({ status: 200, body: 'OK' });
    expect(pairing.devices()).toEqual([]);
  });

  it('routes unknown apis, errors, processes and form-over-query params', async () => {
    const { server, call } = await setup();
    expect(await call('/api/nope')).toMatchObject({ status: 404, body: 'Unknown api' });

    server.registerApi('boom', () => {
      throw new Error('kaput');
    });
    expect(await call('/api/boom')).toMatchObject({ status: 500, body: 'kaput' });

    server.registerApi('echo', (_req, params) => ok(params.v));
    expect((await call('/api/echo', { v: 'query' }, { form: { v: 'form' } })).body).toBe('form');

    server.registerProcess({ matches: (path) => path.startsWith('/file'), handle: () => ok('file') });
    expect((await call('/file/a.txt')).body).toBe('file');
    expect((await call('/missing.txt')).status).toBe(404);
  });
});
