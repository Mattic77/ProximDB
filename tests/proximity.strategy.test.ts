import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EmbeddedDB } from '../src/engine/embedded.db.js';
import { Indexer } from '../src/engine/indexer.js';
import { ProximityStrategy } from '../src/strategies/proximity.strategy.js';

describe('ProximityStrategy', () => {
  let dbInstance: EmbeddedDB;
  let indexer: Indexer;
  let strategy: ProximityStrategy;

  beforeEach(() => {
    dbInstance = new EmbeddedDB(':memory:');
    const db = dbInstance.initialize();
    indexer = new Indexer(db);
    strategy = new ProximityStrategy();

    // Setup nodes
    indexer.upsertNodes([
      { id: 'user_101', entityType: 'user', attributes: { username: 'CurrentViewer' }, searchText: 'currentviewer' },
      { id: 'friend_1', entityType: 'user', attributes: { username: 'MutualBob' }, searchText: 'mutualbob' },
      { id: 'friend_2', entityType: 'user', attributes: { username: 'MutualAlice' }, searchText: 'mutualalice' },
      { id: 'friend_3', entityType: 'user', attributes: { username: 'MutualCharlie' }, searchText: 'mutualcharlie' },
      { id: 'friend_4', entityType: 'user', attributes: { username: 'MutualDavid' }, searchText: 'mutualdavid' },
      { id: 'u_410', entityType: 'user', attributes: { username: 'AlexSmith', city: 'London' }, searchText: 'alexsmith london' },
      { id: 'u_500', entityType: 'user', attributes: { username: 'CasualContact', city: 'Madrid' }, searchText: 'casualcontact madrid' }
    ]);

    // Setup graph edges:
    // user_101 is connected to friend_1, friend_2, friend_3, friend_4
    indexer.upsertEdges([
      { sourceId: 'user_101', targetId: 'friend_1', edgeType: 'follows' },
      { sourceId: 'user_101', targetId: 'friend_2', edgeType: 'follows' },
      { sourceId: 'user_101', targetId: 'friend_3', edgeType: 'follows' },
      { sourceId: 'user_101', targetId: 'friend_4', edgeType: 'follows' },

      // u_410 is connected to all 4 friends (4 mutual connections with user_101)
      { sourceId: 'friend_1', targetId: 'u_410', edgeType: 'follows' },
      { sourceId: 'friend_2', targetId: 'u_410', edgeType: 'follows' },
      { sourceId: 'friend_3', targetId: 'u_410', edgeType: 'follows' },
      { sourceId: 'friend_4', targetId: 'u_410', edgeType: 'follows' },

      // u_500 is only connected to friend_1 (1 mutual connection with user_101)
      { sourceId: 'friend_1', targetId: 'u_500', edgeType: 'follows' }
    ]);
  });

  afterEach(() => {
    dbInstance.close();
  });

  it('ranks candidates by mutual connection count', () => {
    const results = strategy.execute(dbInstance.getRawDb(), {
      forUser: 'user_101',
      modes: ['proximity'],
      limits: { proximity: 5 }
    });

    expect(results.length).toBe(2);

    // u_410 should be top recommendation with 4 mutual connections
    expect(results[0].id).toBe('u_410');
    expect(results[0].username).toBe('AlexSmith');
    expect(results[0].mutualCount).toBe(4);
    expect(results[0].reason).toBe('You have 4 mutual connections');

    // u_500 has 1 mutual connection
    expect(results[1].id).toBe('u_500');
    expect(results[1].mutualCount).toBe(1);
    expect(results[1].reason).toBe('You have 1 mutual connection');
  });

  it('excludes direct connections and the user itself from recommendations', () => {
    const results = strategy.execute(dbInstance.getRawDb(), {
      forUser: 'user_101',
      modes: ['proximity']
    });

    const resultIds = results.map((r) => r.id);
    expect(resultIds).not.toContain('user_101');
    expect(resultIds).not.toContain('friend_1');
    expect(resultIds).not.toContain('friend_2');
    expect(resultIds).not.toContain('friend_3');
    expect(resultIds).not.toContain('friend_4');
  });

  it('filters proximity recommendations with queryText', () => {
    const results = strategy.execute(dbInstance.getRawDb(), {
      forUser: 'user_101',
      queryText: 'Alex',
      filterProximityByQuery: true,
      modes: ['proximity']
    });

    expect(results.length).toBe(1);
    expect(results[0].id).toBe('u_410');
    expect(results[0].username).toBe('AlexSmith');
  });

  it('returns empty array if forUser is not provided', () => {
    const results = strategy.execute(dbInstance.getRawDb(), {
      modes: ['proximity']
    });

    expect(results).toEqual([]);
  });
});
