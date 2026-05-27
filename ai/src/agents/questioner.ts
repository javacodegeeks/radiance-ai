import { GraphStateType } from '../graph/state';

/** Fields we must collect before we can research safely. */
const CRITICAL_FIELDS: Array<keyof GraphStateType['userProfile']> = ['country', 'allergies'];
/** Fields that improve recommendation quality but are not blocking. */
const PREFERRED_FIELDS: Array<keyof GraphStateType['userProfile']> = ['skinType', 'conditions', 'concerns'];

const QUESTION_PROMPTS: Record<string, string> = {
  country:    'Which country are you in? (This helps us find products available near you.)',
  allergies:  'Do you have any known ingredient allergies or sensitivities? (e.g. fragrance, nuts, preservatives — or "none")',
  skinType:   'How would you describe your skin type? (e.g. oily, dry, combination, sensitive, normal)',
  conditions: 'Are you pregnant, breastfeeding, or do you have any relevant skin conditions? (or "none")',
  concerns:   'What is your main skin/hair concern right now?',
};

/**
 * Questioner agent.
 * Checks the profile for gaps and either marks it complete or returns
 * up to 2 targeted questions for the user.
 *
 * TODO: replace static question map with an LLM call that generates
 * context-aware questions based on the user's original query.
 */
export async function questionerAgent(
  state: GraphStateType,
): Promise<Partial<GraphStateType>> {
  const { userQuery, userProfile, queryContext, conversationHistory } = state;

  const missingCritical  = CRITICAL_FIELDS.filter(f => !userProfile[f]);
  const missingPreferred = PREFERRED_FIELDS.filter(f => !userProfile[f]);

  // Seed originalQuery on first pass if not already set
  const contextUpdate: Partial<GraphStateType['queryContext']> = queryContext.originalQuery
    ? {}
    : { originalQuery: userQuery, refinedIssue: userQuery, goals: [] };

  // Profile is complete once critical fields are present and at least one turn has happened
  if (missingCritical.length === 0 && conversationHistory.length >= 2) {
    return { profileComplete: true, queryContext: contextUpdate };
  }

  const missingFields = [...missingCritical, ...missingPreferred];
  const questions = missingFields
    .slice(0, 2)
    .map(f => QUESTION_PROMPTS[f as string])
    .filter(Boolean);

  return {
    profileComplete: false,
    pendingQuestions: questions,
    queryContext: contextUpdate,
  };
}
