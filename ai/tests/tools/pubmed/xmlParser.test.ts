import { parseAbstractsXml } from '../../../src/tools/pubmed/xmlParser';

describe('parseAbstractsXml', () => {
  it('parses a single article with a plain-text abstract', () => {
    const xml = `
      <PubmedArticleSet>
        <PubmedArticle>
          <MedlineCitation>
            <PMID>111</PMID>
            <Article>
              <Abstract>
                <AbstractText>Plain abstract text.</AbstractText>
              </Abstract>
              <PublicationTypeList>
                <PublicationType>Journal Article</PublicationType>
              </PublicationTypeList>
            </Article>
          </MedlineCitation>
        </PubmedArticle>
      </PubmedArticleSet>`;

    const [result] = parseAbstractsXml(xml);

    expect(result.pmid).toBe('111');
    expect(result.abstract).toBe('Plain abstract text.');
    expect(result.articleTypes).toEqual(['Journal Article']);
  });

  it('joins multiple labeled AbstractText sections with their labels', () => {
    const xml = `
      <PubmedArticleSet>
        <PubmedArticle>
          <MedlineCitation>
            <PMID>222</PMID>
            <Article>
              <Abstract>
                <AbstractText Label="BACKGROUND">Some background.</AbstractText>
                <AbstractText Label="CONCLUSION">Some conclusion.</AbstractText>
              </Abstract>
            </Article>
          </MedlineCitation>
        </PubmedArticle>
      </PubmedArticleSet>`;

    const [result] = parseAbstractsXml(xml);

    expect(result.abstract).toBe('BACKGROUND: Some background.\nCONCLUSION: Some conclusion.');
  });

  it('handles multiple articles in one response, in document order', () => {
    const xml = `
      <PubmedArticleSet>
        <PubmedArticle>
          <MedlineCitation><PMID>1</PMID></MedlineCitation>
        </PubmedArticle>
        <PubmedArticle>
          <MedlineCitation><PMID>2</PMID></MedlineCitation>
        </PubmedArticle>
      </PubmedArticleSet>`;

    const result = parseAbstractsXml(xml);

    expect(result.map(r => r.pmid)).toEqual(['1', '2']);
  });

  it('defaults to empty abstract/articleTypes when a citation has none', () => {
    const xml = `
      <PubmedArticleSet>
        <PubmedArticle>
          <MedlineCitation><PMID>333</PMID></MedlineCitation>
        </PubmedArticle>
      </PubmedArticleSet>`;

    const [result] = parseAbstractsXml(xml);

    expect(result.abstract).toBe('');
    expect(result.articleTypes).toEqual([]);
  });

  it('returns [] when the response has no PubmedArticle entries', () => {
    const xml = `<PubmedArticleSet></PubmedArticleSet>`;
    expect(parseAbstractsXml(xml)).toEqual([]);
  });

  it('throws a PubMedError with code PARSE_ERROR on malformed input', () => {
    const parser: { parse: (xml: string) => unknown } = require('fast-xml-parser').XMLParser.prototype;
    const spy = jest.spyOn(parser, 'parse').mockImplementation(() => {
      throw new Error('bad xml');
    });

    expect(() => parseAbstractsXml('<not><valid')).toThrow(
      expect.objectContaining({ name: 'PubMedError', code: 'PARSE_ERROR' }),
    );

    spy.mockRestore();
  });
});
