// Keep the LLM-cache file I/O out of tests entirely — the module reads/writes
// data/.cache/llm-country-cache.json as a side effect of resolving unrecognized
// names, and we don't want test runs touching the real filesystem.
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

import { normalizeCountries } from '../../src/common/countryNormalizer';

describe('normalizeCountries', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.LITELLM_BASE_URL;
    delete process.env.LITELLM_API_KEY;
    delete process.env.LLM_MODEL;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns [] for null, undefined, or empty input', async () => {
    expect(await normalizeCountries(null)).toEqual([]);
    expect(await normalizeCountries(undefined)).toEqual([]);
    expect(await normalizeCountries('')).toEqual([]);
  });

  it('resolves a plain country name to its ISO code', async () => {
    expect(await normalizeCountries('Switzerland')).toEqual(['CH']);
  });

  it('resolves a 2-letter country code case-insensitively', async () => {
    expect(await normalizeCountries('fr')).toEqual(['FR']);
    expect(await normalizeCountries('US')).toEqual(['US']);
  });

  it('resolves multiple comma-separated countries, deduped and sorted', async () => {
    expect(await normalizeCountries('Switzerland,United States')).toEqual(['CH', 'US']);
    expect(await normalizeCountries('France,France,FR')).toEqual(['FR']);
  });

  it('strips a language prefix before lookup', async () => {
    expect(await normalizeCountries('en:Morocco')).toEqual(['MA']);
  });

  it('expands a continent name to all of its country codes', async () => {
    const result = await normalizeCountries('South America');
    expect(result).toContain('BR');
    expect(result).toContain('AR');
    expect(result.length).toBeGreaterThan(5);
  });

  it('treats "World"/"worldwide"/"monde"/"all" as every known country code', async () => {
    const world = await normalizeCountries('World');
    expect(world.length).toBeGreaterThan(100);
    expect(await normalizeCountries('worldwide')).toEqual(world);
    expect(await normalizeCountries('monde')).toEqual(world);
    expect(await normalizeCountries('all')).toEqual(world);
  });

  it('treats "EU"/"European Union" as an alias for Europe', async () => {
    expect(await normalizeCountries('EU')).toEqual(await normalizeCountries('Europe'));
    expect(await normalizeCountries('European Union')).toEqual(await normalizeCountries('Europe'));
  });

  it('accepts an array of country strings as well as a comma-separated string', async () => {
    expect(await normalizeCountries(['France', 'en:Morocco'])).toEqual(['FR', 'MA']);
  });

  it('handles mixed comma-separated names, codes, and continents in one entry', async () => {
    expect(await normalizeCountries('France, en:morocco, FR')).toEqual(['FR', 'MA']);
  });

  describe('LLM fallback for unrecognized names', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('does not call the LLM when it is not configured (missing env vars)', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch');

      const result = await normalizeCountries('Not-A-Real-Place-Unconfigured');

      expect(result).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('resolves an unrecognized name via the LLM when it returns a confident code', async () => {
      process.env.LITELLM_BASE_URL = 'http://fake-litellm';
      process.env.LITELLM_API_KEY = 'fake-key';
      process.env.LLM_MODEL = 'fake-model';

      const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'CH' } }] }),
      } as unknown as Response);

      const result = await normalizeCountries('Helvetia-Unique-1');

      expect(result).toEqual(['CH']);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('caches a confident result so a repeated lookup of the same name does not call the LLM again', async () => {
      process.env.LITELLM_BASE_URL = 'http://fake-litellm';
      process.env.LITELLM_API_KEY = 'fake-key';
      process.env.LLM_MODEL = 'fake-model';

      const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'JP' } }] }),
      } as unknown as Response);

      await normalizeCountries('Nippon-Unique-2');
      const second = await normalizeCountries('Nippon-Unique-2');

      expect(second).toEqual(['JP']);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('caches an explicit UNKNOWN result too, so a repeat lookup skips the LLM', async () => {
      process.env.LITELLM_BASE_URL = 'http://fake-litellm';
      process.env.LITELLM_API_KEY = 'fake-key';
      process.env.LLM_MODEL = 'fake-model';

      const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'UNKNOWN' } }] }),
      } as unknown as Response);

      const first = await normalizeCountries('Totally-Made-Up-Place-Unique-3');
      const second = await normalizeCountries('Totally-Made-Up-Place-Unique-3');

      expect(first).toEqual([]);
      expect(second).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does NOT cache a transient failure (non-2xx response), so the next call retries the LLM', async () => {
      process.env.LITELLM_BASE_URL = 'http://fake-litellm';
      process.env.LITELLM_API_KEY = 'fake-key';
      process.env.LLM_MODEL = 'fake-model';

      const fetchMock = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({ ok: false, status: 500 } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ choices: [{ message: { content: 'DE' } }] }),
        } as unknown as Response);

      const first = await normalizeCountries('Deutschland-Retry-Unique-4');
      const second = await normalizeCountries('Deutschland-Retry-Unique-4');

      expect(first).toEqual([]);
      expect(second).toEqual(['DE']);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does NOT cache a network error, so the next call retries the LLM', async () => {
      process.env.LITELLM_BASE_URL = 'http://fake-litellm';
      process.env.LITELLM_API_KEY = 'fake-key';
      process.env.LLM_MODEL = 'fake-model';

      const fetchMock = jest.spyOn(global, 'fetch')
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ choices: [{ message: { content: 'IT' } }] }),
        } as unknown as Response);

      const first = await normalizeCountries('Italia-Retry-Unique-5');
      const second = await normalizeCountries('Italia-Retry-Unique-5');

      expect(first).toEqual([]);
      expect(second).toEqual(['IT']);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('de-dupes concurrent lookups for the same unresolved name into a single LLM call', async () => {
      process.env.LITELLM_BASE_URL = 'http://fake-litellm';
      process.env.LITELLM_API_KEY = 'fake-key';
      process.env.LLM_MODEL = 'fake-model';

      const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'PT' } }] }),
      } as unknown as Response);

      const [a, b] = await Promise.all([
        normalizeCountries('Concurrent-Lookup-Unique-6'),
        normalizeCountries('Concurrent-Lookup-Unique-6'),
      ]);

      expect(a).toEqual(['PT']);
      expect(b).toEqual(['PT']);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
