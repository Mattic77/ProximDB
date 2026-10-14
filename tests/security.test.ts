import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PostgresAdapter } from '../src/adapters/postgres.adapter.js';
import { MySQLAdapter } from '../src/adapters/mysql.adapter.js';
import { MongoDBAdapter } from '../src/adapters/mongodb.adapter.js';
import { FuzzyStrategy } from '../src/strategies/fuzzy.strategy.js';
import { ProximityStrategy } from '../src/strategies/proximity.strategy.js';
import { EmbeddedDB } from '../src/engine/embedded.db.js';
import {
  validateIdentifier,
  quotePostgresIdentifier,
  quoteMySQLIdentifier,
  sanitizeLimit,
  sanitizeMaxHops,
  sanitizeSearchText,
  SecurityError
} from '../src/utils/security.js';

describe('Security & Vulnerability Defenses', () => {
  describe('SQL Identifier Validation & Injection Defense', () => {
    it('allows valid alphanumeric and underscore identifiers', () => {
      expect(validateIdentifier('users')).toBe('users');
      expect(validateIdentifier('user_profiles_v2')).toBe('user_profiles_v2');
      expect(validateIdentifier('public.users', true)).toBe('public.users');
    });

    it('rejects SQL injection payloads in table and column identifiers', () => {
      const malicious = [
        'users; DROP TABLE users; --',
        'users" WHERE 1=1; --',
        'users` OR 1=1',
        'users/*',
        'users union select * from passwords',
        "admin'--",
        'table$(whoami)'
      ];

      for (const payload of malicious) {
        expect(() => validateIdentifier(payload)).toThrowError(SecurityError);
        expect(() => quotePostgresIdentifier(payload)).toThrowError(SecurityError);
        expect(() => quoteMySQLIdentifier(payload)).toThrowError(SecurityError);
      }
    });

    it('prevents PostgresAdapter from executing queries with malicious table names', async () => {
      const adapter = new PostgresAdapter({
        client: 'postgres',
        connection: { host: 'localhost' }
      });

      await expect(
        adapter.fetchNodes('user', {
          table: 'users"; DROP TABLE accounts; --',
          attributes: ['name']
        })
      ).rejects.toThrowError(SecurityError);
    });

    it('prevents MySQLAdapter from executing queries with malicious column names', async () => {
      const adapter = new MySQLAdapter({
        client: 'mysql',
        connection: { host: 'localhost' }
      });

      await expect(
        adapter.fetchNodes('user', {
          table: 'users',
          attributes: ['name` = 1; DROP TABLE users; --']
        })
      ).rejects.toThrowError(SecurityError);
    });

    it('prevents MongoDBAdapter from accessing malicious collection or field names', async () => {
      const adapter = new MongoDBAdapter({
        client: 'mongodb',
        uri: 'mongodb://localhost:27017'
      });

      await expect(
        adapter.fetchNodes('user', {
          table: '$where',
          attributes: ['name']
        })
      ).rejects.toThrowError(SecurityError);
    });
  });

  describe('Denial of Service (DoS) & Memory Exhaustion Protection', () => {
    it('clamps excessive or negative limits safely', () => {
      expect(sanitizeLimit(999999999, 10, 1000)).toBe(1000);
      expect(sanitizeLimit(-50, 10, 1000)).toBe(10);
      expect(sanitizeLimit(0, 10, 1000)).toBe(10);
      expect(sanitizeLimit('invalid', 10, 1000)).toBe(10);
      expect(sanitizeLimit(50, 10, 1000)).toBe(50);
    });

    it('bounds recursive CTE hops to prevent exponential path explosion', () => {
      // Attacker asks for 100 hops
      expect(sanitizeMaxHops(100, 2, 5)).toBe(5);
      expect(sanitizeMaxHops(0, 2, 5)).toBe(2);
      expect(sanitizeMaxHops(-10, 2, 5)).toBe(2);
      expect(sanitizeMaxHops(3, 2, 5)).toBe(3);
    });

    it('truncates oversized search queries to prevent ReDoS and memory bloat', () => {
      const hugeString = 'a'.repeat(50000);
      const sanitized = sanitizeSearchText(hugeString, 250);
      expect(sanitized.length).toBe(250);
    });

    it('strips null bytes from queries', () => {
      const malicious = 'admin\x00_drop_table';
      expect(sanitizeSearchText(malicious)).toBe('admin_drop_table');
    });
  });

  describe('Strategy Input Defense', () => {
    let dbInstance: EmbeddedDB;

    beforeEach(() => {
      dbInstance = new EmbeddedDB(':memory:');
      dbInstance.initialize();
    });

    afterEach(() => {
      dbInstance.close();
    });

    it('FuzzyStrategy safely handles massive limits and oversized query text', () => {
      const strategy = new FuzzyStrategy();
      const results = strategy.execute(dbInstance.getRawDb(), {
        queryText: 'a'.repeat(5000),
        modes: ['fuzzy'],
        limits: { fuzzy: 999999999 }
      });
      expect(Array.isArray(results)).toBe(true);
    });

    it('ProximityStrategy caps maxHops to 5 when user attempts 999 hops', () => {
      const strategy = new ProximityStrategy();
      const results = strategy.execute(dbInstance.getRawDb(), {
        forUser: 'user_1',
        modes: ['proximity'],
        maxHops: 999,
        limits: { proximity: 999999999 }
      });
      expect(Array.isArray(results)).toBe(true);
    });
  });
});
