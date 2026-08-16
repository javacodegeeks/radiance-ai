import { z } from 'zod';
import { GraphStateType } from '../graph/state';
import { chatCompletion, LlmMessage, stripJsonFences } from '../llm/client';
import { SAFETY_CHECKER_SYSTEM } from '../llm/prompts';
import { CosingProhibitedSubstance, CosingRestriction, Product, RecommendedProduct, SafetyReport } from '../types';
import { findSafetyViolations, getKnownContraindications } from '../repositories/safetyRulesRepository';
import { findCosingRestrictions, findProhibitedSubstances } from '../repositories/cosingRestrictionsRepository';
import { LlmCallError, RepositoryError, SchemaParseError } from '../common/errors';

/**
 * Below this many ingredient/allergen signals, "no violations found" is not
 * a reliable "safe" verdict — the product's underlying data (INCI text,
 * allergens_tags) is too sparse to say the rule lookup had a fair chance.
 * See data/pipeline/02-seed-safety.ts for why sparse data is common here.
 */
const MIN_RELIABLE_INGREDIENT_COUNT = 5;

/**
 * Safety Checker agent — two layers.
 *
 * Layer 1 (deterministic): safety_rules lookup + EU CosIng Annex II/III/IV/V
 * lookup. A prohibited substance (Annex II) or a critical/high-severity
 * safety_rules violation is a hard block — final, and never passed to Layer 2.
 *
 * Layer 2 (LLM contextual reasoning): for products Layer 1 flagged with a
 * milder, ambiguous signal (medium/low violation, EU usage restriction,
 * sparse ingredient data, unrecognized condition) — batched into a single
 * call — decides approved vs. soft_warning using the user's actual concern
 * and profile as context. Structurally cannot produce a hard-block verdict
 * (see SafetyAssessmentSchema below), and never even sees hard-blocked
 * products, so Layer 1 hard blocks cannot be overridden.
 *
 * Products with no Layer 1 signal at all skip Layer 2 entirely (approved
 * directly) — no need to spend an LLM call on a squeaky-clean product.
 */
export async function safetyCheckerAgent(
  state: GraphStateType,
): Promise<Partial<GraphStateType>> {
  const { webResults, catalogResults, userProfile, userQuery, queryContext } = state;

  const allProducts = [...webResults, ...catalogResults];
  const userConditions: string[] = [
    ...(userProfile.allergies  ?? []),
    ...(userProfile.conditions ?? []),
  ];

  // A reported allergy/condition that isn't a known contraindication tag at
  // all (e.g. normalizeAllergies/normalizeConditions had no alias for it, and
  // it also isn't a tag already in the DB) means the rule lookup below has
  // *nothing* to check it against — "no violations found" in that case means
  // "we don't have data for this," not "cleared." Default to true (favor
  // caution) if the lookup itself fails, consistent with other safety-net
  // fallbacks in this agent.
  let hasUnrecognizedConditions = userConditions.length > 0;
  if (userConditions.length > 0) {
    try {
      const knownTags = await getKnownContraindications();
      hasUnrecognizedConditions = userConditions.some(c => !knownTags.has(c));
    } catch (err) {
      console.warn('[safetyChecker] failed to load known contraindication tags — defaulting to caution', err);
    }
  }

  console.log(`[safetyChecker] checking ${allProducts.length} product(s) against conditions: [${userConditions.join(', ') || 'none'}] (unrecognized=${hasUnrecognizedConditions})`);

  // ─── Layer 1 ────────────────────────────────────────────────────────────────
  const layer1Results = await Promise.all(
    allProducts.map(p => assessProductLayer1(p, userConditions, hasUnrecognizedConditions)),
  );
  const { hardBlocks, softWarnings, approved, flagged } = bucketLayer1Results(layer1Results);

  // ─── Layer 2 ────────────────────────────────────────────────────────────────
  const issue = queryContext.refinedIssue ?? userQuery;
  const assessments = flagged.length ? await runLayer2(flagged, issue, userProfile) : new Map();
  applyLayer2Verdicts(flagged, assessments, approved, softWarnings);

  const safetyReport: SafetyReport = { approved, softWarnings, hardBlocks };
  console.log(`[safetyChecker] approved=${approved.length} softWarnings=${softWarnings.length} hardBlocks=${hardBlocks.length}`);

  return {
    safetyReport,
    // Kept for backward compatibility with recommenderAgent/supervisor, which
    // only need "kept vs. filtered out," not the full approved/warned split.
    safetyCheckedProducts: [...approved, ...softWarnings],
  };
}

