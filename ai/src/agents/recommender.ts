import { z } from 'zod';
import { chatCompletion, LlmMessage, stripJsonFences } from '../llm/client';
import { RECOMMENDER_SYSTEM } from '../llm/prompts';
import { LlmCallError, SchemaParseError } from '../common/errors';
import { GraphStateType } from '../graph/state';
import { RecommendedProduct } from '../types';

const MAX_RECOMMENDATIONS = 5;

// ─── Structured output schema ─────────────────────────────────────────────────

const ProductExplanationSchema = z.object({
  name:             z.string(),
  relevanceToQuery: z.string(),
  reasoning:        z.string(),
  usageTips:        z.array(z.string()),
  safetyNotes:      z.string().optional(),
});

const RecommenderOutputSchema = z.object({
  recommendations: z.array(ProductExplanationSchema),
  excludedProducts: z.array(z.object({
    name:   z.string(),
    reason: z.string(),
  })).optional(),
});

type RecommenderOutput = z.infer<typeof RecommenderOutputSchema>;

// ─── Scoring ──────────────────────────────────────────────────────────────────

const SAFETY_WEIGHT: Record<RecommendedProduct['safetyStatus'], number> = {
  safe:    1.0,
  caution: 0.5,
  unsafe:  0.0,
};

function rank(products: RecommendedProduct[]): RecommendedProduct[] {
  return [...products].sort((a, b) => {
    const scoreA = SAFETY_WEIGHT[a.safetyStatus] * 0.6 + a.relevanceScore * 0.4;
    const scoreB = SAFETY_WEIGHT[b.safetyStatus] * 0.6 + b.relevanceScore * 0.4;
    return scoreB - scoreA;
  });
}

function buildAvailabilityNote(product: RecommendedProduct, country?: string): string {
  if (!country) return '';
  if (product.countryAvailability.includes(country)) return `Available in ${country}.`;
  if (product.sourceUrl) return `Check availability: ${product.sourceUrl}`;
  return 'Availability unconfirmed — check local retailers.';
}

// ─── Agent ────────────────────────────────────────────────────────────────────

/**
 * Recommender agent.
 * Ranks safety-checked products, then uses an LLM to generate a natural-
 * language explanation (relevanceToQuery, reasoning, usageTips) for each of
 * the top N products. Falls back to score-based ranking without explanations
 * if the LLM call fails.
 */
export async function recommenderAgent(
  state: GraphStateType,
): Promise<Partial<GraphStateType>> {
  const { safetyCheckedProducts, userProfile } = state;

  const ranked   = rank(safetyCheckedProducts);
  const safe     = ranked.filter(p => p.safetyStatus !== 'unsafe');
  const top      = safe.slice(0, MAX_RECOMMENDATIONS);
  const excluded = ranked.filter(p => p.safetyStatus === 'unsafe');

  console.log(`[recommender] ranked=${ranked.length} safe=${safe.length} top=${top.length} excluded=${excluded.length}`);

  const withNotes = top.map(p => ({
    ...p,
    availabilityNotes: buildAvailabilityNote(p, userProfile.country),
  }));

  try {
    const explained = await enrichWithLlm(withNotes, excluded, state);
    console.log(`[recommender] generated ${explained.length} recommendation(s)`);
    return { finalRecommendations: explained, currentStep: 'done' };
  } catch (err) {
    const label = err instanceof LlmCallError    ? 'LLM API call failed'
                : err instanceof SchemaParseError ? 'Response schema invalid'
                : 'Unexpected error';
    console.error(`[recommender] ${label} — using unenriched results`, err);
    return { finalRecommendations: withNotes, currentStep: 'done' };
  }
}

// ─── LLM enrichment ───────────────────────────────────────────────────────────

async function enrichWithLlm(
  top: RecommendedProduct[],
  excluded: RecommendedProduct[],
  state: GraphStateType,
): Promise<RecommendedProduct[]> {
  const { userQuery, queryContext, userProfile } = state;

  const issue = queryContext.refinedIssue ?? userQuery;
  const goals = (queryContext.goals ?? []).join(', ') || 'not specified';

  const profileSummary = JSON.stringify({
    country:    userProfile.country,
    skinType:   userProfile.skinType,
    allergies:  userProfile.allergies,
    conditions: userProfile.conditions,
  });

  const productList = top.map((p, i) =>
    `${i + 1}. "${p.name}" by ${p.brand} — safety: ${p.safetyStatus}` +
    (p.safetyNotes ? ` (${p.safetyNotes})` : '') +
    `. Ingredients: ${p.inci.slice(0, 10).join(', ') || 'unknown'}.`,
  ).join('\n');

  const excludedList = excluded.length
    ? excluded.map(p => `"${p.name}" — ${p.safetyNotes ?? 'unsafe'}`).join('\n')
    : '(none)';

  console.log('[recommender] prompt=RECOMMENDER_SYSTEM');
  const userPrompt = `User's concern: "${issue}"
Goals: ${goals}
User profile: ${profileSummary}

Recommended products (in order):
${productList}

Excluded products (unsafe):
${excludedList}

Write personalised explanations for each recommended product.`;

  const messages: LlmMessage[] = [
    { role: 'system', content: RECOMMENDER_SYSTEM },
    { role: 'user',   content: userPrompt },
  ];

  let raw: string;
  try {
    raw = await chatCompletion('recommender', messages);
  } catch (err) {
    throw new LlmCallError('recommender', 'LLM API call failed', err);
  }

  try {
    const output: RecommenderOutput = RecommenderOutputSchema.parse(JSON.parse(stripJsonFences(raw)));
    return mergeExplanations(top, output);
  } catch (err) {
    throw new SchemaParseError('recommender', 'LLM response failed schema validation', err);
  }
}

// ─── Merge helper ─────────────────────────────────────────────────────────────

function mergeExplanations(
  products: RecommendedProduct[],
  output: RecommenderOutput,
): RecommendedProduct[] {
  const byName = new Map(output.recommendations.map(r => [r.name, r]));

  return products.map(p => {
    const exp = byName.get(p.name);
    if (!exp) return p;
    return {
      ...p,
      relevanceToQuery: exp.relevanceToQuery,
      reasoning:        exp.reasoning,
      usageTips:        exp.usageTips,
      ...(exp.safetyNotes !== undefined && { safetyNotes: exp.safetyNotes }),
    };
  });
}
