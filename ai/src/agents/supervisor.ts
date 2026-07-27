import { GraphStateType } from '../graph/state';

/** Hard cap to prevent infinite loops — a critical safety-net for any agentic system. */
const MAX_ITERATIONS = 10;

/**
 * Supervisor agent.
 * Inspects state and decides which specialised agent should run next.
 * Does NOT call the LLM — routing logic is deterministic.
 */
export async function supervisorAgent(
  state: GraphStateType,
): Promise<Partial<GraphStateType>> {
  const { currentStep, profileComplete, queryReady, pendingQuestions, iterationCount, catalogResults, safetyCheckedProducts, finalRecommendations } = state;

  if (iterationCount >= MAX_ITERATIONS) {
    console.error('[supervisor] max iterations reached — aborting');
    return { currentStep: 'error', error: 'Max iterations reached — aborting to prevent infinite loop.' };
  }

  const next = iterationCount + 1;
  console.log(`[supervisor] iteration=${next} step=${currentStep} queryReady=${queryReady} profileComplete=${profileComplete} catalog=${catalogResults.length} safetyChecked=${safetyCheckedProducts.length} recs=${finalRecommendations.length}`);

  // STEP 1: Questioner has returned questions for the user — pause and end the
  // workflow so the caller can surface them, collect answers, and invoke the
  // graph again. Checked unconditionally: the evidence-enriched LLM call can
  // set queryReady=true/profileComplete=true while still asking follow-up
  // questions (e.g. safety-relevant ones surfaced by PubMed evidence), and a
  // "ready to search" verdict must not cause those questions to be dropped.
  if (pendingQuestions && pendingQuestions.length > 0) {
    console.log(`[supervisor] → done (pending ${pendingQuestions.length} question(s) for user)`);
    return { currentStep: 'done', iterationCount: next };
  }

  // STEP 2: Always go to Questioner until ready
  if (!queryReady || !profileComplete) {
    console.log('[supervisor] → interview');
    return { currentStep: 'interview', iterationCount: next };
  }

  // STEP 3: Query ready → find products in catalog first (primary source)
  if (currentStep === 'interview' && catalogResults.length === 0) {
    console.log('[supervisor] → catalog_search');
    return { currentStep: 'catalog_search', iterationCount: next };
  }

  // STEP 4: Query ready → if catalog fails, try web search as fallback (secondary source)
  if (currentStep === 'catalog_search' && catalogResults.length === 0) {
    console.log('[supervisor] → web_search (catalog empty)');
    return { currentStep: 'web_search', iterationCount: next };
  }

  // STEP 5: Run safety checks (only if not already run — avoids loop when 0 products found)
  if (currentStep !== 'safety_check' && safetyCheckedProducts.length === 0) {
    console.log('[supervisor] → safety_check');
    return { currentStep: 'safety_check', iterationCount: next };
  }

  // STEP 6: Generate recommendations
  if (finalRecommendations.length === 0) {
    console.log('[supervisor] → recommend');
    return { currentStep: 'recommend', iterationCount: next };
  }

  // STEP 7: Done
  console.log('[supervisor] → done');
  return { currentStep: 'done', iterationCount: next };
}

/** Conditional edge function — maps currentStep to graph node name. */
export function routeAfterSupervisor(state: GraphStateType): string {
  return state.currentStep;
}
