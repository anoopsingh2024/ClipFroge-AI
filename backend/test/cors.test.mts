import express from 'express';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  corsMiddleware,
  rejectDisallowedOrigins
} from '../src/middleware/cors';

let server: Server | undefined;
let baseUrl = '';

beforeEach(async () => {
  const app = express();
  app.use(rejectDisallowedOrigins);
  app.use(corsMiddleware);
  app.get('/ok', (_req, res) => res.status(200).json({ success: true }));
  app.get('/client-error', (_req, res) => {
    res.status(422).json({ success: false, message: 'Invalid input.' });
  });
  app.get('/failure', (_req, _res, next) => next(new Error('Test failure.')));
  app.use((
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    res.status(500).json({ success: false, message: err.message });
  });

  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Test HTTP server did not bind to a TCP port.');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  if (server?.listening) {
    await new Promise<void>((resolve, reject) => {
      server?.close(error => error ? reject(error) : resolve());
    });
  }
  server = undefined;
});

describe('API CORS middleware', () => {
  it('allows the production Netlify origin and handles preflight', async () => {
    const origin = 'https://clipfroge-ai.netlify.app';
    const response = await fetch(`${baseUrl}/ok`, {
      headers: { Origin: origin }
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);

    const preflight = await fetch(`${baseUrl}/ok`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type'
      }
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(origin);
  });

  it('allows Netlify deploy-preview domains', async () => {
    const origin = 'https://deploy-123--clipfroge-ai.netlify.app';
    const response = await fetch(`${baseUrl}/ok`, {
      headers: { Origin: origin }
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
  });

  it.each([
    'http://localhost:4200',
    'http://127.0.0.1:4200'
  ])('allows development origin %s', async origin => {
    const response = await fetch(`${baseUrl}/ok`, {
      headers: { Origin: origin }
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
  });

  it('rejects unknown external origins without an allow-origin header', async () => {
    const response = await fetch(`${baseUrl}/ok`, {
      headers: { Origin: 'https://unknown.example' }
    });

    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: 'Origin is not allowed.'
    });
  });

  it('keeps CORS headers on API 4xx and 5xx JSON responses', async () => {
    const origin = 'https://clipfroge-ai.netlify.app';
    const clientError = await fetch(`${baseUrl}/client-error`, {
      headers: { Origin: origin }
    });
    expect(clientError.status).toBe(422);
    expect(clientError.headers.get('access-control-allow-origin')).toBe(origin);
    await expect(clientError.json()).resolves.toEqual({
      success: false,
      message: 'Invalid input.'
    });

    const serverError = await fetch(`${baseUrl}/failure`, {
      headers: { Origin: origin }
    });
    expect(serverError.status).toBe(500);
    expect(serverError.headers.get('access-control-allow-origin')).toBe(origin);
    await expect(serverError.json()).resolves.toEqual({
      success: false,
      message: 'Test failure.'
    });
  });
});
