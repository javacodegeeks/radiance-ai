import { z } from 'zod';
import { chatCompletion, LlmMessage, stripJsonFences } from '../llm/client';
import { QUESTIONER_SYSTEM } from '../llm/prompts';
import { LlmCallError, SchemaParseError } from '../common/errors';
import { FALLBACK_QUESTIONS } from '../config/profileQuestions';
import { GraphStateType } from '../graph/state';
import { searchClinicalEvidence } from '../tools/pubmed/searchClinicalEvidence';
import type { PubMedSearchResult } from '../tools/pubmed/types';

// ─── Structured output schema ─────────────────────────────────────────────────

const QuestionerOutputSchema = z.object({
  /** 1–3 focused questions for the user. Empty when no more info is needed. */
  questions: z.array(z.string()).max(3),
  /** PubMed search query to run if clinical evidence is needed; null otherwise */
  evidenceQuery: z.string().nullish(),
  /** Refined understanding of the user's specific issue */
  queryRefinement: z.object({
    refinedIssue:       z.string().nullish(),
    bodyArea:           z.string().nullish(),
    severity:           z.enum(['mild', 'moderate', 'severe']).nullish(),
    duration:           z.string().nullish(),
    triggers:           z.array(z.string()).nullish(),
    previousTreatments: z.array(z.string()).nullish(),
    goals:              z.array(z.string()).nullish(),
  }),
  /** Profile fields extracted from the conversation */
  profileUpdates: z.object({
    country:    z.string().nullish(),
    skinType:   z.string().nullish(),
    allergies:  z.array(z.string()).nullish(),
    conditions: z.array(z.string()).nullish(),
    concerns:   z.array(z.string()).nullish(),
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
  } catch (err) {
    const label = err instanceof LlmCallError    ? 'LLM API call failed'
                : err instanceof SchemaParseError ? 'Response schema invalid'
                : 'Unexpected error';
    console.error(`[questioner] ${label} — falling back to static questions`, err);
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

  console.log('[questioner] prompt=QUESTIONER_SYSTEM');
  const userPrompt = `User's Query: "${userQuery}"

Existing Profile: ${profileSummary}

Conversation History:
${historyText || '(no history yet)'}

Based on the above, respond with the JSON object.`;

  const messages: LlmMessage[] = [
    { role: 'system', content: QUESTIONER_SYSTEM },
    { role: 'user',   content: userPrompt },
  ];

  let raw: string;
  try {
    raw = await chatCompletion('questioner', messages);
  } catch (err) {
    throw new LlmCallError('questioner', 'LLM API call failed', err);
  }

  let output: QuestionerOutput;
  try {
    output = QuestionerOutputSchema.parse(JSON.parse(stripJsonFences(raw)));
  } catch (err) {
    throw new SchemaParseError('questioner', 'LLM response failed schema validation', err);
  }

  // ── ReAct-lite: fetch clinical evidence if the LLM requested it ──────────────
  if (output.evidenceQuery) {
    console.log(`[questioner] evidence query requested: "${output.evidenceQuery}"`);
    try {
      const evidence = await searchClinicalEvidence(output.evidenceQuery, { maxResults: 3 });

      if (evidence.articles.length > 0) {
        console.log(`[questioner] retrieved ${evidence.articles.length} evidence articles`);
        const evidenceText = formatEvidenceForPrompt(evidence);

        // Second LLM call: inject evidence and ask the model to refine its questions
        const refinedMessages: LlmMessage[] = [
          ...messages,
          { role: 'assistant', content: raw },
          {
            role: 'user',
            content:
              `PubMed evidence retrieved for "${output.evidenceQuery}":\n\n${evidenceText}\n\n` +
              'Using this evidence, refine your response with more evidence-based questions. ' +
              'Respond with the JSON object.',
          },
        ];

        try {
          const refinedRaw = await chatCompletion('questioner', refinedMessages);
          output = QuestionerOutputSchema.parse(JSON.parse(stripJsonFences(refinedRaw)));
          console.log('[questioner] evidence-enriched response parsed successfully');
        } catch {
          // Second call failure is non-fatal — proceed with the original output
          console.warn('[questioner] evidence-enriched call failed, using original output');
        }
      }
    } catch (err) {
      // PubMed failure is non-fatal — the questioner can still function without evidence
      console.warn(
        `[questioner] PubMed search failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return buildStateUpdate(output, state);
}

// ─── Evidence formatting ──────────────────────────────────────────────────────

function formatEvidenceForPrompt(result: PubMedSearchResult): string {
  return result.articles
    .map((a, i) => {
      const authorStr = a.authors.length
        ? a.authors.slice(0, 3).join(', ') + (a.authors.length > 3 ? ' et al.' : '')
        : 'Unknown authors';
      const abstractSnippet = a.abstract
        ? a.abstract.slice(0, 400) + (a.abstract.length > 400 ? '...' : '')
        : 'No abstract available';
      return (
        `[${i + 1}] ${a.title}\n` +
        `Authors: ${authorStr}\n` +
        `Journal: ${a.journal} (${a.publicationDate})\n` +
        `Abstract: ${abstractSnippet}`
      );
    })
    .join('\n\n');
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
  // != null guards against both null and undefined (LLMs may return either for absent fields)
  const mergedProfile: Partial<GraphStateType['userProfile']> = {
    ...p.country    != null && { country:    p.country },
    ...p.skinType   != null && { skinType:   p.skinType },
    ...p.allergies  != null && { allergies:  p.allergies },
    ...p.conditions != null && { conditions: p.conditions },
    ...p.concerns   != null && { concerns:   p.concerns },
  };

  // Safety net: don't trust LLM's profileComplete if critical fields are absent
  const effectiveCountry    = p.country    ?? state.userProfile.country;
  const effectiveAllergies  = p.allergies  ?? state.userProfile.allergies;
  const criticalFieldsPresent = !!effectiveCountry && effectiveAllergies != null;

  const profileComplete = output.profileComplete && criticalFieldsPresent;

  // Safety net: if profile is complete and we already have conversation history
  // (at least 2 Q&A turns = 4 messages), treat the query as ready regardless of
  // what the LLM returns — prevents weaker models from looping indefinitely.
  const sufficientHistory = state.conversationHistory.length >= 4;
  const queryReady = (output.queryReady || (profileComplete && sufficientHistory))
    && !!(r.refinedIssue ?? state.queryContext.refinedIssue);

  const queryContext: Partial<GraphStateType['queryContext']> = {
    ...r.refinedIssue       != null && { refinedIssue:       r.refinedIssue },
    ...r.bodyArea           != null && { bodyArea:           r.bodyArea },
    ...r.severity           != null && { severity:           r.severity },
    ...r.duration           != null && { duration:           r.duration },
    ...r.triggers           != null && { triggers:           r.triggers },
    ...r.previousTreatments != null && { previousTreatments: r.previousTreatments },
    ...r.goals              != null && { goals:              r.goals },
  };

  console.log(`[questioner] queryReady=${queryReady} profileComplete=${profileComplete} questions=${output.questions.length}`);
  if (output.questions.length > 0) {
    console.log(`[questioner] pending questions: ${output.questions.join(' | ')}`);
  }

  return {
    profileComplete,
    queryReady,
    pendingQuestions: output.questions,
    userProfile:      mergedProfile,
    queryContext,
  };
}
