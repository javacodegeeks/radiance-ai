import { z } from 'zod';
import { chatCompletion, LlmMessage, stripJsonFences } from '../llm/client';
import { RECOMMENDER_SYSTEM } from '../llm/prompts';
import { LlmCallError, SchemaParseError } from '../common/errors';
import { GraphStateType } from '../graph/state';
import { ExcludedRecommendation, ProductCategory, RecommendedProduct, Routine } from '../types';

const MAX_RECOMMENDATIONS = 5;

/**
 * Category-aware selection tries to guarantee routine coverage (a routine
 * with five serums and no cleanser is useless) — see
 * docs/specs/routine-generation-feature.md blocker #3. Only meaningful once
 * products carry a precomputed `category` (data/pipeline/08-classify-categories.ts);
 * products with no category just fall back to plain score order.
 */
const REQUIRED_CATEGORIES: ProductCategory[] = ['cleanser', 'moisturizer'];

const EMPTY_ROUTINE: Routine = { am: [], pm: [], interactionWarnings: [] };

// ─── Structured output schema ─────────────────────────────────────────────────

const ProductExplanationSchema = z.object({
  name:             z.string(),
  relevanceToQuery: z.string(),
  reasoning:        z.string(),
  usageTips:        z.array(z.string()),
  safetyNotes:      z.string().optional(),
  confidence:       z.number().min(0).max(100).optional(),
});

const RoutineSchema = z.object({
  am:                  z.array(z.string()),
  pm:                  z.array(z.string()),
  interactionWarnings: z.array(z.string()),
});

const RecommenderOutputSchema = z.object({
  recommendations: z.array(ProductExplanationSchema),
  excludedProducts: z.array(z.object({
    name:   z.string(),
    reason: z.string(),
  })).optional(),
  routine: RoutineSchema.optional(),
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

/**
 * Picks the best-ranked product per required category first (if one exists
 * among the candidates), then fills remaining slots by score. `ranked` must
 * already be sorted best-first (i.e. the output of rank()).
 */
function selectCategoryAware(ranked: RecommendedProduct[], max: number): RecommendedProduct[] {
  const picked: RecommendedProduct[] = [];
  const pickedNames = new Set<string>();

  for (const category of REQUIRED_CATEGORIES) {
    const best = ranked.find(p => p.category === category && !pickedNames.has(p.name));
    if (best) {
      picked.push(best);
      pickedNames.add(best.name);
    }
  }

  for (const p of ranked) {
    if (picked.length >= max) break;
    if (!pickedNames.has(p.name)) {
      picked.push(p);
      pickedNames.add(p.name);
    }
  }

  return picked.slice(0, max);
}

function reorderByConfidence(products: RecommendedProduct[]): RecommendedProduct[] {
  return [...products].sort((a, b) => {
    const safetyDiff = SAFETY_WEIGHT[b.safetyStatus] - SAFETY_WEIGHT[a.safetyStatus];
    if (safetyDiff !== 0) return safetyDiff;
    return (b.confidence ?? b.relevanceScore * 100) - (a.confidence ?? a.relevanceScore * 100);
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
  const top      = selectCategoryAware(safe, MAX_RECOMMENDATIONS);
  const excluded = ranked.filter(p => p.safetyStatus === 'unsafe');

  console.log(`[recommender] ranked=${ranked.length} safe=${safe.length} top=${top.length} excluded=${excluded.length}`);

  const withNotes = top.map(p => ({
    ...p,
    availabilityNotes: buildAvailabilityNote(p, userProfile.country),
  }));

  try {
    const { explained, excludedProducts, routine } = await enrichWithLlm(withNotes, excluded, state);
    const reordered = reorderByConfidence(explained);
    console.log(`[recommender] generated ${reordered.length} recommendation(s), ${excludedProducts.length} excluded`);
    return { finalRecommendations: reordered, excludedRecommendations: excludedProducts, routine, currentStep: 'done' };
  } catch (err) {
    const label = err instanceof LlmCallError    ? 'LLM API call failed'
                : err instanceof SchemaParseError ? 'Response schema invalid'
                : 'Unexpected error';
    console.error(`[recommender] ${label} — using unenriched results`, err);
    const fallbackExcluded = excluded.map(p => ({ name: p.name, reason: p.safetyNotes ?? 'unsafe' }));
    return { finalRecommendations: withNotes, excludedRecommendations: fallbackExcluded, routine: EMPTY_ROUTINE, currentStep: 'done' };
  }
}

// ─── LLM enrichment ───────────────────────────────────────────────────────────

async function enrichWithLlm(
  top: RecommendedProduct[],
  excluded: RecommendedProduct[],
  state: GraphStateType,
): Promise<{ explained: RecommendedProduct[]; excludedProducts: ExcludedRecommendation[]; routine: Routine }> {
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
    `${i + 1}. "${p.name}" by ${p.brand} — category: ${p.category ?? 'unclassified'} — safety: ${p.safetyStatus}` +
    (p.safetyNotes ? ` (${p.safetyNotes})` : '') +
    `. Ingredients: ${p.inci.slice(0, 10).join(', ') || 'unknown'}.`,
  ).join('\n');

  const excludedList = excluded.length
    ? excluded.map(p => `"${p.name}" — ${p.safetyNotes ?? 'unsafe'}`).join('\n')
    : '(none)';

  // console.log('[recommender] prompt=RECOMMENDER_SYSTEM');
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
    return {
      explained: mergeExplanations(top, output),
      excludedProducts: output.excludedProducts ?? [],
      routine: output.routine ?? EMPTY_ROUTINE,
    };
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
      ...(exp.confidence !== undefined && { confidence: exp.confidence }),
    };
  });
}
