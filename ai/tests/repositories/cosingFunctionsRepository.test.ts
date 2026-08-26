jest.mock('../../src/infra/db', () => ({
  getDb: jest.fn(),
}));

import { getDb } from '../../src/infra/db';
import { findIngredientsByFunction, COSING_FUNCTION_NAMES } from '../../src/repositories/cosingFunctionsRepository';

describe('findIngredientsByFunction', () => {
  const mockQuery = jest.fn();

  beforeEach(() => {
    mockQuery.mockReset();
    (getDb as jest.Mock).mockReturnValue({ query: mockQuery });
  });

  it('returns [] without querying the DB when given no function names', async () => {
    const result = await findIngredientsByFunction([]);

    expect(result).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('queries with the given function names and returns the matched INCI names', async () => {
    mockQuery.mockResolvedValue({ rows: [{ inci_name: 'Glycerin' }, { inci_name: 'Panthenol' }] });

    const result = await findIngredientsByFunction(['MOISTURISING']);

    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [['MOISTURISING']]);
    expect(result).toEqual(['Glycerin', 'Panthenol']);
  });

  it('returns [] when no ingredient matches any of the given functions', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const result = await findIngredientsByFunction(['NAIL SCULPTING']);

    expect(result).toEqual([]);
  });

  it('throws a RepositoryError when the query fails', async () => {
    mockQuery.mockRejectedValue(new Error('connection lost'));

    await expect(findIngredientsByFunction(['MOISTURISING'])).rejects.toMatchObject({
      name: 'RepositoryError',
      repository: 'cosingFunctions',
    });
  });
});

describe('COSING_FUNCTION_NAMES', () => {
  it('is a non-empty, deduplicated glossary', () => {
    expect(COSING_FUNCTION_NAMES.length).toBeGreaterThan(0);
    expect(new Set(COSING_FUNCTION_NAMES).size).toBe(COSING_FUNCTION_NAMES.length);
  });

  it('contains the specific functions the Recommender relies on for side-effect resolution (MOISTURISING, SOOTHING)', () => {
    expect(COSING_FUNCTION_NAMES).toContain('MOISTURISING');
    expect(COSING_FUNCTION_NAMES).toContain('SOOTHING');
  });
});
