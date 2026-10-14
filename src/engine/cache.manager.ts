import { Database as DatabaseInstance } from 'better-sqlite3';
import { DatabaseAdapter, MappingConfig, SyncStats } from '../types.js';
import { Indexer } from './indexer.js';

export class CacheManager {
  private db: DatabaseInstance;
  private adapter: DatabaseAdapter;
  private mapping: MappingConfig;
  private indexer: Indexer;
  private syncTimer: NodeJS.Timeout | null = null;
  private isSyncing = false;
  private verbose = false;

  constructor(
    db: DatabaseInstance,
    adapter: DatabaseAdapter,
    mapping: MappingConfig,
    indexer: Indexer,
    options?: { verbose?: boolean }
  ) {
    this.db = db;
    this.adapter = adapter;
    this.mapping = mapping;
    this.indexer = indexer;
    this.verbose = Boolean(options?.verbose);
  }

  public getLastSyncTimestamp(key: string): number | null {
    const row = this.db
      .prepare('SELECT last_sync_timestamp FROM sync_metadata WHERE sync_key = ?')
      .get(key) as { last_sync_timestamp: number } | undefined;
    return row ? row.last_sync_timestamp : null;
  }

  public setLastSyncInfo(key: string, timestamp: number, itemCount: number): void {
    this.db
      .prepare(`
        INSERT INTO sync_metadata (sync_key, last_sync_timestamp, item_count)
        VALUES (?, ?, ?)
        ON CONFLICT(sync_key) DO UPDATE SET
          last_sync_timestamp = excluded.last_sync_timestamp,
          item_count = excluded.item_count
      `)
      .run(key, timestamp, itemCount);
  }

  /**
   * Synchronizes data from primary database into the local embedded SQLite store
   */
  public async sync(options?: { full?: boolean }): Promise<SyncStats> {
    if (this.isSyncing) {
      if (this.verbose) console.warn('[ProximDB] Sync already in progress, skipping trigger.');
      return { nodesCount: 0, edgesCount: 0, durationMs: 0, timestamp: Date.now() };
    }

    this.isSyncing = true;
    const startTime = Date.now();
    let totalNodes = 0;
    let totalEdges = 0;

    try {
      // 1. Sync Nodes
      for (const [entityType, nodeConfig] of Object.entries(this.mapping.nodes)) {
        const syncKey = `node:${entityType}`;
        const lastSync = options?.full ? undefined : this.getLastSyncTimestamp(syncKey) || undefined;

        if (this.verbose) {
          console.log(`[ProximDB] Syncing entity '${entityType}' (since: ${lastSync ? new Date(lastSync).toISOString() : 'beginning'})...`);
        }

        const nodes = await this.adapter.fetchNodes(entityType, nodeConfig, lastSync);
        const indexedCount = this.indexer.upsertNodes(nodes);
        totalNodes += indexedCount;

        this.setLastSyncInfo(syncKey, startTime, this.indexer.getNodesCount(entityType));

        if (this.verbose) {
          console.log(`[ProximDB] Synced ${indexedCount} nodes for '${entityType}'.`);
        }
      }

      // 2. Sync Edges (if any)
      if (this.mapping.edges) {
        for (const [edgeType, edgeConfig] of Object.entries(this.mapping.edges)) {
          const syncKey = `edge:${edgeType}`;
          const lastSync = options?.full ? undefined : this.getLastSyncTimestamp(syncKey) || undefined;

          if (this.verbose) {
            console.log(`[ProximDB] Syncing edges '${edgeType}' (since: ${lastSync ? new Date(lastSync).toISOString() : 'beginning'})...`);
          }

          const edges = await this.adapter.fetchEdges(edgeType, edgeConfig, lastSync);
          const indexedCount = this.indexer.upsertEdges(edges);
          totalEdges += indexedCount;

          this.setLastSyncInfo(syncKey, startTime, this.indexer.getEdgesCount(edgeType));

          if (this.verbose) {
            console.log(`[ProximDB] Synced ${indexedCount} edges for '${edgeType}'.`);
          }
        }
      }

      const durationMs = Date.now() - startTime;
      return {
        nodesCount: totalNodes,
        edgesCount: totalEdges,
        durationMs,
        timestamp: startTime
      };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Starts automatic background sync at regular intervals
   */
  public startAutoSync(intervalMs: number): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }

    this.syncTimer = setInterval(async () => {
      try {
        await this.sync({ full: false });
      } catch (err) {
        console.error('[ProximDB] Auto-sync failed:', err);
      }
    }, intervalMs);

    // Prevent background timer from blocking process exit
    if (this.syncTimer.unref) {
      this.syncTimer.unref();
    }
  }

  /**
   * Stops automatic background sync
   */
  public stopAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }
}
