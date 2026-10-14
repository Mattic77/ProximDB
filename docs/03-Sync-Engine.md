# Synchronization Engine & Adapters

ProximDB features a synchronization engine designed to bridge external databases with the embedded SQLite engine.

## 1. Selective Projection Mapping

Instead of replicating the entire database schema, developers specify only the attributes and tables that participate in search or relationship recommendations:

```typescript
mapping: {
  nodes: {
    user: {
      table: 'users',
      id: 'id',
      attributes: ['username', 'bio', 'city'],
      updatedAt: 'updated_at' // Enables incremental sync
    }
  },
  edges: {
    follows: {
      table: 'follows',
      sourceId: 'follower_id',
      targetId: 'following_id',
      updatedAt: 'created_at'
    }
  }
}
```

---

## 2. Supported Primary Database Adapters

ProximDB includes ready-to-use adapters:

1. **`PostgresAdapter` (`client: 'postgres'`)**:
   - Queries tables using PostgreSQL connection string or pool config.
   - Leverages `to_timestamp` and parameterized queries for incremental syncs.
2. **`MySQLAdapter` (`client: 'mysql'`)**:
   - Uses `mysql2/promise` connection pool.
   - Escapes column names and handles timestamp delta extraction.
3. **`MongoDBAdapter` (`client: 'mongodb'`)**:
   - Uses MongoDB driver to query collections with projection filters.
4. **`MemoryAdapter` (`client: 'memory'`)**:
   - In-memory adapter for unit testing, CI pipelines, and local mock prototyping without spinning up database servers.

---

## 3. Bulk & Incremental Synchronization

- **Full Sync:** Ingests all designated rows and edges from the primary database into SQLite.
- **Incremental Sync:** Uses `updatedAt` column timestamps stored in `sync_metadata`. Only records updated since the last sync are fetched.
- **Atomic SQLite Transactions:** Inserts and upserts are executed within `db.transaction(...)`, allowing thousands of records to be indexed in a few milliseconds.
- **Automatic Background Sync:** Set `syncIntervalMs` to automatically poll and update the embedded cache at regular intervals without blocking the main event loop.

```typescript
// Manual trigger
const stats = await searchEngine.sync({ full: false });
console.log(`Synced ${stats.nodesCount} nodes in ${stats.durationMs}ms`);
```

---

## 4. Express.js Integration

Integrate directly into Express applications with `proximMiddleware` or `createSearchHandler`:

```typescript
import express from 'express';
import { proximMiddleware, createSearchHandler } from 'proximdb';

const app = express();
app.use(proximMiddleware(searchEngine));

// Turnkey search route:
// GET /api/search?q=John&modes=fuzzy,proximity&forUser=user_101
app.get('/api/search', createSearchHandler(searchEngine));

// Or custom route:
app.get('/api/users/search', async (req, res) => {
  const results = await req.proxim.query({
    queryText: req.query.q,
    forUser: req.user?.id,
    modes: ['fuzzy', 'proximity']
  });
  res.json(results);
});
```
