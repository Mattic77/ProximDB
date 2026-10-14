import { Database as DatabaseInstance, Statement } from 'better-sqlite3';
import { EdgeRecord, NodeRecord } from '../types.js';

export class Indexer {
  private db: DatabaseInstance;
  private upsertNodeStmt!: Statement;
  private deleteFtsStmt!: Statement;
  private insertFtsStmt!: Statement;
  private upsertEdgeStmt!: Statement;
  private getNodeStmt!: Statement;
  private deleteNodeStmt!: Statement;
  private deleteNodeEdgesStmt!: Statement;
  private hasFts: boolean = true;

  constructor(db: DatabaseInstance) {
    this.db = db;
    this.prepareStatements();
  }

  private prepareStatements(): void {
    this.upsertNodeStmt = this.db.prepare(`
      INSERT INTO search_nodes (id, entity_type, attributes_json, search_text, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(entity_type, id) DO UPDATE SET
        attributes_json = excluded.attributes_json,
        search_text = excluded.search_text,
        updated_at = excluded.updated_at
    `);

    try {
      this.deleteFtsStmt = this.db.prepare(`
        DELETE FROM search_nodes_fts WHERE id = ? AND entity_type = ?
      `);
      this.insertFtsStmt = this.db.prepare(`
        INSERT INTO search_nodes_fts (id, entity_type, search_text)
        VALUES (?, ?, ?)
      `);
      this.hasFts = true;
    } catch {
      this.hasFts = false;
    }

    this.upsertEdgeStmt = this.db.prepare(`
      INSERT INTO search_edges (source_id, target_id, edge_type, weight, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(edge_type, source_id, target_id) DO UPDATE SET
        weight = excluded.weight,
        updated_at = excluded.updated_at
    `);

    this.getNodeStmt = this.db.prepare(`
      SELECT id, entity_type as entityType, attributes_json as attributesJson, search_text as searchText, updated_at as updatedAt
      FROM search_nodes
      WHERE entity_type = ? AND id = ?
    `);

    this.deleteNodeStmt = this.db.prepare(`
      DELETE FROM search_nodes WHERE entity_type = ? AND id = ?
    `);

    this.deleteNodeEdgesStmt = this.db.prepare(`
      DELETE FROM search_edges WHERE source_id = ? OR target_id = ?
    `);
  }

  /**
   * Bulk upserts nodes within a single atomic SQLite transaction
   */
  public upsertNodes(nodes: NodeRecord[]): number {
    if (!nodes || nodes.length === 0) return 0;

    const runBulk = this.db.transaction((records: NodeRecord[]) => {
      let count = 0;
      for (const node of records) {
        const attributesJson = JSON.stringify(node.attributes || {});
        let searchText = node.searchText;
        if (!searchText) {
          searchText = Object.values(node.attributes || {})
            .filter((v) => v !== null && v !== undefined)
            .map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v).trim()))
            .join(' ')
            .toLowerCase();
        }
        const updatedAt = node.updatedAt || Date.now();

        this.upsertNodeStmt.run(node.id, node.entityType, attributesJson, searchText, updatedAt);

        if (this.hasFts) {
          try {
            this.deleteFtsStmt.run(node.id, node.entityType);
            this.insertFtsStmt.run(node.id, node.entityType, searchText);
          } catch {
            // Ignore FTS insert errors if any
          }
        }
        count++;
      }
      return count;
    });

    return runBulk(nodes);
  }

  /**
   * Bulk upserts edges within a single atomic SQLite transaction
   */
  public upsertEdges(edges: EdgeRecord[]): number {
    if (!edges || edges.length === 0) return 0;

    const runBulk = this.db.transaction((records: EdgeRecord[]) => {
      let count = 0;
      for (const edge of records) {
        const weight = edge.weight !== undefined ? edge.weight : 1.0;
        const updatedAt = edge.updatedAt || Date.now();

        this.upsertEdgeStmt.run(edge.sourceId, edge.targetId, edge.edgeType, weight, updatedAt);
        count++;
      }
      return count;
    });

    return runBulk(edges);
  }

  public getNode(entityType: string, id: string): NodeRecord | null {
    const row = this.getNodeStmt.get(entityType, id) as any;
    if (!row) return null;
    return {
      id: row.id,
      entityType: row.entityType,
      attributes: JSON.parse(row.attributesJson),
      searchText: row.searchText,
      updatedAt: row.updatedAt
    };
  }

  public deleteNode(entityType: string, id: string): void {
    const runDelete = this.db.transaction(() => {
      this.deleteNodeStmt.run(entityType, id);
      if (this.hasFts) {
        try {
          this.deleteFtsStmt.run(id, entityType);
        } catch {
          // ignore
        }
      }
      this.deleteNodeEdgesStmt.run(id, id);
    });
    runDelete();
  }

  public clearAll(): void {
    const runClear = this.db.transaction(() => {
      this.db.prepare('DELETE FROM search_nodes').run();
      this.db.prepare('DELETE FROM search_edges').run();
      if (this.hasFts) {
        try {
          this.db.prepare('DELETE FROM search_nodes_fts').run();
        } catch {
          // ignore
        }
      }
      this.db.prepare('DELETE FROM sync_metadata').run();
    });
    runClear();
  }

  public getNodesCount(entityType?: string): number {
    if (entityType) {
      const row = this.db.prepare('SELECT COUNT(*) as cnt FROM search_nodes WHERE entity_type = ?').get(entityType) as any;
      return row ? row.cnt : 0;
    }
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM search_nodes').get() as any;
    return row ? row.cnt : 0;
  }

  public getEdgesCount(edgeType?: string): number {
    if (edgeType) {
      const row = this.db.prepare('SELECT COUNT(*) as cnt FROM search_edges WHERE edge_type = ?').get(edgeType) as any;
      return row ? row.cnt : 0;
    }
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM search_edges').get() as any;
    return row ? row.cnt : 0;
  }
}
