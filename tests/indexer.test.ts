import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EmbeddedDB } from '../src/engine/embedded.db.js';
import { Indexer } from '../src/engine/indexer.js';

describe('Indexer', () => {
  let dbInstance: EmbeddedDB;
  let indexer: Indexer;

  beforeEach(() => {
    dbInstance = new EmbeddedDB(':memory:');
    const db = dbInstance.initialize();
    indexer = new Indexer(db);
  });

  afterEach(() => {
    dbInstance.close();
  });

  it('upserts and retrieves nodes', () => {
    const inserted = indexer.upsertNodes([
      {
        id: 'u_1',
        entityType: 'user',
        attributes: { username: 'JohnDoe', city: 'Paris' },
        searchText: 'johndoe paris'
      },
      {
        id: 'u_2',
        entityType: 'user',
        attributes: { username: 'JaneDoe', city: 'London' },
        searchText: 'janedoe london'
      }
    ]);

    expect(inserted).toBe(2);
    expect(indexer.getNodesCount('user')).toBe(2);

    const node = indexer.getNode('user', 'u_1');
    expect(node).not.toBeNull();
    expect(node?.attributes.username).toBe('JohnDoe');
    expect(node?.attributes.city).toBe('Paris');
  });

  it('updates existing nodes on conflict', () => {
    indexer.upsertNodes([
      {
        id: 'u_1',
        entityType: 'user',
        attributes: { username: 'John', city: 'Paris' },
        searchText: 'john paris'
      }
    ]);

    indexer.upsertNodes([
      {
        id: 'u_1',
        entityType: 'user',
        attributes: { username: 'John Updated', city: 'Lyon' },
        searchText: 'john updated lyon'
      }
    ]);

    expect(indexer.getNodesCount('user')).toBe(1);
    const node = indexer.getNode('user', 'u_1');
    expect(node?.attributes.username).toBe('John Updated');
    expect(node?.attributes.city).toBe('Lyon');
  });

  it('upserts edges and tracks counts', () => {
    const inserted = indexer.upsertEdges([
      { sourceId: 'u_1', targetId: 'u_2', edgeType: 'follows', weight: 1.0 },
      { sourceId: 'u_2', targetId: 'u_3', edgeType: 'follows', weight: 1.0 }
    ]);

    expect(inserted).toBe(2);
    expect(indexer.getEdgesCount('follows')).toBe(2);
  });

  it('deletes a node and its associated edges', () => {
    indexer.upsertNodes([
      { id: 'u_1', entityType: 'user', attributes: { username: 'User1' }, searchText: 'user1' },
      { id: 'u_2', entityType: 'user', attributes: { username: 'User2' }, searchText: 'user2' }
    ]);
    indexer.upsertEdges([
      { sourceId: 'u_1', targetId: 'u_2', edgeType: 'follows' }
    ]);

    indexer.deleteNode('user', 'u_1');
    expect(indexer.getNode('user', 'u_1')).toBeNull();
    expect(indexer.getEdgesCount('follows')).toBe(0);
  });
});
