import { FormEvent, useState } from 'react';
import { AddProductPayload, PRODUCT_CATEGORIES, ProductCategory } from '../types';

const EMPTY_FORM = {
  productName:     '',
  brands:           '',
  ingredientsText: '',
  categoriesTags:  '',
  countries:        '',
  labelsTags:      '',
  allergensTags:   '',
  category:        'none' as ProductCategory,
};

function splitList(value: string): string[] {
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

export function ProductForm({
  onSubmit,
  submitting,
}: {
  onSubmit: (payload: AddProductPayload) => Promise<void>;
  submitting: boolean;
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const update = (field: keyof typeof EMPTY_FORM) => (
    e: { target: { value: string } },
  ) => setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!form.productName.trim() || !form.brands.trim()) {
      setError('Product name and brand are required.');
      return;
    }

    try {
      await onSubmit({
        productName:     form.productName.trim(),
        brands:          form.brands.trim(),
        ingredientsText: form.ingredientsText.trim(),
        categoriesTags:  splitList(form.categoriesTags),
        countries:       splitList(form.countries),
        labelsTags:      splitList(form.labelsTags),
        allergensTags:   splitList(form.allergensTags),
        category:        form.category,
      });
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add product.');
    }
  };

  return (
    <form className="product-form" onSubmit={handleSubmit}>
      {error && <p className="form-error">{error}</p>}

      <label>
        Product name *
        <input value={form.productName} onChange={update('productName')} required />
      </label>

      <label>
        Brand *
        <input value={form.brands} onChange={update('brands')} required />
      </label>

      <label>
        Category *
        <select value={form.category} onChange={update('category')}>
          {PRODUCT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>

      <label>
        Ingredients (INCI, comma-separated)
        <textarea value={form.ingredientsText} onChange={update('ingredientsText')} rows={3} />
      </label>

      <label>
        Categories (comma-separated tags)
        <input value={form.categoriesTags} onChange={update('categoriesTags')} placeholder="face cream, moisturizer" />
      </label>

      <label>
        Countries (comma-separated)
        <input value={form.countries} onChange={update('countries')} placeholder="US, FR" />
      </label>

      <label>
        Labels (comma-separated)
        <input value={form.labelsTags} onChange={update('labelsTags')} placeholder="fragrance-free, vegan" />
      </label>

      <label>
        Allergens (comma-separated)
        <input value={form.allergensTags} onChange={update('allergensTags')} placeholder="tree-nuts" />
      </label>

      <button type="submit" disabled={submitting}>
        {submitting ? 'Adding…' : 'Add product'}
      </button>
    </form>
  );
}
