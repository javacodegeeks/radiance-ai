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
  const { profileComplete, iterationCount, webResults, safetyCheckedProducts } = state;

  if (iterationCount >= MAX_ITERATIONS) {
    return { currentStep: 'error', error: 'Max iterations reached — aborting to prevent infinite loop.' };
  }

  const next = iterationCount + 1;

  if (!profileComplete) {
    return { currentStep: 'interview', iterationCount: next };
  }
  if (webResults.length === 0) {
    return { currentStep: 'research', iterationCount: next };
  }
  if (safetyCheckedProducts.length === 0) {
    return { currentStep: 'safety_check', iterationCount: next };
  }

  return { currentStep: 'recommend', iterationCount: next };
}

/** Conditional edge function — maps currentStep to graph node name. */
export function routeAfterSupervisor(state: GraphStateType): string {
  return state.currentStep;
}
