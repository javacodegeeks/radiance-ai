/**
 * Read-only access to the EU CosIng / ingredient safety Postgres tables
 * (cosmetic_rai db) — reference data seeded by data/pipeline's offline
 * ingestion (see data/migrations/*.sql). admin/server never writes here.
 *
 * All five tables share the same "search a couple of text columns, paginate"
 * shape, so listPaginated() below builds the query once instead of repeating
 * it per table. Table/column names passed in are always fixed string
 * literals from this file's own exported functions — never request input —
 * so interpolating them into SQL is safe; only the search term `q` (from
 * the caller) is passed as a parameterized value.
 */
import { getDb } from '../infra/postgres';
import { RepositoryError } from '../common/errors';

export interface PaginatedRows<T> {
  rows: T[];
  total: number;
}

interface ListSpec {
  table: string;
  columns: string;
  searchColumns: string[];
  orderBy: string;
}

async function listPaginated<T>(spec: ListSpec, q: string, page: number, limit: number): Promise<PaginatedRows<T>> {
  const offset = (page - 1) * limit;
  const searchClause = q
    ? `WHERE ${spec.searchColumns.map((col, i) => `${col} ILIKE $${i + 1}`).join(' OR ')}`
    : '';
  const searchParams = q ? spec.searchColumns.map(() => `%${q}%`) : [];

  console.log(`[safetyDataRepository] list table=${spec.table} q="${q}" page=${page} limit=${limit}`);
  try {
    const pool = getDb();
    const [rowsResult, countResult] = await Promise.all([
      pool.query<T>(
        `SELECT ${spec.columns} FROM ${spec.table} ${searchClause}
         ORDER BY ${spec.orderBy}
         LIMIT $${searchParams.length + 1} OFFSET $${searchParams.length + 2}`,
        [...searchParams, limit, offset],
      ),
      pool.query<{ count: string }>(`SELECT COUNT(*) FROM ${spec.table} ${searchClause}`, searchParams),
    ]);
    const total = Number(countResult.rows[0].count);
    console.log(`[safetyDataRepository] list table=${spec.table} → ${rowsResult.rows.length} row(s) of ${total}`);
    return { rows: rowsResult.rows, total };
  } catch (err) {
    console.error(`[safetyDataRepository] list table=${spec.table} failed`, err);
    throw new RepositoryError('safetyDataRepository', `Failed to list ${spec.table}`, err);
  }
}

export interface IngredientRow {
  id: string;
  inci_name: string;
  common_glossary_name: string;
  chemical_name: string | null;
  ec_no: string | null;
  status: string;
}

export function listIngredients(q: string, page: number, limit: number): Promise<PaginatedRows<IngredientRow>> {
  return listPaginated<IngredientRow>({
    table:         'ingredient',
    columns:       'id, inci_name, common_glossary_name, chemical_name, ec_no, status',
    searchColumns: ['inci_name', 'common_glossary_name', 'chemical_name'],
    orderBy:       'inci_name',
  }, q, page, limit);
}

export interface CosingFunctionRow {
  id: string;
  function_name: string;
  function_description: string | null;
}

export function listCosingFunctions(q: string, page: number, limit: number): Promise<PaginatedRows<CosingFunctionRow>> {
  return listPaginated<CosingFunctionRow>({
    table:         'cosing_function',
    columns:       'id, function_name, function_description',
    searchColumns: ['function_name', 'function_description'],
    orderBy:       'function_name',
  }, q, page, limit);
}

export interface ProhibitedSubstanceRow {
  id: string;
  ingredient: string;
  reference_number: string;
  regulation: string | null;
  cmr: string | null;
}

export function listProhibitedSubstances(q: string, page: number, limit: number): Promise<PaginatedRows<ProhibitedSubstanceRow>> {
  return listPaginated<ProhibitedSubstanceRow>({
    table:         'cosing_prohibited_substances',
    columns:       'id, ingredient, reference_number, regulation, cmr',
    searchColumns: ['ingredient', 'reference_number'],
    orderBy:       'ingredient',
  }, q, page, limit);
}

export interface RestrictionRow {
  id: string;
  ingredient: string;
  annex: string;
  reference_number: string;
  restriction_scope: string | null;
  max_concentration: string | null;
  conditions_text: string | null;
  regulation: string | null;
  cmr: string | null;
}

export function listRestrictions(q: string, page: number, limit: number): Promise<PaginatedRows<RestrictionRow>> {
  return listPaginated<RestrictionRow>({
    table:         'cosing_restrictions',
    columns:       'id, ingredient, annex, reference_number, restriction_scope, max_concentration, conditions_text, regulation, cmr',
    searchColumns: ['ingredient', 'reference_number'],
    orderBy:       'ingredient',
  }, q, page, limit);
}

export interface SafetyRuleRow {
  id: string;
  ingredient: string;
  contraindication: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  notes: string | null;
  source: string | null;
}

export function listSafetyRules(q: string, page: number, limit: number): Promise<PaginatedRows<SafetyRuleRow>> {
  return listPaginated<SafetyRuleRow>({
    table:         'safety_rules',
    columns:       'id, ingredient, contraindication, severity, notes, source',
    searchColumns: ['ingredient', 'contraindication'],
    orderBy:       'ingredient',
  }, q, page, limit);
}
