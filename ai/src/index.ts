/**
 * AI layer entry-point — wires the graph and exposes a simple run() function.
 * The Express backend imports this module.
 */
import { graph } from './graph/workflow';
import { GraphStateType } from './graph/state';
import { AgentStep } from './types';

export interface RunOptions {
  sessionId: string;
  userQuery: string;
  /** Pre-populated profile fields from session store */
  existingProfile?: Partial<GraphStateType['userProfile']>;
  /** Q&A pairs from a previous questioner round — passed on resume */
  conversationHistory?: Array<{ role: 'user' | 'assistant' | 'system'; content: string; timestamp: Date }>;
}

export async function run(options: RunOptions) {
  const initialState: Partial<GraphStateType> = {
    sessionId:            options.sessionId,
    userQuery:            options.userQuery,
    queryContext:         { refinedIssue: options.userQuery, goals: [] },
    userProfile:          options.existingProfile ?? {},
    conversationHistory:  options.conversationHistory ?? [],
    pendingQuestions:     [],
    profileComplete:      false,
    webResults:           [],
    catalogResults:       [],
    safetyCheckedProducts:[],
    finalRecommendations: [],
    currentStep:          'interview' as AgentStep,
    iterationCount:       0,
  };

  const finalState = await graph.invoke(initialState);
  return finalState;
}
