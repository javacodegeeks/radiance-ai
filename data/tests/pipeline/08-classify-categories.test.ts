jest.mock('../../src/infra/mongo', () => ({
  getDb: jest.fn(),
  closeDb: jest.fn(),
}));

import { getDb } from '../../src/infra/mongo';
import { classifyCategories } from '../../pipeline/08-classify-categories';

type FakeDoc = Record<string, unknown>;

function makeCursor(docs: FakeDoc[]) {
  const cursor = {
    batchSize: jest.fn(),
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: async () => (i < docs.length ? { value: docs[i++], done: false } : { value: undefined, done: true }),
      };
    },
  };
  cursor.batchSize.mockReturnValue(cursor);
  return cursor;
}

function makeCollection(docs: FakeDoc[]) {
  const bulkWrite = jest.fn().mockResolvedValue({});
  const find = jest.fn().mockReturnValue(makeCursor(docs));
  const countDocuments = jest.fn().mockResolvedValue(docs.length);
  return { find, bulkWrite, countDocuments };
}

function mockChatResponse(classifications: Array<{ index: number; category: string | null }>): Response {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ classifications }) } }] }),
  } as unknown as Response;
}

describe('classifyCategories', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      LITELLM_BASE_URL: 'http://fake-litellm',
      LITELLM_API_KEY: 'fake-key',
      LLM_MODEL: 'test-model',
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('writes the LLM-assigned category back onto each matching product via bulkWrite', async () => {
    const docs: FakeDoc[] = [
      { _id: 'p1', product_name: 'Gentle Face Wash' },
      { _id: 'p2', product_name: 'Rich Night Cream' },
    ];
    const collection = makeCollection(docs);
    (getDb as jest.Mock).mockResolvedValue({ collection: jest.fn().mockReturnValue(collection) });
    jest.spyOn(global, 'fetch').mockResolvedValue(
      mockChatResponse([{ index: 0, category: 'cleanser' }, { index: 1, category: 'moisturizer' }]),
    );

    await classifyCategories();

    expect(collection.bulkWrite).toHaveBeenCalledWith([
      { updateOne: { filter: { _id: 'p1' }, update: { $set: { category: 'cleanser' } } } },
      { updateOne: { filter: { _id: 'p2' }, update: { $set: { category: 'moisturizer' } } } },
    ]);
  });

  it('leaves out products the LLM classifies as null rather than guessing', async () => {
    const docs: FakeDoc[] = [
      { _id: 'p1', product_name: 'Mystery Serum' },
      { _id: 'p2', product_name: 'Daily SPF 50' },
    ];
    const collection = makeCollection(docs);
    (getDb as jest.Mock).mockResolvedValue({ collection: jest.fn().mockReturnValue(collection) });
    jest.spyOn(global, 'fetch').mockResolvedValue(
      mockChatResponse([{ index: 0, category: null }, { index: 1, category: 'spf' }]),
    );

    await classifyCategories();

    expect(collection.bulkWrite).toHaveBeenCalledWith([
      { updateOne: { filter: { _id: 'p2' }, update: { $set: { category: 'spf' } } } },
    ]);
  });

  it('skips a failed classification chunk without throwing or writing anything', async () => {
    const docs: FakeDoc[] = [{ _id: 'p1', product_name: 'Unclear Product' }];
    const collection = makeCollection(docs);
    (getDb as jest.Mock).mockResolvedValue({ collection: jest.fn().mockReturnValue(collection) });
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as unknown as Response);
    jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(classifyCategories()).resolves.toBeUndefined();

    expect(collection.bulkWrite).not.toHaveBeenCalled();
  });

  it('ignores a classification whose category is not one of the known categories', async () => {
    const docs: FakeDoc[] = [{ _id: 'p1', product_name: 'Odd Product' }];
    const collection = makeCollection(docs);
    (getDb as jest.Mock).mockResolvedValue({ collection: jest.fn().mockReturnValue(collection) });
    jest.spyOn(global, 'fetch').mockResolvedValue(
      mockChatResponse([{ index: 0, category: 'shampoo' }]),
    );

    await classifyCategories();

    expect(collection.bulkWrite).not.toHaveBeenCalled();
  });
});
