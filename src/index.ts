import type { Database as DatabaseInstance } from 'better-sqlite3';
import { EmbeddedDB } from './engine/embedded.db.js';
import { Indexer } from './engine/indexer.js';
import { CacheManager } from './engine/cache.manager.js';
import { SearchStrategy } from './strategies/strategy.interface.js';
import { FuzzyStrategy } from './strategies/fuzzy.strategy.js';
import { ProximityStrategy } from './strategies/proximity.strategy.js';
import { PostgresAdapter } from './adapters/postgres.adapter.js';
import { MySQLAdapter } from './adapters/mysql.adapter.js';
import { MongoDBAdapter } from './adapters/mongodb.adapter.js';
import { MemoryAdapter } from './adapters/memory.adapter.js';
import {
  DatabaseAdapter,
  DEFAULT_STORAGE_PATH,
  ProximDBConfig,
  QueryParams,
  QueryResults,
  SyncStats
} from './types.js';

export class ProximDB {
  private config: ProximDBConfig;
  private storagePath: string;
  private embeddedDb: EmbeddedDB;
  private indexer!: Indexer;
  private cacheManager!: CacheManager;
  private adapter!: DatabaseAdapter;
  private strategies: Map<string, SearchStrategy> = new Map();
  private initialized = false;

  constructor(config: ProximDBConfig) {
    this.config = config;
    this.storagePath = config.embeddedStoragePath || DEFAULT_STORAGE_PATH;
    this.embeddedDb = new EmbeddedDB(
      this.storagePath,
      config.enableTrigram !== false
    );

    // Register built-in search strategies
    this.registerStrategy(new FuzzyStrategy());
    this.registerStrategy(new ProximityStrategy());
  }

  /**
   * Initializes the local embedded storage, connects to the primary database,
   * indexes configured entities/edges, and sets up background sync if configured.
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;

    // 1. Initialize embedded SQLite engine
    const rawDb = this.embeddedDb.initialize();

    // 2. Initialize Indexer
    this.indexer = new Indexer(rawDb);

    // 3. Resolve database adapter
    this.adapter = this.resolveAdapter();
    await this.adapter.connect();

    // 4. Initialize CacheManager
    this.cacheManager = new CacheManager(
      rawDb,
      this.adapter,
      this.config.mapping,
      this.indexer,
      { verbose: this.config.verbose }
    );

    // 5. Initial sync from primary database
    await this.cacheManager.sync({ full: false });

    // 6. Start auto-sync if configured
    if (this.config.syncIntervalMs && this.config.syncIntervalMs > 0) {
      this.cacheManager.startAutoSync(this.config.syncIntervalMs);
    }

    this.initialized = true;
  }

  private resolveAdapter(): DatabaseAdapter {
    const src = this.config.source;

    // Custom adapter instance
    if (typeof (src as any).fetchNodes === 'function') {
      return src as DatabaseAdapter;
    }

    const sourceConfig = src as any;
    switch (sourceConfig.client) {
      case 'postgres':
        return new PostgresAdapter(sourceConfig);
      case 'mysql':
        return new MySQLAdapter(sourceConfig);
      case 'mongodb':
        return new MongoDBAdapter(sourceConfig);
      case 'memory':
        return new MemoryAdapter(sourceConfig);
      default:
        throw new Error(`Unsupported source client: ${(sourceConfig as any).client}`);
    }
  }

  /**
   * Registers a custom search strategy
   */
  public registerStrategy(strategy: SearchStrategy): void {
    this.strategies.set(strategy.name, strategy);
  }

  /**
   * Executes a multi-mode search query locally against the embedded engine
   */
  public async query(params: QueryParams): Promise<QueryResults> {
    if (!this.initialized) {
      await this.initialize();
    }

    const startTime = Date.now();
    const rawDb = this.embeddedDb.getRawDb();
    const results: Record<string, any[]> = {};
    const counts: Record<string, number> = {};

    for (const mode of params.modes) {
      const strategy = this.strategies.get(mode);
      if (!strategy) {
        if (this.config.verbose) {
          console.warn(`[ProximDB] Strategy "${mode}" not found. Skipping.`);
        }
        results[mode] = [];
        counts[mode] = 0;
        continue;
      }

      const modeResults = await strategy.execute(rawDb, params);
      results[mode] = modeResults;
      counts[mode] = modeResults.length;
    }

    const tookMs = Date.now() - startTime;

    return {
      query: params.queryText,
      forUser: params.forUser,
      results,
      meta: {
        tookMs,
        counts
      }
    };
  }

  /**
   * Manually triggers a synchronization from the primary database
   */
  public async sync(options?: { full?: boolean }): Promise<SyncStats> {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.cacheManager.sync(options);
  }

  /**
   * Gracefully shuts down embedded storage, timers, and primary database connections
   */
  public async close(): Promise<void> {
    if (this.cacheManager) {
      this.cacheManager.stopAutoSync();
    }
    if (this.adapter) {
      await this.adapter.disconnect();
    }
    this.embeddedDb.close();
    this.initialized = false;
  }

  public getRawDb(): DatabaseInstance {
    return this.embeddedDb.getRawDb();
  }

  public getIndexer(): Indexer {
    return this.indexer;
  }

  public getCacheManager(): CacheManager {
    return this.cacheManager;
  }

  public getAdapter(): DatabaseAdapter {
    return this.adapter;
  }

  public getStoragePath(): string {
    return this.storagePath;
  }
}

// Export everything from modules
export * from './types.js';
export * from './engine/embedded.db.js';
export * from './engine/indexer.js';
export * from './engine/cache.manager.js';
export * from './adapters/index.js';
export * from './strategies/index.js';
export * from './middleware/express.js';
export * from './utils/security.js';
export default ProximDB;
