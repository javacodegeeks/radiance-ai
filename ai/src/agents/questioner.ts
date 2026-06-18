import { z } from 'zod';
import { llmClient, llmConfig } from '../llm/client';
import { GraphStateType } from '../graph/state';

// ─── Structured output schema ─────────────────────────────────────────────────

const QuestionerOutputSchema = z.object({
  /** 1–3 focused questions for the user. Empty when no more info is needed. */
  questions: z.array(z.string()).max(3),
  /** Refined understanding of the user's specific issue */
  queryRefinement: z.object({
    refinedIssue:       z.string().optional(),
    bodyArea:           z.string().optional(),
    severity:           z.enum(['mild', 'moderate', 'severe']).optional(),
    duration:           z.string().optional(),
    triggers:           z.array(z.string()).optional(),
    previousTreatments: z.array(z.string()).optional(),
    goals:              z.array(z.string()).optional(),
  }),
  /** Profile fields extracted from the conversation */
  profileUpdates: z.object({
    country:    z.string().optional(),
    skinType:   z.string().optional(),
    allergies:  z.array(z.string()).optional(),
    conditions: z.array(z.string()).optional(),
    concerns:   z.array(z.string()).optional(),
  }),
  /** True when the issue is understood well enough to search for products */
  queryReady: z.boolean(),
  /** True when country and allergies are known */
  profileComplete: z.boolean(),
});

type QuestionerOutput = z.infer<typeof QuestionerOutputSchema>;

// ─── Static fallback ──────────────────────────────────────────────────────────

const CRITICAL_FIELDS: Array<keyof GraphStateType['userProfile']> = ['country', 'allergies'];
const PREFERRED_FIELDS: Array<keyof GraphStateType['userProfile']> = ['skinType', 'conditions', 'concerns'];

const FALLBACK_QUESTIONS: Record<string, string> = {
  country:    'Which country are you in? (This helps us find products available near you.)',
  allergies:  'Do you have any known ingredient allergies or sensitivities? (e.g. fragrance, nuts, preservatives — or "none")',
  skinType:   'How would you describe your skin type? (e.g. oily, dry, combination, sensitive, normal)',
  conditions: 'Are you pregnant, breastfeeding, or do you have any relevant skin conditions? (or "none")',
  concerns:   'What is your main skin/hair concern right now?',
};

// ─── Agent ────────────────────────────────────────────────────────────────────

/**
 * Questioner agent.
 * Uses an LLM to clarify the user's specific issue and collect safety profile
 * fields. Falls back to a static question map if the LLM call fails.
 *
 * Sets queryReady=true when the issue is understood, profileComplete=true
 * when country and allergies are confirmed.
 */
export async function questionerAgent(
  state: GraphStateType,
): Promise<Partial<GraphStateType>> {
  try {
    return await runLlmQuestioner(state);
  } catch {
    return runFallbackQuestioner(state);
  }
}

// ─── LLM path ─────────────────────────────────────────────────────────────────

