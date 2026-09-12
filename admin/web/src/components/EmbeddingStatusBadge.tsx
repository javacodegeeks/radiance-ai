import { useEffect, useState } from 'react';
import { useApiClient, ApiError } from '../lib/apiClient';

type Status = 'loading' | 'indexed' | 'not-indexed' | 'indexing' | 'index-failed' | 'error';

const LABEL: Record<Status, string> = {
  loading:        'Checking…',
  indexed:        'Indexed',
  'not-indexed':  'Not indexed',
  indexing:       'Indexing…',
  'index-failed': 'Index failed',
  error:          'Unknown',
};

const CLASS_NAME: Record<Status, string> = {
  loading:        'badge badge-neutral',
  indexed:        'badge badge-success',
  'not-indexed':  'badge badge-warning',
  indexing:       'badge badge-neutral',
  'index-failed': 'badge badge-danger',
  error:          'badge badge-neutral',
};

export function EmbeddingStatusBadge({ productId }: { productId: string }) {
  const api = useApiClient();
  const [status, setStatus] = useState<Status>('loading');
  const [failureReason, setFailureReason] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    api.getEmbeddingStatus(productId)
      .then(result => {
        if (!cancelled) setStatus(result.indexed ? 'indexed' : 'not-indexed');
      })
      .catch((err: unknown) => {
        console.error('[EmbeddingStatusBadge] lookup failed', err instanceof ApiError ? err.message : err);
        if (!cancelled) setStatus('error');
      });
    return () => { cancelled = true; };
  }, [productId, api]);

  const handleReindex = () => {
    setFailureReason(null);
    setStatus('indexing');
    api.reindexProduct(productId)
      .then(() => setStatus('indexed'))
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? err.message : 'Reindex failed.';
        console.error('[EmbeddingStatusBadge] reindex failed', message);
        setFailureReason(message);
        setStatus('index-failed');
      });
  };

  // Only offer the retry action while there's actually something to retry —
  // not while checking, indexing, or when the product is already indexed.
  const canReindex = status === 'not-indexed' || status === 'index-failed';

  return (
    <span className="embedding-status">
      <span className={CLASS_NAME[status]} title={status === 'index-failed' ? failureReason ?? undefined : undefined}>
        {LABEL[status]}
      </span>
      {canReindex && (
        <button type="button" className="reindex-button" aria-label="Trigger indexing for this product" onClick={handleReindex}>
          Re-index
        </button>
      )}
    </span>
  );
}
