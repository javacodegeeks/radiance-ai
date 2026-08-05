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
  /**
   * Called with a human-readable label each time the graph advances to a new
   * agent step (e.g. "Checking ingredient safety...") — lets callers (e.g.
   * an SSE response) surface live progress instead of one opaque wait for
   * the whole multi-step pipeline. Optional — omit for fire-and-forget use.
   */
  onProgress?: (label: string) => void;
}

/** Human-readable progress label per graph node — surfaced via RunOptions.onProgress as the workflow advances. Steps without an entry (e.g. 'done'/'error') are terminal and never reported as progress. */
const STEP_LABELS: Partial<Record<AgentStep, string>> = {
  interview:      'Reviewing your profile...',
  catalog_search: 'Searching our product catalog...',
  web_search:     'Searching the web for matching products...',
  safety_check:   'Checking ingredient safety...',
  recommend:      'Preparing your recommendations...',
};

export async function run(options: RunOptions): Promise<GraphStateType> {
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

  // Stream instead of invoke() so we can surface a progress label each time
  // the graph's currentStep changes, while still ending up with the same
  // fully-reduced final state invoke() would have returned (the 'values'
  // stream mode yields the state after every superstep, already merged
  // through each field's reducer in graph/state.ts).
  let finalState: GraphStateType = initialState as GraphStateType;
  let lastEmittedStep: AgentStep | undefined;

  for await (const chunk of await graph.stream(initialState, { streamMode: 'values' })) {
    finalState = chunk as GraphStateType;
    const label = STEP_LABELS[finalState.currentStep];
    if (label && finalState.currentStep !== lastEmittedStep) {
      lastEmittedStep = finalState.currentStep;
      options.onProgress?.(label);
    }
  }

  console.log(`[graph] done session=${options.sessionId} step=${finalState.currentStep} recs=${finalState.finalRecommendations?.length ?? 0}`);
  return finalState;
}
