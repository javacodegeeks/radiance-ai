/**
 * Graph runner — single entry-point for invoking the LangGraph workflow.
 * chatService calls run() here; nothing else should invoke graph.invoke() directly.
 */
import { graph } from './workflow';
import { GraphStateType } from './state';
import { AgentStep } from '../types';

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
    sessionId:             options.sessionId,
    userQuery:             options.userQuery,
    queryContext:          { refinedIssue: options.userQuery, goals: [] },
    userProfile:           options.existingProfile ?? {},
    conversationHistory:   options.conversationHistory ?? [],
    pendingQuestions:      [],
    profileComplete:       false,
    webResults:            [],
    catalogResults:        [],
    safetyCheckedProducts: [],
    safetyReport:          { approved: [], softWarnings: [], hardBlocks: [] },
    finalRecommendations:  [],
    excludedRecommendations: [],
    currentStep:           'interview' as AgentStep,
    iterationCount:        0,
  };

  console.log(`[graph] invoke session=${options.sessionId}`);
  const finalState = await graph.invoke(initialState);
  console.log(`[graph] done session=${options.sessionId} step=${finalState.currentStep} recs=${finalState.finalRecommendations?.length ?? 0}`);
  return finalState;
}