/** Sorts Layer 1 outcomes into their terminal buckets, deferring 'flagged' products to Layer 2. */
function bucketLayer1Results(results: Layer1Result[]): {
  hardBlocks: RecommendedProduct[];
  softWarnings: RecommendedProduct[];
  approved: RecommendedProduct[];
  flagged: FlaggedProduct[];
} {
  const hardBlocks: RecommendedProduct[] = [];
  const softWarnings: RecommendedProduct[] = [];
  const approved: RecommendedProduct[] = [];
  const flagged: FlaggedProduct[] = [];

  for (const result of results) {
    switch (result.kind) {
      case 'hard_block':
        hardBlocks.push(toRecommendedProduct(result.product, 'unsafe', result.notes, 0));
        break;
      case 'immediate_soft_warning':
        softWarnings.push(toRecommendedProduct(result.product, 'caution', result.notes, 0.5));
        break;
      case 'clear':
        approved.push(toRecommendedProduct(result.product, 'safe', undefined, 1.0));
        break;
      case 'flagged':
        flagged.push(result);
        break;
    }
  }

  return { hardBlocks, softWarnings, approved, flagged };
}

/** Resolves each Layer 2 verdict (or its absence) into the approved/softWarnings buckets, favoring caution when uncertain. */
function applyLayer2Verdicts(
  flagged: FlaggedProduct[],
  assessments: Map<string, SafetyAssessment>,
  approved: RecommendedProduct[],
  softWarnings: RecommendedProduct[],
): void {
  for (const item of flagged) {
    const assessment = assessments.get(item.product.name);

    // TODO(audit): assessment.reasoning (the Layer 2 LLM's own words) is
    // concatenated into `notes` below and loses its identity as a distinct,
    // LLM-generated fact — merged with the deterministic Layer 1 signal
    // before it ever reaches GraphStateType/safety_audit_log. To make Layer 2
    // reasoning independently auditable ("the LLM said X, here's why"),
    // carry it as its own field (e.g. RecommendedProduct.llmSafetyReasoning)
    // instead of folding it into `notes`, and thread it through
    // safetyAuditRepository.SafetyAuditEntry.
    if (assessment?.verdict === 'approved') {
      const notes = item.notes ? `${assessment.reasoning} ${item.notes}` : assessment.reasoning;
      approved.push(toRecommendedProduct(item.product, 'safe', notes, 0.9));
      continue;
    }

    // No matching assessment (name mismatch) or LLM call failed entirely — favor caution.
    const notes = assessment?.reasoning
      ? [assessment.reasoning, item.notes].filter(Boolean).join(' ')
      : item.notes;
    softWarnings.push(toRecommendedProduct(item.product, 'caution', notes, 0.7));
  }
}

// ─── Layer 1 — deterministic ───────────────────────────────────────────────────

interface FlaggedProduct {
  kind: 'flagged';
  product: Product;
  notes: string;
  /** Why this needs Layer 2 judgement — logged and passed to the LLM as context. */
  reason: string;
}

type Layer1Result =
  | { kind: 'hard_block'; product: Product; notes: string }
  | { kind: 'immediate_soft_warning'; product: Product; notes: string }
  | { kind: 'clear'; product: Product }
  | FlaggedProduct;

