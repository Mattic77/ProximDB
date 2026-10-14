import Database, { Database as DatabaseInstance } from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

export class EmbeddedDB {
  private db: DatabaseInstance | null = null;
  private readonly storagePath: string;
  private readonly enableTrigram: boolean;

  constructor(storagePath: string = ':memory:', enableTrigram: boolean = true) {
    this.storagePath = storagePath;
    this.enableTrigram = enableTrigram;
  }

  public initialize(): DatabaseInstance {
    if (this.db) {
      return this.db;
    }

    if (this.storagePath !== ':memory:') {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    const db = new Database(this.storagePath);

    // Performance pragmas
    if (this.storagePath !== ':memory:') {
      db.pragma('journal_mode = WAL');
    }
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.pragma('cache_size = -64000'); // 64MB cache
    db.pragma('temp_store = MEMORY');

    // Register custom SQLite functions for fuzzy matching & typo ranking
    this.registerCustomFunctions(db);

    // Initialize base tables
    this.createSchema(db);

    this.db = db;
    return db;
  }

  private registerCustomFunctions(db: DatabaseInstance): void {
    const calcLevenshtein = (s1: string, s2: string): number => {
      if (s1 === s2) return 0;
      if (s1.length === 0) return s2.length;
      if (s2.length === 0) return s1.length;

      const d: number[][] = [];
      for (let i = 0; i <= s1.length; i++) {
        d[i] = [];
        d[i][0] = i;
      }
      for (let j = 0; j <= s2.length; j++) {
        d[0][j] = j;
      }

      for (let i = 1; i <= s1.length; i++) {
        for (let j = 1; j <= s2.length; j++) {
          const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
          d[i][j] = Math.min(
            d[i - 1][j] + 1,       // deletion
            d[i][j - 1] + 1,       // insertion
            d[i - 1][j - 1] + cost // substitution
          );

          if (i > 1 && j > 1 && s1[i - 1] === s2[j - 2] && s1[i - 2] === s2[j - 1]) {
            d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); // transposition
          }
        }
      }

      return d[s1.length][s2.length];
    };

    // Register levenshtein SQLite scalar function
    db.function('levenshtein', (a: unknown, b: unknown): number => {
      if (typeof a !== 'string' || typeof b !== 'string') return 999;
      return calcLevenshtein(a.toLowerCase(), b.toLowerCase());
    });

    // Register fuzzy_similarity scalar function
    db.function('fuzzy_similarity', (a: unknown, b: unknown): number => {
      if (typeof a !== 'string' || typeof b !== 'string') return 0;
      const s1 = a.toLowerCase().trim();
      const s2 = b.toLowerCase().trim();
      if (s1 === s2) return 1.0;
      if (!s1 || !s2) return 0.0;

      // Exact substring match
      if (s1.includes(s2)) {
        const words = s1.split(/[\s,._-]+/);
        if (words.includes(s2)) return 0.95;
        return 0.85;
      }

      // Check token-level similarity
      const words = s1.split(/[\s,._-]+/).filter(Boolean);
      let bestScore = 0;

      for (const word of words) {
        if (word === s2) return 0.95;
        const maxLen = Math.max(word.length, s2.length);
        const dist = calcLevenshtein(word, s2);
        const score = Math.max(0, 1 - dist / maxLen);
        if (score > bestScore) {
          bestScore = score;
        }
      }

      // Also compare with full string
      const wholeMaxLen = Math.max(s1.length, s2.length);
      const wholeDist = calcLevenshtein(s1, s2);
      const wholeScore = Math.max(0, 1 - wholeDist / wholeMaxLen);

      return Number(Math.max(bestScore, wholeScore).toFixed(4));
    });
  }

  private createSchema(db: DatabaseInstance): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS search_nodes (
        id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        attributes_json TEXT NOT NULL,
        search_text TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (entity_type, id)
      );

      CREATE INDEX IF NOT EXISTS idx_nodes_type ON search_nodes(entity_type);
      CREATE INDEX IF NOT EXISTS idx_nodes_search_text ON search_nodes(search_text);

      CREATE TABLE IF NOT EXISTS search_edges (
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        edge_type TEXT NOT NULL,
        weight REAL DEFAULT 1.0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (edge_type, source_id, target_id)
      );

      CREATE INDEX IF NOT EXISTS idx_edges_source ON search_edges(edge_type, source_id);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON search_edges(edge_type, target_id);
      CREATE INDEX IF NOT EXISTS idx_edges_pair ON search_edges(source_id, target_id);

      CREATE TABLE IF NOT EXISTS sync_metadata (
        sync_key TEXT PRIMARY KEY,
        last_sync_timestamp INTEGER NOT NULL,
        item_count INTEGER NOT NULL,
        meta_json TEXT
      );
    `);

    // Setup FTS5 virtual table
    const ftsTokenizer = this.enableTrigram ? "tokenize='trigram'" : '';
    try {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS search_nodes_fts USING fts5(
          id UNINDEXED,
          entity_type UNINDEXED,
          search_text,
          ${ftsTokenizer}
        );
      `);
    } catch {
      // Fallback to standard tokenizer if trigram not supported
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS search_nodes_fts USING fts5(
          id UNINDEXED,
          entity_type UNINDEXED,
          search_text
        );
      `);
    }
  }

  public getRawDb(): DatabaseInstance {
    if (!this.db) {
      return this.initialize();
    }
    return this.db;
  }

  public close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  public isOpen(): boolean {
    return this.db !== null && this.db.open;
  }
}
