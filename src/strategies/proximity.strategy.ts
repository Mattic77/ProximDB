import { Database as DatabaseInstance } from 'better-sqlite3';
import { ProximityResultItem, QueryParams } from '../types.js';
import { SearchStrategy } from './strategy.interface.js';
import { sanitizeLimit, sanitizeMaxHops, sanitizeSearchText, sanitizeUserId } from '../utils/security.js';

export class ProximityStrategy implements SearchStrategy<ProximityResultItem> {
  readonly name = 'proximity';

  public execute(db: DatabaseInstance, params: QueryParams): ProximityResultItem[] {
    const forUser = sanitizeUserId(params.forUser);
    if (!forUser) {
      // Proximity search requires a context user
      return [];
    }

    const limit = sanitizeLimit(params.limits && params.limits.proximity, 10, 1000);
    const maxHops = sanitizeMaxHops(params.maxHops, 2, 5); // Strictly bound CTE depth to max 5
    const entityType = typeof params.entityType === 'string' ? params.entityType.slice(0, 100) : null;
    const edgeType = params.edgeTypes && params.edgeTypes.length > 0 && typeof params.edgeTypes[0] === 'string'
      ? params.edgeTypes[0].slice(0, 100)
      : null;
    const filterByQuery = Boolean(params.filterProximityByQuery && params.queryText);
    const queryFilter = filterByQuery ? sanitizeSearchText(params.queryText, 250).toLowerCase() : '';

    // SQLite recursive CTE to find reachable nodes through the graph
    // We compute 1st degree direct connections to exclude them from recommendations,
    // and 2nd degree (friends of friends) to compute mutual connection counts and paths.
    const sql = `
      WITH RECURSIVE
      direct_neighbors AS (
        SELECT 
          CASE WHEN source_id = :forUser THEN target_id ELSE source_id END AS neighbor_id
        FROM search_edges
        WHERE (source_id = :forUser OR target_id = :forUser)
          AND (:edgeType IS NULL OR edge_type = :edgeType)
      ),
      -- Recursive CTE up to maxHops
      graph_traversal(candidate_id, intermediary_id, depth, weight) AS (
        -- Hop 1: Direct friends
        SELECT 
          CASE WHEN source_id = :forUser THEN target_id ELSE source_id END AS candidate_id,
          :forUser AS intermediary_id,
          1 AS depth,
          weight
        FROM search_edges
        WHERE (source_id = :forUser OR target_id = :forUser)
          AND (:edgeType IS NULL OR edge_type = :edgeType)

        UNION ALL

        -- Hop 2+: From current neighbors to candidate
        SELECT 
          CASE WHEN e.source_id = gt.candidate_id THEN e.target_id ELSE e.source_id END AS candidate_id,
          gt.candidate_id AS intermediary_id,
          gt.depth + 1 AS depth,
          gt.weight + e.weight
        FROM graph_traversal gt
        JOIN search_edges e ON (e.source_id = gt.candidate_id OR e.target_id = gt.candidate_id)
        WHERE gt.depth < :maxHops
          AND CASE WHEN e.source_id = gt.candidate_id THEN e.target_id ELSE e.source_id END != :forUser
          AND (:edgeType IS NULL OR e.edge_type = :edgeType)
      ),
      aggregated_candidates AS (
        SELECT 
          gt.candidate_id,
          COUNT(DISTINCT gt.intermediary_id) AS mutual_count,
          GROUP_CONCAT(DISTINCT gt.intermediary_id) AS mutual_ids,
          AVG(gt.weight) AS avg_weight
        FROM graph_traversal gt
        WHERE gt.depth >= 2
          AND gt.candidate_id NOT IN (SELECT neighbor_id FROM direct_neighbors)
          AND gt.candidate_id != :forUser
        GROUP BY gt.candidate_id
      )
      SELECT 
        ac.candidate_id AS id,
        ac.mutual_count AS mutualCount,
        ac.mutual_ids AS mutualIdsStr,
        ac.avg_weight AS score,
        n.entity_type AS entityType,
        n.attributes_json AS attributesJson,
        n.search_text AS searchText
      FROM aggregated_candidates ac
      JOIN search_nodes n ON n.id = ac.candidate_id
      WHERE (:entityType IS NULL OR n.entity_type = :entityType)
        AND (:queryFilter = '' OR n.search_text LIKE '%' || :queryFilter || '%')
      ORDER BY 
        ac.mutual_count DESC,
        ac.avg_weight DESC
      LIMIT :limit
    `;

    try {
      const stmt = db.prepare(sql);
      const rows = stmt.all({
        forUser,
        edgeType,
        maxHops,
        entityType,
        queryFilter,
        limit
      }) as Array<{
        id: string;
        mutualCount: number;
        mutualIdsStr: string;
        score: number;
        entityType: string;
        attributesJson: string;
        searchText: string;
      }>;

      return rows.map((row) => {
        let attributes: Record<string, any> = {};
        try {
          attributes = JSON.parse(row.attributesJson);
        } catch {
          // ignore
        }

        const mutualIds = row.mutualIdsStr ? row.mutualIdsStr.split(',') : [];
        const reason =
          row.mutualCount === 1
            ? 'You have 1 mutual connection'
            : `You have ${row.mutualCount} mutual connections`;

        return {
          id: row.id,
          entityType: row.entityType,
          ...attributes,
          mutualCount: row.mutualCount,
          reason,
          mutualIds,
          score: Number(row.score.toFixed(2))
        };
      });
    } catch (err) {
      // In case of query error, return empty array
      return [];
    }
  }
}
