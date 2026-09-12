import { FormEvent, useEffect, useState } from 'react';
import { useApiClient, ApiError } from '../lib/apiClient';
import { TenantRecord } from '../types';

/**
 * Lets an org admin register (once) the subdomain consumer chat sessions
 * resolve to their org — see ai/src/middleware/tenantResolution.ts.
 */
export function SettingsPage() {
  const api = useApiClient();
  const [tenant, setTenant] = useState<TenantRecord | null | undefined>(undefined);
  const [subdomain, setSubdomain] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getTenant()
      .then(setTenant)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Failed to load tenant info.'));
  }, [api]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!subdomain.trim() || !name.trim()) {
      setError('Subdomain and name are required.');
      return;
    }

    setSaving(true);
    try {
      await api.registerTenant({ subdomain: subdomain.trim(), name: name.trim() });
      setTenant(await api.getTenant());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to register tenant.');
    } finally {
      setSaving(false);
    }
  };

  if (tenant === undefined) return <p>Loading…</p>;

  return (
    <section>
      <h1>Organization settings</h1>

      {tenant ? (
        <dl className="tenant-info">
          <dt>Name</dt><dd>{tenant.name}</dd>
          <dt>Subdomain</dt><dd>{tenant.subdomain}.radiance.ai</dd>
          <dt>Tenant ID</dt><dd>{tenant.tenantId}</dd>
        </dl>
      ) : (
        <>
          <p>No subdomain registered yet — consumer chat sessions won't resolve to your organization until this is set.</p>
          {error && <p className="form-error">{error}</p>}
          <form className="product-form" onSubmit={handleSubmit}>
            <label>
              Organization name *
              <input value={name} onChange={e => setName(e.target.value)} required />
            </label>
            <label>
              Subdomain *
              <input value={subdomain} onChange={e => setSubdomain(e.target.value)} placeholder="tenant1" required />
            </label>
            <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Register'}</button>
          </form>
        </>
      )}
    </section>
  );
}