async function runLlmQuestioner(
  state: GraphStateType,
): Promise<Partial<GraphStateType>> {
  const { userQuery, userProfile, conversationHistory } = state;

  const historyText = conversationHistory
    .map(m => `${m.role}: ${m.content}`)
    .join('\n');

  const profileSummary = JSON.stringify({
    country:    userProfile.country,
    skinType:   userProfile.skinType,
    allergies:  userProfile.allergies,
    conditions: userProfile.conditions,
    concerns:   userProfile.concerns,
  });

  const systemPrompt = `You are an expert cosmetic consultant. The user has a specific concern.
You must respond with a valid JSON object matching the schema below — no markdown, no explanation.

Schema:
{
  "questions": string[],          // 1-3 focused natural questions. Empty array [] if no more info needed.
  "queryRefinement": {
    "refinedIssue": string,       // Detailed description of the issue
    "bodyArea": string,           // e.g. "face", "scalp", "hands"
    "severity": "mild"|"moderate"|"severe",
    "duration": string,           // e.g. "2 weeks", "several months"
    "triggers": string[],
    "previousTreatments": string[],
    "goals": string[]             // e.g. ["reduce redness", "hydrate"]
  },
  "profileUpdates": {
    "country": string,
    "skinType": string,
    "allergies": string[],        // Empty array means user confirmed no allergies
    "conditions": string[],
    "concerns": string[]
  },
  "queryReady": boolean,          // true when you understand the issue well enough to search
  "profileComplete": boolean      // true when country AND allergies are known
}

Rules:
- Priority 1: Understand the specific issue (bodyArea, severity, duration, triggers, goals)
- Priority 2: Collect safety-critical profile fields (country, allergies) only when relevant
- Ask at most 3 questions per turn
- Set queryReady=true only when refinedIssue, bodyArea, and at least one goal are known
- Set profileComplete=true only when country and allergies are both present in profileUpdates or already in the profile`;

  const userPrompt = `User's Query: "${userQuery}"

Existing Profile: ${profileSummary}

Conversation History:
${historyText || '(no history yet)'}

Based on the above, respond with the JSON object.`;

  const response = await llmClient.chat.completions.create({
    model:       llmConfig.model,
    temperature: 0,
    max_tokens:  1024,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? '{}';
  const output: QuestionerOutput = QuestionerOutputSchema.parse(JSON.parse(raw));

  return buildStateUpdate(output, state);
}

// ─── Fallback path ────────────────────────────────────────────────────────────

function runFallbackQuestioner(
  state: GraphStateType,
): Partial<GraphStateType> {
  const { userProfile, queryContext, conversationHistory } = state;

  const missingCritical  = CRITICAL_FIELDS.filter(f => !userProfile[f]);
  const missingPreferred = PREFERRED_FIELDS.filter(f => !userProfile[f]);

  const criticalPresent   = missingCritical.length === 0;
  const sufficientHistory = conversationHistory.length >= 2;

  const contextUpdate = queryContext.refinedIssue
    ? {}
    : { refinedIssue: state.userQuery, goals: [] };

  if (criticalPresent && sufficientHistory) {
    return {
      profileComplete: true,
      queryReady:      true,
      queryContext:    contextUpdate,
    };
  }

  const questions = [...missingCritical, ...missingPreferred]
    .slice(0, 2)
    .map(f => FALLBACK_QUESTIONS[f as string])
    .filter(Boolean);

  return {
    profileComplete:  false,
    queryReady:       false,
    pendingQuestions: questions,
    queryContext:     contextUpdate,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildStateUpdate(
  output: QuestionerOutput,
  state: GraphStateType,
): Partial<GraphStateType> {
  const { r } = { r: output.queryRefinement };
  const { p } = { p: output.profileUpdates };

  // Merge LLM-extracted profile fields over existing profile
  const mergedProfile: Partial<GraphStateType['userProfile']> = {
    ...p.country    !== undefined && { country:    p.country },
    ...p.skinType   !== undefined && { skinType:   p.skinType },
    ...p.allergies  !== undefined && { allergies:  p.allergies },
    ...p.conditions !== undefined && { conditions: p.conditions },
    ...p.concerns   !== undefined && { concerns:   p.concerns },
  };

  // Safety net: don't trust LLM's profileComplete if critical fields are absent
  const effectiveCountry    = p.country    ?? state.userProfile.country;
  const effectiveAllergies  = p.allergies  ?? state.userProfile.allergies;
  const criticalFieldsPresent = !!effectiveCountry && effectiveAllergies !== undefined;

  const profileComplete = output.profileComplete && criticalFieldsPresent;
  const queryReady      = output.queryReady && !!(r.refinedIssue ?? state.queryContext.refinedIssue);

  const queryContext: Partial<GraphStateType['queryContext']> = {
    ...r.refinedIssue       !== undefined && { refinedIssue:       r.refinedIssue },
    ...r.bodyArea           !== undefined && { bodyArea:           r.bodyArea },
    ...r.severity           !== undefined && { severity:           r.severity },
    ...r.duration           !== undefined && { duration:           r.duration },
    ...r.triggers           !== undefined && { triggers:           r.triggers },
    ...r.previousTreatments !== undefined && { previousTreatments: r.previousTreatments },
    ...r.goals              !== undefined && { goals:              r.goals },
  };

  return {
    profileComplete,
    queryReady,
    pendingQuestions: output.questions,
    userProfile:      mergedProfile,
    queryContext,
  };
}
