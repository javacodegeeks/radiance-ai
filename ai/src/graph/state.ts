import { Annotation } from '@langchain/langgraph';
import { AgentStep, Message, Product, RecommendedProduct, UserProfile } from '../types';

export const GraphState = Annotation.Root({
  sessionId: Annotation<string>({
    reducer: (_, b) => b,
  }),
  userQuery: Annotation<string>({
    reducer: (_, b) => b,
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
  finalRecommendations: Annotation<RecommendedProduct[]>({
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