async function assessProductLayer1(
  product: Product,
  userConditions: string[],
  hasUnrecognizedConditions: boolean,
): Promise<Layer1Result> {
  // Merge free-text INCI with structured allergen tags (e.g. OBF's EU fragrance
  // allergens) — allergens_tags is cleaner/more reliable than parsing raw INCI text.
  const ingredientSignals = [...product.inci, ...(product.allergens ?? [])];

  // If no ingredient data at all we cannot verify — flag as caution. Nothing
  // for Layer 2 to reason about either, so resolve immediately.
  if (!ingredientSignals.length) {
    return { kind: 'immediate_soft_warning', product, notes: 'Ingredient list unavailable — verify before purchase.' };
  }

  let violations;
  try {
    violations = await findSafetyViolations(ingredientSignals, userConditions);
  } catch (err) {
    const label = err instanceof RepositoryError ? 'RepositoryError' : 'Unexpected error';
    console.error(`[safetyChecker] ${label} for "${product.name}" — defaulting to caution`, err);
    return { kind: 'immediate_soft_warning', product, notes: 'Safety check unavailable — verify before purchase.' };
  }

  // EU CosIng Annex II — substances prohibited outright in cosmetic products.
  // A stronger signal than an allergy-based violation: this is a hard block
  // regardless of the user's profile. Non-fatal: failure here shouldn't
  // affect the allergy-based verdict computed below.
  const prohibitedSubstances = await checkProhibitedSubstances(ingredientSignals, product.name);
  if (prohibitedSubstances.length) {
    return { kind: 'hard_block', product, notes: describeProhibitedSubstances(prohibitedSubstances) };
  }

  const hasCriticalOrHigh = violations.some(
    v => v.severity === 'critical' || v.severity === 'high',
  );
  if (hasCriticalOrHigh) {
    return { kind: 'hard_block', product, notes: violations.map(v => v.notes).filter(Boolean).join('; ') };
  }

  // EU-regulated (CosIng Annex III/IV/V) restrictions apply regardless of the
  // user's specific allergies/conditions — a general caution signal, not a
  // condition-specific violation. Non-fatal: failure here shouldn't override
  // the allergy-based signals already computed above.
  const cosingRestrictions = await checkCosingRestrictions(ingredientSignals, product.name);

  const reasons: string[] = [];
  const notesParts: string[] = [];

  if (violations.length) {
    reasons.push('lower_severity_violation');
    notesParts.push(violations.map(v => v.notes).filter(Boolean).join('; '));
  }
  if (cosingRestrictions.length) {
    reasons.push('cosing_restriction');
    notesParts.push(describeCosingRestrictions(cosingRestrictions));
  }
  if (hasUnrecognizedConditions) {
    reasons.push('unrecognized_condition');
    notesParts.push('Some reported allergies/conditions are not yet in our safety database.');
  }
  if (ingredientSignals.length < MIN_RELIABLE_INGREDIENT_COUNT) {
    reasons.push('sparse_ingredient_data');
    notesParts.push('Ingredient data is too sparse to confidently rule out risks.');
  }

  if (!reasons.length) {
    return { kind: 'clear', product };
  }

  return {
    kind: 'flagged',
    product,
    reason: reasons.join(', '),
    notes: notesParts.filter(Boolean).join(' '),
  };
}

async function checkCosingRestrictions(ingredientSignals: string[], productName: string): Promise<CosingRestriction[]> {
  try {
    return await findCosingRestrictions(ingredientSignals);
  } catch (err) {
    console.warn(`[safetyChecker] CosIng restriction lookup failed for "${productName}" — skipping this check`, err);
    return [];
  }
}

async function checkProhibitedSubstances(ingredientSignals: string[], productName: string): Promise<CosingProhibitedSubstance[]> {
  try {
    return await findProhibitedSubstances(ingredientSignals);
  } catch (err) {
    console.warn(`[safetyChecker] CosIng prohibited-substance lookup failed for "${productName}" — skipping this check`, err);
    return [];
  }
}

