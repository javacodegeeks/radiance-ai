// qdrant.ts creates `export const qdrant = new QdrantClient(...)` as a
// module-level side effect. The real client kicks off an async server
// compatibility check on construction, which — with no real Qdrant running —
// logs a warning after this test file has already finished (Jest then
// reports "Cannot log after tests are done"). Mock it out: these tests only
// exercise generateEmbedding(), which talks to LiteLLM via fetch, not `qdrant`.
jest.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: jest.fn().mockImplementation(() => ({})),
}));

import { generateEmbedding } from '../../src/infra/qdrant';

describe('generateEmbedding', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      EMBEDDING_MODEL: 'test-embedding-model',
      LITELLM_BASE_URL: 'http://fake-litellm',
      LITELLM_API_KEY: 'fake-key',
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns the embedding vector from a successful response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    } as unknown as Response);

    const result = await generateEmbedding('dry skin');

    expect(result).toEqual([0.1, 0.2, 0.3]);
  });

  it('POSTs the model, input text, and bearer auth header to the LiteLLM embeddings endpoint', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [1] }] }),
    } as unknown as Response);

    await generateEmbedding('redness');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://fake-litellm/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer fake-key',
        }),
        body: JSON.stringify({ model: 'test-embedding-model', input: 'redness' }),
      }),
    );
  });

  it('throws a descriptive error when the request fails', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as unknown as Response);

    await expect(generateEmbedding('acne')).rejects.toThrow(
      'Embedding request failed: 500 Internal Server Error',
    );
  });
});
