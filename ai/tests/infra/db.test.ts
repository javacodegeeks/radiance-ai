jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    end: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { Pool } from 'pg';
import { getDb, closeDb } from '../../src/infra/db';

describe('db (PostgreSQL pool singleton)', () => {
  afterEach(async () => {
    await closeDb();
    jest.clearAllMocks();
  });

  it('creates a single Pool instance and reuses it across calls', () => {
    const first = getDb();
    const second = getDb();

    expect(first).toBe(second);
    expect(Pool).toHaveBeenCalledTimes(1);
  });

  it('registers an error handler on the pool to avoid unhandled pool errors crashing the process', () => {
    getDb();

    const poolInstance = (Pool as unknown as jest.Mock).mock.results[0].value;
    expect(poolInstance.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('closeDb() ends the underlying pool connection', async () => {
    getDb();
    await closeDb();

    const poolInstance = (Pool as unknown as jest.Mock).mock.results[0].value;
    expect(poolInstance.end).toHaveBeenCalledTimes(1);
  });

  it('creates a fresh Pool after closeDb() resets the singleton', async () => {
    const first = getDb();
    await closeDb();
    const second = getDb();

    expect(Pool).toHaveBeenCalledTimes(2);
    expect(first).not.toBe(second);
  });
});
