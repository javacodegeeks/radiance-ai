import { SafetyRulesRepository, SafetyRuleRow } from '../../src/repositories/safetyRulesRepository';

// Minimal pool mock — swap for testcontainers when integrating against a real DB
const mockQuery = jest.fn();
const mockPool = { query: mockQuery } as any;

const repo = new SafetyRulesRepository(mockPool);

beforeEach(() => mockQuery.mockReset());

describe('SafetyRulesRepository.findViolations', () => {
  it('returns empty array when ingredients list is empty', async () => {
    const result = await repo.findViolations([], ['pregnancy']);
    expect(result).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns empty array when conditions list is empty', async () => {
    const result = await repo.findViolations(['retinol'], []);
    expect(result).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('queries the database and returns violations', async () => {
    const violation: SafetyRuleRow = {
      id: 'uuid-1',
      ingredient: 'retinol',
      contraindication: 'pregnancy',
      severity: 'critical',
      notes: 'Teratogenic',
    };
    mockQuery.mockResolvedValueOnce({ rows: [violation] });

    const result = await repo.findViolations(['retinol'], ['pregnancy']);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(result).toEqual([violation]);
  });
});

describe('SafetyRulesRepository.upsertRule', () => {
  it('inserts a rule and returns the created row', async () => {
    const row: SafetyRuleRow = {
      id: 'uuid-2',
      ingredient: 'fragrance',
      contraindication: 'fragrance_sensitivity',
      severity: 'medium',
    };
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const result = await repo.upsertRule({
      ingredient: 'fragrance',
      contraindication: 'fragrance_sensitivity',
      severity: 'medium',
    });

    expect(result).toEqual(row);
  });
});
