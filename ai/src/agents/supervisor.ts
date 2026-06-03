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
  const { profileComplete, queryReady, iterationCount, webResults, safetyCheckedProducts, finalRecommendations } = state;

  if (iterationCount >= MAX_ITERATIONS) {
    return { currentStep: 'error', error: 'Max iterations reached — aborting to prevent infinite loop.' };
  }

  const next = iterationCount + 1;
  
  // STEP 1: Always go to Questioner until ready
  if (queryReady && !profileComplete)  {
    return { currentStep: 'interview', iterationCount: next };
  }

    // if (!profileComplete) {
   // We still proceed, but supervisor can choose to revisit later if needed
  //  return { currentStep: 'interview', iterationCount: next };
  //}
  
  // STEP 2: Query ready → do research
  if (webResults.length === 0) {
    return { currentStep: 'research', iterationCount: next };
  }
  
 // STEP 3: Run safety checks
  if (safetyCheckedProducts.length === 0) {
    return { currentStep: 'safety_check', iterationCount: next };
  }

  //  STEP 4: Generate recommendations
  if (finalRecommendations.length === 0) {
    return { currentStep: 'recommend', iterationCount: next };
  }
  
  // STEP 5: Done
  return { currentStep: 'end', iterationCount: next };
}

/** Conditional edge function — maps currentStep to graph node name. */
export function routeAfterSupervisor(state: GraphStateType): string {
  return state.currentStep;
}
