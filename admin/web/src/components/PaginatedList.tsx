import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { ApiError } from '../lib/apiClient';
import { Paginated } from '../types';

const PAGE_SIZE = 50;

export interface Column<T> {
  header: string;
  render: (item: T) => ReactNode;
}

/**
 * Generic search + paginate + render table — used by SafetyDataPage's five
 * near-identical CosIng/ingredient reference views (mirrors the pattern in
 * ProductsPage/ProductList, generalized since those five share an identical
 * shape end to end).
 */
export function PaginatedList<T>({
  fetchPage,
  columns,
  getKey,
  searchPlaceholder,
  emptyLabel = 'No results found.',
}: {
  fetchPage: (q: string, page: number, limit: number) => Promise<Paginated<T>>;
  columns: Column<T>[];
  getKey: (item: T) => string;
  searchPlaceholder: string;
  emptyLabel?: string;
}) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<T[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = (q: string, p: number) => {
    setLoading(true);
    setError(null);
    fetchPage(q, p, PAGE_SIZE)
      .then(result => { setItems(result.items); setTotal(result.total); setPage(result.page); })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Failed to load data.'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount, subsequent loads are user-triggered
  useEffect(() => { load('', 1); }, []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    load(query, 1);
  };

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <form className="search-bar" onSubmit={handleSubmit}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
        />
        <button type="submit">Search</button>
      </form>

      {error && <p className="form-error" role="alert">{error}</p>}
      {loading ? <p role="status">Loading…</p> : items.length === 0 ? <p className="empty-state">{emptyLabel}</p> : (
        <>
          <table className="product-table">
            <thead>
              <tr>{columns.map(c => <th key={c.header} scope="col">{c.header}</th>)}</tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={getKey(item)}>
                  {columns.map(c => <td key={c.header}>{c.render(item)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pagination">
            <button type="button" disabled={page <= 1} onClick={() => load(query, page - 1)}>Previous</button>
            <span>Page {page} of {lastPage} ({total} result{total === 1 ? '' : 's'})</span>
            <button type="button" disabled={page >= lastPage} onClick={() => load(query, page + 1)}>Next</button>
          </div>
        </>
      )}
    </div>
  );
}
