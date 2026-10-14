import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EmbeddedDB } from '../src/engine/embedded.db.js';

describe('EmbeddedDB', () => {
  let dbInstance: EmbeddedDB;

  beforeEach(() => {
    dbInstance = new EmbeddedDB(':memory:');
  });

  afterEach(() => {
    dbInstance.close();
  });

  it('initializes in-memory sqlite with required tables', () => {
    const db = dbInstance.initialize();
    expect(db.open).toBe(true);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((t: any) => t.name);

    expect(tables).toContain('search_nodes');
    expect(tables).toContain('search_edges');
    expect(tables).toContain('sync_metadata');
  });

  it('computes levenshtein distance via custom SQLite function', () => {
    const db = dbInstance.initialize();
    const result = db.prepare('SELECT levenshtein(?, ?) as d').get('kitten', 'sitting') as any;
    expect(result.d).toBe(3);

    const exact = db.prepare('SELECT levenshtein(?, ?) as d').get('john', 'john') as any;
    expect(exact.d).toBe(0);
  });

  it('computes fuzzy_similarity via custom SQLite function', () => {
    const db = dbInstance.initialize();
    const sim1 = db.prepare('SELECT fuzzy_similarity(?, ?) as s').get('johndoe', 'johndoe') as any;
    expect(sim1.s).toBe(1.0);

    const sim2 = db.prepare('SELECT fuzzy_similarity(?, ?) as s').get('john', 'jon') as any;
    expect(sim2.s).toBeGreaterThanOrEqual(0.7);

    const sim3 = db.prepare('SELECT fuzzy_similarity(?, ?) as s').get('alexander', 'zebra') as any;
    expect(sim3.s).toBeLessThan(0.4);
  });
});
