import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { ProximDB, DEFAULT_STORAGE_PATH } from '../src/index.js';
import { MemoryAdapter } from '../src/adapters/memory.adapter.js';

describe('ProximDB Multi-Mode Engine', () => {
  let searchEngine: ProximDB;
  let adapter: MemoryAdapter;

  beforeEach(async () => {
    // Prepare memory adapter with seed data
    adapter = new MemoryAdapter({
      initialNodes: [
        {
          id: 'user_101',
          entityType: 'user',
          attributes: { username: 'CurrentViewer', bio: 'Tech enthusiast', city: 'Berlin' }
        },
        {
          id: 'u_201',
          entityType: 'user',
          attributes: { username: 'JohnDoe', bio: 'Engineer', city: 'Paris' }
        },
        {
          id: 'u_305',
          entityType: 'user',
          attributes: { username: 'Johnny', bio: 'Musician', city: 'Lyon' }
        },
        {
          id: 'u_410',
          entityType: 'user',
          attributes: { username: 'AlexSmith', bio: 'Writer', city: 'London' }
        },
        {
          id: 'f_1',
          entityType: 'user',
          attributes: { username: 'Friend1' }
        },
        {
          id: 'f_2',
          entityType: 'user',
          attributes: { username: 'Friend2' }
        },
        {
          id: 'f_3',
          entityType: 'user',
          attributes: { username: 'Friend3' }
        },
        {
          id: 'f_4',
          entityType: 'user',
          attributes: { username: 'Friend4' }
        }
      ],
      initialEdges: [
        // Viewer connects to 4 friends
        { sourceId: 'user_101', targetId: 'f_1', edgeType: 'follows' },
        { sourceId: 'user_101', targetId: 'f_2', edgeType: 'follows' },
        { sourceId: 'user_101', targetId: 'f_3', edgeType: 'follows' },
        { sourceId: 'user_101', targetId: 'f_4', edgeType: 'follows' },

        // All 4 friends also follow AlexSmith (u_410)
        { sourceId: 'f_1', targetId: 'u_410', edgeType: 'follows' },
        { sourceId: 'f_2', targetId: 'u_410', edgeType: 'follows' },
        { sourceId: 'f_3', targetId: 'u_410', edgeType: 'follows' },
        { sourceId: 'f_4', targetId: 'u_410', edgeType: 'follows' }
      ]
    });

    searchEngine = new ProximDB({
      source: adapter,
      embeddedStoragePath: ':memory:',
      mapping: {
        nodes: {
          user: {
            table: 'users',
            id: 'id',
            attributes: ['username', 'bio', 'city']
          }
        },
        edges: {
          follows: {
            table: 'follows',
            sourceId: 'follower_id',
            targetId: 'following_id'
          }
        }
      }
    });

    await searchEngine.initialize();
  });

  afterEach(async () => {
    await searchEngine.close();
  });

  it('executes multi-mode query returning fuzzy and proximity results in expected format', async () => {
    const searchResults = await searchEngine.query({
      queryText: 'John',
      forUser: 'user_101',
      modes: ['fuzzy', 'proximity'],
      limits: {
        fuzzy: 5,
        proximity: 3
      }
    });

    expect(searchResults.query).toBe('John');
    expect(searchResults.forUser).toBe('user_101');
    expect(searchResults.results).toBeDefined();

    // Fuzzy results
    expect(Array.isArray(searchResults.results.fuzzy)).toBe(true);
    expect(searchResults.results.fuzzy?.length).toBe(2);
    expect(searchResults.results.fuzzy?.[0].username).toBe('JohnDoe');
    expect(searchResults.results.fuzzy?.[0].city).toBe('Paris');
    expect(searchResults.results.fuzzy?.[1].username).toBe('Johnny');
    expect(searchResults.results.fuzzy?.[1].city).toBe('Lyon');

    // Proximity results
    expect(Array.isArray(searchResults.results.proximity)).toBe(true);
    expect(searchResults.results.proximity?.length).toBe(1);
    expect(searchResults.results.proximity?.[0].id).toBe('u_410');
    expect(searchResults.results.proximity?.[0].username).toBe('AlexSmith');
    expect(searchResults.results.proximity?.[0].mutualCount).toBe(4);
    expect(searchResults.results.proximity?.[0].reason).toBe('You have 4 mutual connections');

    // Metadata
    expect(searchResults.meta.tookMs).toBeGreaterThanOrEqual(0);
    expect(searchResults.meta.counts.fuzzy).toBe(2);
    expect(searchResults.meta.counts.proximity).toBe(1);
  });

  it('supports incremental sync when primary database updates', async () => {
    // Add a new user to primary database adapter
    adapter.addNode({
      id: 'u_999',
      entityType: 'user',
      attributes: { username: 'JohnNew', bio: 'AI researcher', city: 'Tokyo' },
      updatedAt: Date.now() + 1000
    });

    // Run sync
    const stats = await searchEngine.sync();
    expect(stats.nodesCount).toBeGreaterThanOrEqual(1);

    // Query again
    const results = await searchEngine.query({
      queryText: 'JohnNew',
      modes: ['fuzzy']
    });

    expect(results.results.fuzzy?.length).toBeGreaterThanOrEqual(1);
    expect(results.results.fuzzy?.[0].id).toBe('u_999');
    expect(results.results.fuzzy?.[0].username).toBe('JohnNew');
  });

  it('uses default storage path when embeddedStoragePath is omitted', async () => {
    const defaultEngine = new ProximDB({
      source: new MemoryAdapter({
        client: 'memory',
        initialNodes: [
          { id: 'u_test', entityType: 'user', attributes: { username: 'DefaultUser' } }
        ]
      }),
      mapping: {
        nodes: {
          user: { table: 'users', attributes: ['username'] }
        }
      }
    });

    expect(defaultEngine.getStoragePath()).toBe(DEFAULT_STORAGE_PATH);

    await defaultEngine.initialize();
    expect(defaultEngine.getRawDb().open).toBe(true);

    const res = await defaultEngine.query({
      queryText: 'DefaultUser',
      modes: ['fuzzy']
    });
    expect(res.results.fuzzy?.length).toBe(1);

    await defaultEngine.close();

    // Clean up created default test dir
    if (fs.existsSync('./.proximdb')) {
      fs.rmSync('./.proximdb', { recursive: true, force: true });
    }
  });
});
