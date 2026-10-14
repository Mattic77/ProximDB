import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EmbeddedDB } from '../src/engine/embedded.db.js';
import { Indexer } from '../src/engine/indexer.js';
import { FuzzyStrategy } from '../src/strategies/fuzzy.strategy.js';

describe('FuzzyStrategy', () => {
  let dbInstance: EmbeddedDB;
  let indexer: Indexer;
  let strategy: FuzzyStrategy;

  beforeEach(() => {
    dbInstance = new EmbeddedDB(':memory:');
    const db = dbInstance.initialize();
    indexer = new Indexer(db);
    strategy = new FuzzyStrategy();

    // Seed test users
    indexer.upsertNodes([
      {
        id: 'u_201',
        entityType: 'user',
        attributes: { username: 'JohnDoe', bio: 'Software engineer', city: 'Paris' },
        searchText: 'johndoe software engineer paris'
      },
      {
        id: 'u_305',
        entityType: 'user',
        attributes: { username: 'Johnny', bio: 'Designer', city: 'Lyon' },
        searchText: 'johnny designer lyon'
      },
      {
        id: 'u_410',
        entityType: 'user',
        attributes: { username: 'AlexSmith', bio: 'Product Manager', city: 'London' },
        searchText: 'alexsmith product manager london'
      }
    ]);
  });

  afterEach(() => {
    dbInstance.close();
  });

  it('matches exact text and prefixes', () => {
    const results = strategy.execute(dbInstance.getRawDb(), {
      queryText: 'John',
      modes: ['fuzzy'],
      limits: { fuzzy: 5 }
    });

    expect(results.length).toBe(2);
    expect(results[0].username).toBe('JohnDoe');
    expect(results[1].username).toBe('Johnny');
  });

  it('matches with typos (fuzzy match)', () => {
    // Query with typo "Jonh" instead of "John"
    const results = strategy.execute(dbInstance.getRawDb(), {
      queryText: 'Jonh',
      modes: ['fuzzy'],
      limits: { fuzzy: 5 },
      threshold: 0.3
    });

    expect(results.length).toBeGreaterThan(0);
    const ids = results.map((r) => r.id);
    expect(ids).toContain('u_201');
  });

  it('respects limits', () => {
    const results = strategy.execute(dbInstance.getRawDb(), {
      queryText: 'John',
      modes: ['fuzzy'],
      limits: { fuzzy: 1 }
    });

    expect(results.length).toBe(1);
  });

  it('filters by entityType', () => {
    // Insert a product node
    indexer.upsertNodes([
      {
        id: 'p_1',
        entityType: 'product',
        attributes: { name: 'John Deere Tractor' },
        searchText: 'john deere tractor'
      }
    ]);

    const userResults = strategy.execute(dbInstance.getRawDb(), {
      queryText: 'John',
      modes: ['fuzzy'],
      entityType: 'user'
    });
    expect(userResults.every((r) => r.entityType === 'user')).toBe(true);

    const productResults = strategy.execute(dbInstance.getRawDb(), {
      queryText: 'John',
      modes: ['fuzzy'],
      entityType: 'product'
    });
    expect(productResults.length).toBe(1);
    expect(productResults[0].id).toBe('p_1');
  });
});
