jest.mock('../../src/infra/db', () => ({
  getDb: jest.fn(),
}));

import { getDb } from '../../src/infra/db';
import {
  findCosingRestrictions,
  findProhibitedSubstances,
} from '../../src/repositories/cosingRestrictionsRepository';

describe('cosingRestrictionsRepository', () => {
  const mockQuery = jest.fn();

  beforeEach(() => {
    mockQuery.mockReset();
    (getDb as jest.Mock).mockReturnValue({ query: mockQuery });
  });

  describe('findCosingRestrictions', () => {
    it('returns [] without querying the DB when given no ingredients', async () => {
      const result = await findCosingRestrictions([]);

      expect(result).toEqual([]);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('lowercases and trims ingredients before querying', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await findCosingRestrictions([' Retinol ', 'Salicylic Acid']);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        [['retinol', 'salicylic acid']],
      );
    });

    it('maps DB rows (snake_case) to CosingRestriction objects (camelCase)', async () => {
      mockQuery.mockResolvedValue({
        rows: [{
          id: '1',
          ingredient: 'retinol',
          annex: 'III',
          reference_number: '123',
          restriction_scope: 'leave-on',
          max_concentration: '0.3%',
          conditions_text: 'not for pregnant women',
          regulation: 'EC 1223/2009',
        }],
      });

      const result = await findCosingRestrictions(['retinol']);

      expect(result).toEqual([{
        id: '1',
        ingredient: 'retinol',
        annex: 'III',
        referenceNumber: '123',
        restrictionScope: 'leave-on',
        maxConcentration: '0.3%',
        conditionsText: 'not for pregnant women',
        regulation: 'EC 1223/2009',
      }]);
    });

    it('throws a RepositoryError when the query fails', async () => {
      mockQuery.mockRejectedValue(new Error('connection lost'));

      await expect(findCosingRestrictions(['retinol'])).rejects.toMatchObject({
        name: 'RepositoryError',
        repository: 'cosingRestrictions',
      });
    });
  });

  describe('findProhibitedSubstances', () => {
    it('returns [] without querying the DB when given no ingredients', async () => {
      const result = await findProhibitedSubstances([]);

      expect(result).toEqual([]);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('maps DB rows (snake_case) to CosingProhibitedSubstance objects (camelCase)', async () => {
      mockQuery.mockResolvedValue({
        rows: [{
          id: '2',
          ingredient: 'hydroquinone',
          reference_number: '456',
          regulation: 'EC 1223/2009',
          cmr: '1B',
        }],
      });

      const result = await findProhibitedSubstances(['hydroquinone']);

      expect(result).toEqual([{
        id: '2',
        ingredient: 'hydroquinone',
        referenceNumber: '456',
        regulation: 'EC 1223/2009',
        cmr: '1B',
      }]);
    });

    it('throws a RepositoryError when the query fails', async () => {
      mockQuery.mockRejectedValue(new Error('connection lost'));

      await expect(findProhibitedSubstances(['hydroquinone'])).rejects.toMatchObject({
        name: 'RepositoryError',
        repository: 'cosingProhibitedSubstances',
      });
    });
  });
});
