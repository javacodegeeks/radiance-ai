import { z } from 'zod';
import { chatCompletion, LlmMessage, stripJsonFences } from '../llm/client';
import { RECOMMENDER_SYSTEM, RECOMMENDER_COMPLEMENTARY_SYSTEM } from '../llm/prompts';
import { LlmCallError, SchemaParseError } from '../common/errors';
import { GraphStateType } from '../graph/state';
import { COSING_FUNCTION_NAMES, findIngredientsByFunction } from '../repositories/cosingFunctionsRepository';
import { generateEmbedding } from '../llm/embeddings';
import { findSimilarProducts } from '../repositories/productRepository';
import { checkProductSafety } from './safetyChecker';
import { ComplementaryRecommendation, ExcludedRecommendation, ProductCategory, RecommendedProduct, Routine, SideEffectRisk, UserProfile } from '../types';

const MAX_RECOMMENDATIONS = 5;

/**
 * How many fresh catalog candidates to pull for the second-pass complementary
 * search (see findSecondPassCandidate) — kept small since this runs a real
 * embedding + Qdrant + Mongo round trip and we only need the first candidate
 * that actually carries the counteracting ingredient.
 */
const SECOND_PASS_LIMIT = 5;

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

// counteractingFunction is deliberately z.string(), not z.enum(COSING_FUNCTION_NAMES):
// sideEffectRisks is a best-effort, non-blocking side feature riding inside the
// same parse() as recommendations/routine/excludedProducts — an enum here would
// make one bad function name (case drift, a near-duplicate like "SKIN
// CONDITIONING - MISCELLANEOUS") throw and lose the whole recommendation.
// Closed-list membership is checked per-risk in resolveComplementaryProducts
// instead, so an unrecognized value just skips that one risk.
const SideEffectRiskSchema = z.object({
  productName:           z.string(),
  risk:                  z.string(),
  counteractingFunction: z.string(),
});

const COSING_FUNCTION_SET = new Set<string>(COSING_FUNCTION_NAMES);

const RecommenderOutputSchema = z.object({
  recommendations: z.array(ProductExplanationSchema),
  excludedProducts: z.array(z.object({
    name:   z.string(),
    reason: z.string(),
  })).optional(),
  routine: RoutineSchema.optional(),
  sideEffectRisks: z.array(SideEffectRiskSchema).optional(),
});

type RecommenderOutput = z.infer<typeof RecommenderOutputSchema>;

const ComplementaryOutputSchema = z.object({
  explanations: z.array(z.object({
    productName: z.string(),
    explanation: z.string(),
  })),
  routine: RoutineSchema,
});

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
    const { explained, excludedProducts, routine, complementary } = await enrichWithLlm(withNotes, excluded, state);
    const reordered = reorderByConfidence(explained);
    console.log(`[recommender] generated ${reordered.length} recommendation(s), ${excludedProducts.length} excluded, ${complementary.length} complementary`);
    return {
      finalRecommendations: reordered,
      excludedRecommendations: excludedProducts,
      routine,
      complementaryRecommendations: complementary,
      currentStep: 'done',
    };
  } catch (err) {
    const label = err instanceof LlmCallError    ? 'LLM API call failed'
                : err instanceof SchemaParseError ? 'Response schema invalid'
                : 'Unexpected error';
    console.error(`[recommender] ${label} — using unenriched results`, err);
    const fallbackExcluded = excluded.map(p => ({ name: p.name, reason: p.safetyNotes ?? 'unsafe' }));
    return {
      finalRecommendations: withNotes,
      excludedRecommendations: fallbackExcluded,
      routine: EMPTY_ROUTINE,
      complementaryRecommendations: [],
      currentStep: 'done',
    };
  }
}

// ─── LLM enrichment ───────────────────────────────────────────────────────────

async function enrichWithLlm(
  top: RecommendedProduct[],
  excluded: RecommendedProduct[],
  state: GraphStateType,
): Promise<{
  explained: RecommendedProduct[];
  excludedProducts: ExcludedRecommendation[];
  routine: Routine;
  complementary: ComplementaryRecommendation[];
}> {
  const { userQuery, queryContext, userProfile, safetyCheckedProducts } = state;

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

  let output: RecommenderOutput;
  try {
    output = RecommenderOutputSchema.parse(JSON.parse(stripJsonFences(raw)));
  } catch (err) {
    throw new SchemaParseError('recommender', 'LLM response failed schema validation', err);
  }

  const explained = mergeExplanations(top, output);
  const baseRoutine = output.routine ?? EMPTY_ROUTINE;

  const { explained: withRisks, complementary, routine } = await applySideEffectRisks(
    explained,
    output.sideEffectRisks ?? [],
    safetyCheckedProducts,
    baseRoutine,
    userProfile,
  );

  return {
    explained: withRisks,
    excludedProducts: output.excludedProducts ?? [],
    routine,
    complementary,
  };
}

