import { ProductDoc } from '../types';
import { EmbeddingStatusBadge } from './EmbeddingStatusBadge';

// Raw OBF data stores `countries` inconsistently — sometimes a comma-separated
// string, sometimes an array. Mirrors the toArray() normalization in
// ai/src/repositories/productRepository.ts.
function toArray(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) return value.split(',').map(s => s.trim());
  return [];
}

export function ProductList({ products }: { products: ProductDoc[] }) {
  if (products.length === 0) {
    return <p className="empty-state">No products found.</p>;
  }

  return (
    <table className="product-table">
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Brand</th>
          <th scope="col">Category</th>
          <th scope="col">Countries</th>
          <th scope="col">Source</th>
          <th scope="col">Embedding</th>
        </tr>
      </thead>
      <tbody>
        {products.map(p => (
          <tr key={p._id}>
            <td>{p.product_name ?? 'Unknown Product'}</td>
            <td>{p.brands ?? 'Unknown Brand'}</td>
            <td>{p.category ?? '—'}</td>
            <td>{toArray(p.countries).join(', ') || '—'}</td>
            <td>{p.tenantId ? 'Your org' : 'Base catalog'}</td>
            <td><EmbeddingStatusBadge productId={p._id} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
