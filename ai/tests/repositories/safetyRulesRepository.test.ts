jest.mock('../../src/infra/db', () => ({
  getDb: jest.fn(),
}));

import { getDb } from '../../src/infra/db';
import { findSafetyViolations } from '../../src/repositories/safetyRulesRepository';

describe('findSafetyViolations', () => {
  const mockQuery = jest.fn();

  beforeEach(() => {
    mockQuery.mockReset();
    (getDb as jest.Mock).mockReturnValue({ query: mockQuery });
  });

  it('returns [] without querying when ingredients or conditions is empty', async () => {
    expect(await findSafetyViolations([], ['pregnancy'])).toEqual([]);
    expect(await findSafetyViolations(['retinol'], [])).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('lowercases and trims ingredients/conditions before querying', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await findSafetyViolations([' Retinol '], ['Pregnancy']);

    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [['retinol'], ['pregnancy']]);
  });

  it('returns the matched safety rule rows as-is', async () => {
    const rows = [{ id: '1', ingredient: 'retinol', contraindication: 'pregnancy', severity: 'high' }];
    mockQuery.mockResolvedValue({ rows });

    expect(await findSafetyViolations(['retinol'], ['pregnancy'])).toEqual(rows);
  });

  it('throws a RepositoryError when the query fails', async () => {
    mockQuery.mockRejectedValue(new Error('connection lost'));

    await expect(findSafetyViolations(['retinol'], ['pregnancy'])).rejects.toMatchObject({
      name: 'RepositoryError',
      repository: 'safetyRules',
    });
  });
});

// getKnownContraindications caches results in a module-level variable, so each
// test re-requires the module fresh (after jest.resetModules()) to avoid one
// test's cache leaking into the next.
describe('getKnownContraindications', () => {
  const mockQuery = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    mockQuery.mockReset();
    // jest.resetModules() also clears the mocked infra/db module, so the
    // getDb imported at the top of this file (bound before the reset) is no
    // longer the same instance the freshly-required repository will use —
    // re-require it here and configure the fresh instance instead.
    const freshDb = require('../../src/infra/db');
    (freshDb.getDb as jest.Mock).mockReturnValue({ query: mockQuery });
  });

  it('queries the DB and caches the result, so a second call does not re-query', async () => {
    mockQuery.mockResolvedValue({ rows: [{ contraindication: 'pregnancy' }, { contraindication: 'rosacea' }] });
    const { getKnownContraindications } = require('../../src/repositories/safetyRulesRepository');

    const first = await getKnownContraindications();
    const second = await getKnownContraindications();

    expect(first).toEqual(new Set(['pregnancy', 'rosacea']));
    expect(second).toEqual(first);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('throws a RepositoryError when the query fails', async () => {
    mockQuery.mockRejectedValue(new Error('connection lost'));
    const { getKnownContraindications } = require('../../src/repositories/safetyRulesRepository');

    await expect(getKnownContraindications()).rejects.toMatchObject({
      name: 'RepositoryError',
      repository: 'safetyRules',
    });
  });
});
