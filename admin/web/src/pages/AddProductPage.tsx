import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiClient } from '../lib/apiClient';
import { AddProductPayload } from '../types';
import { ProductForm } from '../components/ProductForm';

export function AddProductPage() {
  const api = useApiClient();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [addedName, setAddedName] = useState<string | null>(null);

  const handleSubmit = async (payload: AddProductPayload) => {
    setSubmitting(true);
    try {
      await api.addProduct(payload);
      setAddedName(payload.productName);
      setTimeout(() => navigate('/products'), 1200);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section>
      <h1>Add product</h1>
      {addedName && <p className="form-success">Added "{addedName}" — redirecting to product list…</p>}
      <ProductForm onSubmit={handleSubmit} submitting={submitting} />
    </section>
  );
}
