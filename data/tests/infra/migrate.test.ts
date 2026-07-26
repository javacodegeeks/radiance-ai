jest.mock('../../src/infra/db', () => ({
  getDb: jest.fn(),
  closeDb: jest.fn(),
}));

import * as fs from 'fs';
import * as path from 'path';
import { getDb } from '../../src/infra/db';
import { runMigrations } from '../../src/infra/migrate';

// Deliberately reads the real data/migrations/*.sql files rather than mocking
// fs — this keeps the test self-updating (no hardcoded file count/content)
// and only needs the Postgres connection itself mocked out.
describe('runMigrations', () => {
  const mockQuery = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    mockQuery.mockClear();
    (getDb as jest.Mock).mockReturnValue({ query: mockQuery });
  });

  it('applies every .sql file in the migrations directory, in sorted filename order', async () => {
    const migrationsDir = path.join(__dirname, '..', '..', 'migrations');
    const expectedFiles = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    await runMigrations();

    expect(expectedFiles.length).toBeGreaterThan(0);
    expect(mockQuery).toHaveBeenCalledTimes(expectedFiles.length);

    expectedFiles.forEach((file, i) => {
      const expectedSql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      expect(mockQuery).toHaveBeenNthCalledWith(i + 1, expectedSql);
    });
  });
});
