import { normalizeMetadata } from '../../../src/tools/pubmed/normalizer';
import type { RawEsummaryDocsum } from '../../../src/tools/pubmed/types';

describe('normalizeMetadata', () => {
  const baseDoc: RawEsummaryDocsum = {
    uid: '12345',
    title: 'A study on retinol',
    fulljournalname: 'Journal of Dermatology',
    pubdate: '2020 Jan',
    authors: [
      { name: 'Smith J', authtype: 'Author' },
      { name: 'Doe A', authtype: 'Author' },
    ],
    articleids: [{ idtype: 'doi', idtypen: 1, value: '10.1234/abc' }],
  };

  it('maps core fields from the raw esummary doc', () => {
    const result = normalizeMetadata(baseDoc);

    expect(result.pmid).toBe('12345');
    expect(result.title).toBe('A study on retinol');
    expect(result.journal).toBe('Journal of Dermatology');
    expect(result.publicationDate).toBe('2020 Jan');
    expect(result.doi).toBe('10.1234/abc');
    expect(result.authors).toEqual(['Smith J', 'Doe A']);
  });

  it('defaults doi to null when no doi article ID is present', () => {
    const result = normalizeMetadata({ ...baseDoc, articleids: [] });
    expect(result.doi).toBeNull();
  });

  it('defaults title to "No title" when missing, and strips HTML entities', () => {
    const result = normalizeMetadata({ ...baseDoc, title: '&lt;b&gt;Bold text' });
    expect(result.title).toBe('Bold text');

    const withoutTitle = normalizeMetadata({ ...baseDoc, title: undefined });
    expect(withoutTitle.title).toBe('No title');
  });

  it('falls back to source, then "Unknown journal", when fulljournalname is missing', () => {
    const withSource = normalizeMetadata({ ...baseDoc, fulljournalname: undefined, source: 'J Derm' });
    expect(withSource.journal).toBe('J Derm');

    const withNeither = normalizeMetadata({ ...baseDoc, fulljournalname: undefined, source: undefined });
    expect(withNeither.journal).toBe('Unknown journal');
  });

  it('falls back to epubdate, then "Unknown date", when pubdate is missing', () => {
    const withEpub = normalizeMetadata({ ...baseDoc, pubdate: undefined, epubdate: '2021-05-01' });
    expect(withEpub.publicationDate).toBe('2021-05-01');

    const withNeither = normalizeMetadata({ ...baseDoc, pubdate: undefined, epubdate: undefined });
    expect(withNeither.publicationDate).toBe('Unknown date');
  });

  it('filters out non-Author entries and caps authors at 5', () => {
    const manyAuthors = Array.from({ length: 7 }, (_, i) => ({ name: `Author ${i}`, authtype: 'Author' }));
    const result = normalizeMetadata({
      ...baseDoc,
      authors: [...manyAuthors, { name: 'Some Group', authtype: 'CollectiveName' }],
    });

    expect(result.authors).toHaveLength(5);
    expect(result.authors).not.toContain('Some Group');
  });

  it('scores relevance 1.0 for a single result, and decreasing scores by rank otherwise', () => {
    expect(normalizeMetadata(baseDoc, 0, 1).relevanceScore).toBe(1);
    expect(normalizeMetadata(baseDoc, 0, 10).relevanceScore).toBe(1);
    expect(normalizeMetadata(baseDoc, 5, 10).relevanceScore).toBe(0.5);
    expect(normalizeMetadata(baseDoc, 9, 10).relevanceScore).toBeCloseTo(0.1);
  });
});
