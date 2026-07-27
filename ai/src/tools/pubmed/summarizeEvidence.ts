import { z } from 'zod';
import { chatCompletion, LlmMessage, stripJsonFences } from '../../llm/client';
import { EVIDENCE_SUMMARY_SYSTEM } from '../../llm/prompts';
import type { NormalizedArticle } from './types';

const SummarySchema = z.object({
  summaries: z.array(z.object({
    pmid:    z.string(),
    summary: z.string(),
  })),
});

/**
 * Summarize each article's abstract in relation to the search query.
 * Blind truncation (first N characters) frequently cuts off before the
 * abstract reaches its actual findings — leaving only background/objective
 * text, which gives the questioner no real evidence to reason with. This
 * asks the LLM to extract the query-relevant finding instead.
 *
 * Non-fatal: returns an empty map on any failure so the caller can fall
 * back to truncated abstracts.
 */
export async function summarizeArticlesForQuery(
  query: string,
  articles: NormalizedArticle[],
): Promise<Map<string, string>> {
  if (!articles.length) return new Map();

  const articlesText = articles
    .map(a => `PMID ${a.pmid}\nTitle: ${a.title}\nAbstract: ${a.abstract || 'No abstract available'}`)
    .join('\n\n');

  const messages: LlmMessage[] = [
    { role: 'system', content: EVIDENCE_SUMMARY_SYSTEM },
    {
      role: 'user',
      content: `Query: "${query}"\n\nArticles:\n${articlesText}\n\nRespond with the JSON object.`,
    },
  ];

  try {
    console.log('[pubmed] prompt=EVIDENCE_SUMMARY_SYSTEM');
    const raw = await chatCompletion('evidenceSummary', messages);
    const parsed = SummarySchema.parse(JSON.parse(stripJsonFences(raw)));
    return new Map(parsed.summaries.map(s => [s.pmid, s.summary]));
  } catch (err) {
    console.warn('[pubmed] evidence summarization failed — falling back to truncated abstracts', err);
    return new Map();
  }
}