function describeCosingRestrictions(restrictions: CosingRestriction[]): string {
  if (!restrictions.length) return '';
  const parts = restrictions.map(r => {
    // Annex IV's "max concentration" column sometimes holds descriptive usage
    // text (e.g. "Rinse-off product") rather than a numeric percentage, so
    // this can't be labelled as a concentration unconditionally.
    const detail = r.maxConcentration || r.restrictionScope || 'usage restrictions apply';
    return `${r.ingredient} is EU-regulated (CosIng Annex ${r.annex} #${r.referenceNumber}, ${detail})`;
  });
  return `${parts.join('; ')}.`;
}

function describeProhibitedSubstances(substances: CosingProhibitedSubstance[]): string {
  const parts = substances.map(s => `${s.ingredient} is prohibited in cosmetic products under EU law (CosIng Annex II #${s.referenceNumber})`);
  return `${parts.join('; ')}.`;
}

function toRecommendedProduct(
  product: Product,
  safetyStatus: RecommendedProduct['safetyStatus'],
  safetyNotes: string | undefined,
  relevanceScore: number,
): RecommendedProduct {
  return { ...product, safetyStatus, ...(safetyNotes && { safetyNotes }), relevanceScore };
}

// ─── Layer 2 — LLM contextual reasoning ────────────────────────────────────────

const SafetyAssessmentSchema = z.object({
  assessments: z.array(z.object({
    name:      z.string(),
    // No "hard_block" option — Layer 2 structurally cannot escalate a product
    // past what Layer 1 already decided.
    verdict:   z.enum(['approved', 'soft_warning']),
    reasoning: z.string(),
  })),
});

type SafetyAssessment = { verdict: 'approved' | 'soft_warning'; reasoning: string };

async function runLayer2(
  flagged: FlaggedProduct[],
  issue: string,
  userProfile: GraphStateType['userProfile'],
): Promise<Map<string, SafetyAssessment>> {
  const profileSummary = JSON.stringify({
    allergies:  userProfile.allergies,
    conditions: userProfile.conditions,
    skinType:   userProfile.skinType,
  });

  const productList = flagged.map((item, i) =>
    `${i + 1}. "${item.product.name}" by ${item.product.brand}\n` +
    `   Flagged for: ${item.reason}\n` +
    `   Deterministic signal: ${item.notes || '(none)'}\n` +
    `   Ingredients: ${item.product.inci.slice(0, 10).join(', ') || 'unknown'}.`,
  ).join('\n');

  console.log(`[safetyChecker] Layer 2 — reviewing ${flagged.length} flagged product(s)`);
  const userPrompt = `User's concern: "${issue}"
User profile: ${profileSummary}

Flagged products:
${productList}

Decide approved or soft_warning for each product listed above.`;

  const messages: LlmMessage[] = [
    { role: 'system', content: SAFETY_CHECKER_SYSTEM },
    { role: 'user',   content: userPrompt },
  ];

  let raw: string;
  try {
    raw = await chatCompletion('safetyChecker', messages);
  } catch (err) {
    console.warn('[safetyChecker] Layer 2 LLM call failed — defaulting flagged products to soft_warning', new LlmCallError('safetyChecker', 'LLM API call failed', err));
    return new Map();
  }

  try {
    const output = SafetyAssessmentSchema.parse(JSON.parse(stripJsonFences(raw)));
    return new Map(output.assessments.map(a => [a.name, { verdict: a.verdict, reasoning: a.reasoning }]));
  } catch (err) {
    console.warn('[safetyChecker] Layer 2 response failed schema validation — defaulting flagged products to soft_warning', new SchemaParseError('safetyChecker', 'LLM response failed schema validation', err));
    return new Map();
  }
}
