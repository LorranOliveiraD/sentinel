import { describe, it, expect, vi, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import express from 'express';
import type { Server } from 'node:http';

// Mock config before importing app
vi.mock('../../src/config/index.js', () => ({
  config: {
    port: 0,
    nodeEnv: 'test',
    logLevel: 'silent',
    githubWebhookSecret: 'test-webhook-secret',
    githubToken: 'fake-token',
    anthropicApiKey: '',
    slackBotToken: '',
    slackSigningSecret: '',
    slackChannel: '',
    databaseUrl: '',
  },
}));

// Mock logger to silence output
vi.mock('../../src/core/logger.js', () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
  createChildLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

// Mock event bus to prevent real event emission
vi.mock('../../src/core/event-bus.js', () => ({
  eventBus: {
    emit: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
  },
}));

const SECRET = 'test-webhook-secret';

function signPayload(body: string): string {
  return `sha256=${crypto.createHmac('sha256', SECRET).update(body).digest('hex')}`;
}

describe('Webhook Integration', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();

    // Raw body capture (same as production)
    app.use(express.json({
      verify: (req: any, _res, buf) => { req.rawBody = buf; },
    }));

    // Dynamic import after mocks are set up
    const { webhookRouter } = await import('../../src/server/routes/webhook.js');
    app.use('/webhook', webhookRouter);

    server = app.listen(0);
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://localhost:${port}`;

    return () => { server.close(); };
  });

  it('rejects requests without signature header', async () => {
    const res = await fetch(`${baseUrl}/webhook/github`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'ping' },
      body: '{}',
    });
    expect(res.status).toBe(401);
  });

  it('rejects requests with invalid signature', async () => {
    const body = '{}';
    const res = await fetch(`${baseUrl}/webhook/github`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'ping',
        'X-Hub-Signature-256': 'sha256=invalid',
      },
      body,
    });
    expect(res.status).toBe(401);
  });

  it('accepts ping event with valid signature', async () => {
    const body = '{}';
    const sig = signPayload(body);
    const res = await fetch(`${baseUrl}/webhook/github`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'ping',
        'X-Hub-Signature-256': sig,
      },
      body,
    });
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.accepted).toBe(true);
    expect(json.event).toBe('ping');
  });

  it('accepts pull_request event and returns correlationId', async () => {
    const payload = {
      action: 'opened',
      pull_request: {
        number: 42, title: 'test PR', body: 'description',
        user: { login: 'dev' }, base: { ref: 'main' }, head: { ref: 'feature' },
        url: 'https://api.github.com/repos/org/repo/pulls/42',
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      },
      repository: { owner: { login: 'org' }, name: 'repo', full_name: 'org/repo' },
      sender: { login: 'dev' },
    };
    const body = JSON.stringify(payload);
    const sig = signPayload(body);
    const res = await fetch(`${baseUrl}/webhook/github`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'pull_request',
        'X-Hub-Signature-256': sig,
      },
      body,
    });
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.correlationId).toBeDefined();
  });

  it('rejects requests without X-GitHub-Event header', async () => {
    const body = '{}';
    const sig = signPayload(body);
    const res = await fetch(`${baseUrl}/webhook/github`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': sig,
      },
      body,
    });
    expect(res.status).toBe(400);
  });
});
