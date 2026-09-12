import { FormEvent, useEffect, useState } from 'react';
import { useApiClient, ApiError } from '../lib/apiClient';
import { ProductDoc } from '../types';
import { ProductList } from '../components/ProductList';

const PAGE_SIZE = 50;

type Tab = 'all' | 'new';

const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All products' },
  { id: 'new', label: 'New products' },
];

export function ProductsPage() {
  const api = useApiClient();
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<ProductDoc[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const search = (q: string, p: number, t: Tab) => {
    setLoading(true);
    setError(null);
    api.searchProducts(q, p, PAGE_SIZE, t === 'new')
      .then(result => { setProducts(result.products); setTotal(result.total); setPage(result.page); })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Failed to load products.'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount, subsequent searches are user-triggered
  useEffect(() => { search('', 1, 'all'); }, []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    search(query, 1, tab);
  };

  const handleTabChange = (t: Tab) => {
    setTab(t);
    setQuery('');
    search('', 1, t);
  };

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section>
      <h1>Products</h1>
      <p className="page-subtitle">
        {tab === 'new'
          ? 'Products your org has added — check indexing status and retry a failed or pending index here.'
          : 'The shared base catalog plus everything your org has added.'}
      </p>

      <nav className="tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            className={t.id === tab ? 'tab tab-active' : 'tab'}
            onClick={() => handleTabChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <form className="search-bar" onSubmit={handleSubmit}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by name or brand…"
          aria-label="Search products by name or brand"
        />
        <button type="submit">Search</button>
      </form>

      {error && <p className="form-error" role="alert">{error}</p>}
      {loading ? <p role="status">Loading…</p> : (
        <>
          <ProductList products={products} />
          {total > 0 && (
            <div className="pagination">
              <button type="button" disabled={page <= 1} onClick={() => search(query, page - 1, tab)}>
                Previous
              </button>
              <span>Page {page} of {lastPage} ({total} result{total === 1 ? '' : 's'})</span>
              <button type="button" disabled={page >= lastPage} onClick={() => search(query, page + 1, tab)}>
                Next
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
