import { Annotation } from '@langchain/langgraph';
import { AgentStep, ComplementaryRecommendation, ExcludedRecommendation, Message, Product, QueryContext, RecommendedProduct, Routine, SafetyReport, UserProfile } from '../types';

export const GraphState = Annotation.Root({
  sessionId: Annotation<string>({
    reducer: (_, b) => b,
  }),
  userQuery: Annotation<string>({
    reducer: (_, b) => b,
  }),
  queryContext: Annotation<Partial<QueryContext>>({
    // Merge partial updates so agents can patch individual fields
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({}),
  }),
  userProfile: Annotation<Partial<UserProfile>>({
    // Merge partial updates so agents can patch individual fields
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({}),
  }),
  conversationHistory: Annotation<Message[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  pendingQuestions: Annotation<string[]>({
    reducer: (_, b) => b,
    default: () => [],
  }),
  profileComplete: Annotation<boolean>({
    reducer: (_, b) => b,
    default: () => false,
  }),
   queryReady: Annotation<boolean>({
    reducer: (_, b) => b,
    default: () => false,
  }),
  webResults: Annotation<Product[]>({
    reducer: (_, b) => b,
    default: () => [],
  }),
  catalogResults: Annotation<Product[]>({
    reducer: (_, b) => b,
    default: () => [],
  }),
  safetyCheckedProducts: Annotation<RecommendedProduct[]>({
    reducer: (_, b) => b,
    default: () => [],
  }),
  /** Structured Layer 1 + Layer 2 safety-checker output — see agents/safetyChecker.ts. */
  safetyReport: Annotation<SafetyReport>({
    reducer: (_, b) => b,
    default: () => ({ approved: [], softWarnings: [], hardBlocks: [] }),
  }),
  finalRecommendations: Annotation<RecommendedProduct[]>({
    reducer: (_, b) => b,
    default: () => [],
  }),
  /** Products the Recommender's LLM call excluded as unsafe, with its stated reason — see agents/recommender.ts. */
  excludedRecommendations: Annotation<ExcludedRecommendation[]>({
    reducer: (_, b) => b,
    default: () => [],
  }),
  /** AM/PM sequencing of finalRecommendations + interaction guidance — see agents/recommender.ts. */
  routine: Annotation<Routine>({
    reducer: (_, b) => b,
    default: () => ({ am: [], pm: [], interactionWarnings: [] }),
  }),
  /** Complementary products algorithmically resolved to counteract an elevated side-effect risk — see agents/recommender.ts. */
  complementaryRecommendations: Annotation<ComplementaryRecommendation[]>({
    reducer: (_, b) => b,
    default: () => [],
  }),
  currentStep: Annotation<AgentStep>({
    reducer: (_, b) => b,
    default: () => 'interview',
  }),
  iterationCount: Annotation<number>({
    reducer: (_, b) => b,
    default: () => 0,
  }),
  error: Annotation<string | undefined>({
    reducer: (_, b) => b,
    default: () => undefined,
  }),
});

export type GraphStateType = typeof GraphState.State;
