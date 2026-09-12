jest.mock('../../src/infra/qdrant', () => ({
  qdrant: { search: jest.fn() },
}));
jest.mock('../../src/infra/mongo', () => ({
  getDb: jest.fn(),
}));

import { qdrant } from '../../src/infra/qdrant';
import { getDb } from '../../src/infra/mongo';
import { findSimilarProducts } from '../../src/repositories/productRepository';

describe('findSimilarProducts', () => {
  const mockToArray = jest.fn();
  const mockFind = jest.fn(() => ({ toArray: mockToArray }));
  const mockCollection = jest.fn(() => ({ find: mockFind }));

  beforeEach(() => {
    jest.clearAllMocks();
    (getDb as jest.Mock).mockResolvedValue({ collection: mockCollection });
    mockFind.mockReturnValue({ toArray: mockToArray });
  });

  it('omits the country filter when none is given, and includes it when provided (always scoped to the base catalog)', async () => {
    (qdrant.search as jest.Mock).mockResolvedValue([]);

    await findSimilarProducts([0.1, 0.2], 5);
    expect(qdrant.search).toHaveBeenLastCalledWith(
      'products',
      expect.objectContaining({ filter: { must: [{ is_empty: { key: 'tenant_id' } }] } }),
    );

    await findSimilarProducts([0.1, 0.2], 5, 'US');
    expect(qdrant.search).toHaveBeenLastCalledWith(
      'products',
      expect.objectContaining({
        filter: { must: [{ key: 'countries', match: { value: 'US' } }, { is_empty: { key: 'tenant_id' } }] },
      }),
    );
  });

  it('unions the base catalog with tenant-owned additions when a tenantId is resolved, deduping by highest score', async () => {
    (qdrant.search as jest.Mock)
      .mockResolvedValueOnce([{ id: 'a', score: 0.5, payload: { mongo_id: 'a' } }])
      .mockResolvedValueOnce([{ id: 'c', score: 0.9, payload: { mongo_id: 'c' } }]);
    mockToArray.mockResolvedValue([]);

    await findSimilarProducts([0.1, 0.2], 5, undefined, 'tenant-1');

    expect(qdrant.search).toHaveBeenCalledTimes(2);
    expect(qdrant.search).toHaveBeenNthCalledWith(
      1,
      'products',
      expect.objectContaining({ filter: { must: [{ is_empty: { key: 'tenant_id' } }] } }),
    );
    expect(qdrant.search).toHaveBeenNthCalledWith(
      2,
      'products',
      expect.objectContaining({
        filter: { must: [{ key: 'tenant_id', match: { value: 'tenant-1' } }] },
      }),
    );
  });

  it('returns [] without querying Mongo when no Qdrant hit has a mongo_id payload', async () => {
    (qdrant.search as jest.Mock).mockResolvedValue([{ payload: {} }, { payload: undefined }]);

    const result = await findSimilarProducts([0.1, 0.2]);

    expect(result).toEqual([]);
    expect(getDb).not.toHaveBeenCalled();
  });

  it('hydrates matching Mongo docs, reordered to match Qdrant relevance order, mapped to Product fields', async () => {
    (qdrant.search as jest.Mock).mockResolvedValue([
      { id: 'a', score: 0.9, payload: { mongo_id: 'a' } },
      { id: 'b', score: 0.8, payload: { mongo_id: 'b' } },
    ]);
    // Returned from Mongo in the "wrong" order to prove re-sorting happens.
    mockToArray.mockResolvedValue([
      {
        _id: 'b',
        product_name_en: 'Gentle Cleanser',
        brands: 'Acme',
        ingredients_text_en: 'water, glycerin',
        categories: 'cleanser',
        countries: 'US,FR',
        labels_tags: ['en:fragrance-free'],
        allergens_tags: ['en:tree-nuts'],
        image_front_url: 'https://images.example/cleanser-front.jpg',
      },
      {
        _id: 'a',
        product_name: 'Hydrating Serum',
        brands: 'Acme',
        ingredients_text: 'water, hyaluronic acid',
        categories: [],
        countries: [],
        labels_tags: [],
        allergens_tags: [],
      },
    ]);

    const result = await findSimilarProducts([0.1, 0.2]);

    expect(mockFind).toHaveBeenCalledWith({ $or: [{ code: 'a' }, { code: 'b' }] });
    expect(result).toEqual([
      {
        name: 'Hydrating Serum',
        brand: 'Acme',
        inci: ['water', 'hyaluronic acid'],
        categories: [],
        countryAvailability: [],
        labels: [],
        allergens: [],
        imageUrl: undefined,
        cachedAt: undefined,
      },
      {
        name: 'Gentle Cleanser',
        brand: 'Acme',
        inci: ['water', 'glycerin'],
        categories: ['cleanser'],
        countryAvailability: ['US', 'FR'],
        labels: ['fragrance free'],
        allergens: ['tree nuts'],
        imageUrl: 'https://images.example/cleanser-front.jpg',
        cachedAt: undefined,
      },
    ]);
  });

  it('falls back through image_url / image_front_small_url / image_small_url when image_front_url is absent, and ignores non-string values', async () => {
    (qdrant.search as jest.Mock).mockResolvedValue([{ payload: { mongo_id: 'a' } }]);
    mockToArray.mockResolvedValue([
      { _id: 'a', product_name: 'Toner', image_url: '  ', image_small_url: 'https://images.example/toner-small.jpg' },
    ]);

    const [result] = await findSimilarProducts([0.1, 0.2]);

    expect(result.imageUrl).toBe('https://images.example/toner-small.jpg');
  });

  it('throws a RepositoryError when the Qdrant search fails', async () => {
    (qdrant.search as jest.Mock).mockRejectedValue(new Error('qdrant down'));

    await expect(findSimilarProducts([0.1, 0.2])).rejects.toMatchObject({
      name: 'RepositoryError',
      repository: 'productRepository',
    });
  });

  it('throws a RepositoryError when Mongo hydration fails', async () => {
    (qdrant.search as jest.Mock).mockResolvedValue([{ payload: { mongo_id: 'a' } }]);
    mockToArray.mockRejectedValue(new Error('mongo down'));

    await expect(findSimilarProducts([0.1, 0.2])).rejects.toMatchObject({
      name: 'RepositoryError',
      repository: 'productRepository',
    });
  });
});
