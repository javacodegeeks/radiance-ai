/**
 * Thin fetch wrapper around admin/server's API. Every call attaches the
 * caller's Clerk session token as a Bearer token — admin/server's
 * clerkMiddleware() (see admin/server/src/server.ts) validates it and
 * resolves tenantId/role from the token itself, never from anything this
 * client sends explicitly.
 */
import { useAuth } from '@clerk/clerk-react';
import { useCallback, useMemo } from 'react';
import { DEV_BYPASS_AUTH } from './devConfig';
import {
  AddProductPayload, AddProductResponse, EmbeddingStatus, ReindexResult, SearchProductsResult, TenantRecord,
  Paginated, IngredientRecord, CosingFunctionRecord, ProhibitedSubstanceRecord, RestrictionRecord, SafetyRuleRecord,
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * DEV_BYPASS_AUTH is a fixed env flag resolved once at startup — the branch
 * below never changes across renders for the lifetime of the app, so this
 * is safe despite looking like a conditional hook call. In bypass mode no
 * ClerkProvider is mounted (see main.tsx), so useAuth() must never actually
 * be invoked — admin/server's matching DEV_BYPASS_AUTH mode doesn't check
 * the Authorization header anyway (see middleware/auth.ts).
 */
function useAuthToken(): () => Promise<string | null> {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return DEV_BYPASS_AUTH ? useCallback(async () => null, []) : useAuth().getToken;
}

export function useApiClient() {
  const getToken = useAuthToken();

  const request = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const token = await getToken();
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, (body as { error?: string }).error ?? `Request failed (${res.status})`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }, [getToken]);

  return useMemo(() => ({
    searchProducts: (q: string, page = 1, limit = 20, mine = false) =>
      request<SearchProductsResult>(`/api/products?q=${encodeURIComponent(q)}&page=${page}&limit=${limit}&mine=${mine}`),

    addProduct: (payload: AddProductPayload) =>
      request<AddProductResponse>('/api/products', { method: 'POST', body: JSON.stringify(payload) }),

    getEmbeddingStatus: (productId: string, includeVector = false) =>
      request<EmbeddingStatus>(`/api/products/${productId}/embedding${includeVector ? '?vector=true' : ''}`),

    reindexProduct: (productId: string) =>
      request<ReindexResult>(`/api/products/${productId}/reindex`, { method: 'POST' }),

    getTenant: () =>
      request<{ tenant: TenantRecord | null }>('/api/tenants/me').then(r => r.tenant),

    registerTenant: (input: { subdomain: string; name: string }) =>
      request<void>('/api/tenants', { method: 'POST', body: JSON.stringify(input) }),

    listIngredients: (q: string, page = 1, limit = 20) =>
      request<Paginated<IngredientRecord>>(`/api/ingredients?q=${encodeURIComponent(q)}&page=${page}&limit=${limit}`),

    listCosingFunctions: (q: string, page = 1, limit = 20) =>
      request<Paginated<CosingFunctionRecord>>(`/api/cosing/functions?q=${encodeURIComponent(q)}&page=${page}&limit=${limit}`),

    listProhibitedSubstances: (q: string, page = 1, limit = 20) =>
      request<Paginated<ProhibitedSubstanceRecord>>(`/api/cosing/prohibited-substances?q=${encodeURIComponent(q)}&page=${page}&limit=${limit}`),

    listRestrictions: (q: string, page = 1, limit = 20) =>
      request<Paginated<RestrictionRecord>>(`/api/cosing/restrictions?q=${encodeURIComponent(q)}&page=${page}&limit=${limit}`),

    listSafetyRules: (q: string, page = 1, limit = 20) =>
      request<Paginated<SafetyRuleRecord>>(`/api/safety-rules?q=${encodeURIComponent(q)}&page=${page}&limit=${limit}`),
  }), [request]);
}
