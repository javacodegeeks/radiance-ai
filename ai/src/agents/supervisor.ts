import { GraphStateType } from '../graph/state';
import { llmClient, llmConfig } from '../llm/client';

/** Hard cap to prevent infinite loops — a critical safety-net for any agentic system. */
const MAX_ITERATIONS = 10;

/** Allowed routing outputs (strict guardrail) */
const ALLOWED_STEPS = [
  'interview',
  'research',
  'safety_check',
  'recommend',
  'done',
  'error',
] as const;

type AllowedStep = (typeof ALLOWED_STEPS)[number];

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

// Build routing prompt
  const prompt = `
You are a supervisor agent for a skincare AI system.

Your job is to decide the NEXT step in the workflow.

Available steps:
- interview → need more user info or clarification
- research → fetch product data
- safety_check → validate ingredients against safety rules
- recommend → generate final recommendations
- done → task is complete
- error → something went wrong

Decision Guidelines:
- If user profile is incomplete → interview
- If queryContext.refinedIssue is missing → interview
- If no products exist → research
- If products exist but not safety checked → safety_check
- If everything is ready → recommend
- If recommendations already exist → done

IMPORTANT:
- Respond with ONLY ONE WORD from the list above
- Do NOT explain your answer

State:
${JSON.stringify(state, null, 2)}
`;

  try {
    const response = await llmClient.chat.completions.create({
      model: llmConfig.model,
      temperature: 0, // deterministic routing
      max_tokens: 10,
      messages: [
        { role: 'system', content: 'You are a strict routing agent. Output only one word.' },
        { role: 'user', content: prompt },
      ],
    });
    
       const rawOutput = response.choices[0]?.message?.content?.trim().toLowerCase();

    // Guardrail: validate LLM output
    const nextStep: AllowedStep = ALLOWED_STEPS.includes(rawOutput as AllowedStep)
      ? (rawOutput as AllowedStep)
      : 'error';

    return {
      currentStep: nextStep,
      iterationCount: iterationCount + 1,
      error: nextStep === 'error' ? `Invalid supervisor output: ${rawOutput}` : undefined,
    };

  } catch (err: any) {
    // Fail-safe: fallback to deterministic logic
    // console.error('Supervisor LLM error:', err);
     
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
}
/** Conditional edge function — maps currentStep to graph node name. */
export function routeAfterSupervisor(state: GraphStateType): string {
  return state.currentStep;
}