// ─── Side-effect risk / complementary product resolution ──────────────────────

/**
 * Non-blocking: the flagged product itself is never dropped or reordered
 * because of a side-effect risk. For each LLM-flagged risk, tries to resolve
 * a real, already safety-checked product from the candidate pool that
 * carries the CosIng function needed to counteract it, then asks the LLM
 * (one batched call) to explain the fit and rebuild the routine around it.
 * Any lookup/LLM failure along the way just leaves the risk noted with no
 * complementary product — never blocks the primary recommendation flow.
 */
async function applySideEffectRisks(
  explained: RecommendedProduct[],
  risks: SideEffectRisk[],
  pool: RecommendedProduct[],
  baseRoutine: Routine,
  userProfile: UserProfile,
): Promise<{ explained: RecommendedProduct[]; complementary: ComplementaryRecommendation[]; routine: Routine }> {
  if (!risks.length) {
    return { explained, complementary: [], routine: baseRoutine };
  }

  const recommendedNames = new Set(explained.map(p => p.name));

  // Note the risk on its product regardless of whether a complementary
  // product can be resolved for it — informational either way.
  const withRiskNotes = explained.map(p => {
    const risk = risks.find(r => r.productName === p.name);
    return risk ? { ...p, sideEffectRisk: risk.risk } : p;
  });

  const resolved = await resolveComplementaryProducts(risks, recommendedNames, pool, userProfile);
  if (!resolved.length) {
    return { explained: withRiskNotes, complementary: [], routine: baseRoutine };
  }

  try {
    const { complementary, routine } = await buildComplementaryRoutine(resolved, baseRoutine);
    return { explained: withRiskNotes, complementary, routine };
  } catch (err) {
    console.warn('[recommender] complementary routine LLM call failed — showing side-effect risk without a complementary product', err);
    return { explained: withRiskNotes, complementary: [], routine: baseRoutine };
  }
}

/**
 * Grounds each flagged risk in real catalog data: looks up which real
 * ingredients carry the counteracting CosIng function, then finds a product
 * whose ingredient list contains one of them — never one already
 * recommended, and never a candidate that fails a safety check. Skips a risk
 * if the LLM named a product not actually in this recommendation set
 * (hallucination guard), or if no real candidate is found anywhere — never
 * invents a product.
 *
 * Checks the already safety-checked `pool` first (cheap — no extra
 * network/DB round trip), but a side-effect risk is often unrelated to the
 * user's original concern (e.g. a hair-loss product causing dizziness/nausea
 * — dizziness/nausea was never part of the search that built `pool`), so
 * that pool has little chance of containing a real counteracting product.
 * Falls back to findSecondPassCandidate, a fresh catalog search targeted at
 * the counteracting ingredients themselves, safety-checked before being
 * accepted.
 */
async function resolveComplementaryProducts(
  risks: SideEffectRisk[],
  recommendedNames: Set<string>,
  pool: RecommendedProduct[],
  userProfile: UserProfile,
): Promise<Array<{ risk: SideEffectRisk; candidate: RecommendedProduct }>> {
  const resolved: Array<{ risk: SideEffectRisk; candidate: RecommendedProduct }> = [];
  const usedCandidates = new Set<string>();

  for (const risk of risks) {
    if (!recommendedNames.has(risk.productName)) continue;

    if (!COSING_FUNCTION_SET.has(risk.counteractingFunction)) {
      console.warn(`[recommender] LLM returned an unrecognized counteractingFunction "${risk.counteractingFunction}" — skipping this risk`);
      continue;
    }

    let counteractingIngredients: string[];
    try {
      counteractingIngredients = await findIngredientsByFunction([risk.counteractingFunction]);
    } catch (err) {
      console.warn(`[recommender] CosIng function lookup failed for "${risk.counteractingFunction}" — skipping this risk`, err);
      continue;
    }
    if (!counteractingIngredients.length) continue;

    const normalizedTargets = new Set(counteractingIngredients.map(i => i.toLowerCase()));
    const isEligible = (p: RecommendedProduct) =>
      p.safetyStatus !== 'unsafe' &&
      !isExcludedCandidate(p.name, recommendedNames, usedCandidates) &&
      hasCounteractingIngredient(p.inci, normalizedTargets);

    const candidate = pool.find(isEligible)
      ?? await findSecondPassCandidate(risk, counteractingIngredients, normalizedTargets, recommendedNames, usedCandidates, userProfile);

    if (candidate) {
      resolved.push({ risk, candidate });
      usedCandidates.add(candidate.name);
    }
  }

  return resolved;
}

