import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { Express } from 'express';
import { ProximDB } from '../src/index.js';
import { MemoryAdapter } from '../src/adapters/memory.adapter.js';
import { proximMiddleware, createSearchHandler } from '../src/middleware/express.js';

describe('Express Integration', () => {
  let searchEngine: ProximDB;
  let adapter: MemoryAdapter;
  let app: Express;
  let server: any;
  let port: number;

  beforeEach(async () => {
    adapter = new MemoryAdapter({
      initialNodes: [
        { id: 'u_1', entityType: 'user', attributes: { username: 'JohnDoe', city: 'Paris' } },
        { id: 'u_2', entityType: 'user', attributes: { username: 'JaneSmith', city: 'London' } }
      ]
    });

    searchEngine = new ProximDB({
      source: adapter,
      embeddedStoragePath: ':memory:',
      mapping: {
        nodes: {
          user: {
            table: 'users',
            attributes: ['username', 'city']
          }
        }
      }
    });

    await searchEngine.initialize();

    app = express();
    app.use(express.json());
    app.use(proximMiddleware(searchEngine));

    // Turnkey search route
    app.get('/api/search', createSearchHandler(searchEngine));

    // Custom route using req.proxim
    app.get('/api/custom-search', async (req, res) => {
      const q = req.query.q as string;
      const results = await req.proxim!.query({
        queryText: q,
        modes: ['fuzzy']
      });
      res.json(results);
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        port = (server.address() as any).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(resolve));
    }
    await searchEngine.close();
  });

  it('handles search requests via createSearchHandler', async () => {
    const res = await fetch(`http://localhost:${port}/api/search?q=John&modes=fuzzy`);
    expect(res.status).toBe(200);

    const data: any = await res.json();
    expect(data.query).toBe('John');
    expect(data.results.fuzzy.length).toBe(1);
    expect(data.results.fuzzy[0].username).toBe('JohnDoe');
  });

  it('handles search requests using req.proxim in custom route', async () => {
    const res = await fetch(`http://localhost:${port}/api/custom-search?q=Jane`);
    expect(res.status).toBe(200);

    const data: any = await res.json();
    expect(data.results.fuzzy.length).toBe(1);
    expect(data.results.fuzzy[0].username).toBe('JaneSmith');
  });
});
