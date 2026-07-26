jest.mock('mongodb', () => ({
  MongoClient: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    db: jest.fn().mockReturnValue({ name: 'fake-db' }),
  })),
}));

import { MongoClient } from 'mongodb';
import { getDb, closeDb } from '../../src/infra/mongo';

describe('mongo (MongoClient singleton)', () => {
  afterEach(async () => {
    await closeDb();
    jest.clearAllMocks();
  });

  it('connects once and reuses the same client across calls', async () => {
    await getDb();
    await getDb();

    expect(MongoClient).toHaveBeenCalledTimes(1);
    const instance = (MongoClient as unknown as jest.Mock).mock.results[0].value;
    expect(instance.connect).toHaveBeenCalledTimes(1);
  });

  it('returns the named database from the connected client', async () => {
    const db = await getDb();
    expect(db).toEqual({ name: 'fake-db' });
  });

  it('creates a new client after closeDb() resets the singleton', async () => {
    await getDb();
    await closeDb();
    await getDb();

    expect(MongoClient).toHaveBeenCalledTimes(2);
  });

  it('closeDb() closes the underlying connection', async () => {
    await getDb();
    await closeDb();

    const instance = (MongoClient as unknown as jest.Mock).mock.results[0].value;
    expect(instance.close).toHaveBeenCalledTimes(1);
  });
});