/** Shared by the pool search and the second-pass search below, so eligibility can't drift between the two. */
function hasCounteractingIngredient(inci: string[], normalizedTargets: Set<string>): boolean {
  return inci.some(ing => normalizedTargets.has(ing.toLowerCase()));
}

/** Shared by the pool search and the second-pass search below, so eligibility can't drift between the two. */
function isExcludedCandidate(name: string, recommendedNames: Set<string>, usedCandidates: Set<string>): boolean {
  return recommendedNames.has(name) || usedCandidates.has(name);
}

/**
 * Second-pass search for a complementary product outside the pool already
 * evaluated for the user's primary concern (see resolveComplementaryProducts
 * above for why that pool is usually the wrong place to look). Runs a fresh
 * embedding search targeted at the counteracting ingredients/risk itself,
 * then safety-checks each hit (Layer 1 only, via checkProductSafety) before
 * it can be accepted — a fresh product must clear safety just like the
 * primary pool did, it just wasn't part of the original catalog search.
 * Any failure here (embedding/search/safety-check) just leaves the risk
 * without a complementary product — never blocks the primary flow.
 */
async function findSecondPassCandidate(
  risk: SideEffectRisk,
  counteractingIngredients: string[],
  normalizedTargets: Set<string>,
  recommendedNames: Set<string>,
  usedCandidates: Set<string>,
  userProfile: UserProfile,
): Promise<RecommendedProduct | undefined> {
  try {
    const query = `parapharmaceutical product to counteract "${risk.risk}" — active ingredients: ${counteractingIngredients.slice(0, 10).join(', ')}`;
    const embedding = await generateEmbedding(query);
    const candidates = await findSimilarProducts(embedding, SECOND_PASS_LIMIT, userProfile.country);

    const userConditions = [...(userProfile.allergies ?? []), ...(userProfile.conditions ?? [])];

    for (const product of candidates) {
      if (isExcludedCandidate(product.name, recommendedNames, usedCandidates)) continue;
      if (!hasCounteractingIngredient(product.inci, normalizedTargets)) continue;

      const checked = await checkProductSafety(product, userConditions);
      if (checked.safetyStatus === 'unsafe') continue;
      return checked;
    }
  } catch (err) {
    console.warn(`[recommender] second-pass complementary search failed for "${risk.counteractingFunction}" — leaving risk without a complementary product`, err);
  }
  return undefined;
}

/**
 * Single batched LLM call (not one per candidate) — asks the model to
 * explain each algorithmically-resolved complementary product's fit and
 * rebuild the FULL routine around it, mirroring the Layer 2 batching
 * pattern in agents/safetyChecker.ts.
 */
async function buildComplementaryRoutine(
  resolved: Array<{ risk: SideEffectRisk; candidate: RecommendedProduct }>,
  currentRoutine: Routine,
): Promise<{ complementary: ComplementaryRecommendation[]; routine: Routine }> {
  const candidateList = resolved.map((r, i) =>
    `${i + 1}. For "${r.risk.productName}" (risk: ${r.risk.risk}) — complementary candidate: "${r.candidate.name}" by ${r.candidate.brand}, category: ${r.candidate.category ?? 'unclassified'}, matched function: ${r.risk.counteractingFunction}. Ingredients: ${r.candidate.inci.slice(0, 10).join(', ') || 'unknown'}.`,
  ).join('\n');

  const userPrompt = `Current routine:
${JSON.stringify(currentRoutine)}

Complementary product candidates to incorporate:
${candidateList}

For each candidate, write a fit explanation, then return one fully rebuilt routine incorporating both the existing products and every complementary candidate.`;

  const messages: LlmMessage[] = [
    { role: 'system', content: RECOMMENDER_COMPLEMENTARY_SYSTEM },
    { role: 'user',   content: userPrompt },
  ];

  let raw: string;
  try {
    raw = await chatCompletion('recommenderComplementary', messages);
  } catch (err) {
    throw new LlmCallError('recommender', 'Complementary LLM API call failed', err);
  }

  let output: z.infer<typeof ComplementaryOutputSchema>;
  try {
    output = ComplementaryOutputSchema.parse(JSON.parse(stripJsonFences(raw)));
  } catch (err) {
    throw new SchemaParseError('recommender', 'Complementary LLM response failed schema validation', err);
  }

  const explanationByName = new Map(output.explanations.map(e => [e.productName, e.explanation]));
  const complementary: ComplementaryRecommendation[] = resolved.map(r => ({
    forProduct:      r.risk.productName,
    risk:            r.risk.risk,
    matchedFunction: r.risk.counteractingFunction,
    product:         r.candidate,
    explanation:     explanationByName.get(r.candidate.name) ?? `Helps offset: ${r.risk.risk}`,
  }));

  return { complementary, routine: output.routine };
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
