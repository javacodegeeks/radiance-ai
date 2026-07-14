import type { RawEsummaryDocsum, NormalizedArticle } from './types';

/**
 * Convert a raw esummary document into a partially-populated NormalizedArticle.
 * `abstract` and `articleTypes` are omitted here — they come from efetch and
 * are merged in by the orchestrator (searchClinicalEvidence).
 *
 * @param doc   Raw esummary document for a single article
 * @param rank  0-based position in the esearch result list (lower = more relevant)
 * @param total Total results returned in this batch (used to compute relevanceScore)
 */
export function normalizeMetadata(
  doc: RawEsummaryDocsum,
  rank = 0,
  total = 1,
): Omit<NormalizedArticle, 'abstract' | 'articleTypes'> {
  const doi = doc.articleids?.find(a => a.idtype === 'doi')?.value ?? null;

  // Cap authors at 5 to keep downstream context manageable; LLMs don't need full author lists
  const authors = (doc.authors ?? [])
    .filter(a => a.authtype === 'Author')
    .map(a => a.name)
    .slice(0, 5);

  // Strip residual HTML entities that PubMed sometimes includes in titles
  const title = (doc.title ?? 'No title').replace(/&lt;[^>]+&gt;/g, '').trim();

  // Position 0 → score 1.0; last position → approaches 0 (never goes negative)
  const relevanceScore = total <= 1 ? 1 : Math.max(0, 1 - rank / total);

  return {
    pmid:            doc.uid,
    title,
    authors,
    journal:         doc.fulljournalname ?? doc.source ?? 'Unknown journal',
    publicationDate: doc.pubdate ?? doc.epubdate ?? 'Unknown date',
    doi,
    relevanceScore,
  };
}
