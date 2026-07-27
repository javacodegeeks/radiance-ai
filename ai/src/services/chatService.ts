/**
 * Chat service — owns session phase transitions and AI graph orchestration.
 * No HTTP knowledge: takes plain values, returns plain response objects.
 */

import { v4 as uuidv4 } from 'uuid';
import { run } from '../graph/runner';
import { AgentError, RepositoryError } from '../common/errors';
import { normalizeAllergies } from '../common/allergyNormalizer';
import { PROFILE_QUESTIONS } from '../config/profileQuestions';
import {
  getSession,
  setSession,
  createSession,
  appendMessage,
  QuestioningState,
} from './sessionStore';

// ─── Response types (consumed by the controller) ──────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface RecommendationResult {
  name: string;
  brand: string;
  categories: string[];
  countryAvailability: string[];
  sourceUrl?: string;
  safetyStatus: 'safe' | 'caution' | 'unsafe';
  safetyNotes?: string;
  relevanceScore: number;
  availabilityNotes?: string;
  relevanceToQuery?: string;
  reasoning?: string;
  usageTips?: string[];
}

export type ChatPhase = 'collecting' | 'questioning' | 'processing' | 'done' | 'error';

export interface ChatResponse {
  messages: ChatMessage[];
  phase: ChatPhase;
  recommendations?: RecommendationResult[];
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const GREETING_RE = /^(hi+|hello+|hey+|yo|howdy|hola|sup|greetings?|good\s*(morning|afternoon|evening))[!.,?]?$/i;

function isGreeting(text: string): boolean {
  return GREETING_RE.test(text.trim());
}

function msg(role: ChatMessage['role'], content: string): ChatMessage {
  return { id: uuidv4(), role, content, timestamp: new Date().toISOString() };
}

function parseList(raw: string): string[] {
  if (!raw || raw.trim().toLowerCase() === 'none') return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function noProductsFound(): ChatResponse {
  return {
    messages: [msg('assistant', "I couldn't find suitable products for your concern right now. Try rephrasing or starting a new search.")],
    phase: 'done',
    recommendations: [],
  };
}

function recommendationsResponse(recs: RecommendationResult[]): ChatResponse {
  return {
    messages: [msg('assistant', 'Here are your personalised recommendations based on your concern:')],
    phase: 'done',
    recommendations: recs,
  };
}

function graphErrorResponse(sessionId: string, err: unknown): ChatResponse {
  const text = err instanceof RepositoryError ? 'A data service is temporarily unavailable. Please try again.'
             : err instanceof AgentError       ? 'The recommendation engine encountered an error. Please try again.'
             : 'An unexpected error occurred. Please try again.';
  console.error(`[chatService] session=${sessionId} run() failed (${err instanceof Error ? err.name : 'unknown'}):`, err);
  return { messages: [msg('assistant', text)], phase: 'error' };
}

async function reply(sessionId: string, content: string): Promise<ChatMessage> {
  await appendMessage(sessionId, 'assistant', content);
  return msg('assistant', content);
}

// ─── Service ──────────────────────────────────────────────────────────────────

export async function processMessage(sessionId: string, message: string): Promise<ChatResponse> {
  let session = await getSession(sessionId) ?? await createSession(sessionId);
  console.log(`[chatService] session=${sessionId} phase=${session.phase}`);

  await appendMessage(sessionId, 'user', message);

  // ── INIT ───────────────────────────────────────────────────────────────────
  if (session.phase === 'init') {
    if (isGreeting(message)) {
      const text = "Hi! What skin or hair concern can I help you with today?";
      return { messages: [await reply(sessionId, text)], phase: 'collecting' };
    }
    await setSession(sessionId, {
      ...session,
      phase: 'collecting',
      profile: { userQuery: message, questionIndex: 0, answers: {} },
    });
    const text = `Got it. A few quick questions to personalise your recommendations.\n\n${PROFILE_QUESTIONS[0].text}`;
    return { messages: [await reply(sessionId, text)], phase: 'collecting' };
  }

  // ── COLLECTING ─────────────────────────────────────────────────────────────
  if (session.phase === 'collecting' && session.profile) {
    const { questionIndex, answers, userQuery } = session.profile;
    const currentQ   = PROFILE_QUESTIONS[questionIndex];
    const updAnswers = { ...answers, [currentQ.key]: message };
    const nextIndex  = questionIndex + 1;

    if (nextIndex < PROFILE_QUESTIONS.length) {
      await setSession(sessionId, {
        ...session,
        profile: { userQuery, questionIndex: nextIndex, answers: updAnswers },
      });
      return { messages: [await reply(sessionId, PROFILE_QUESTIONS[nextIndex].text)], phase: 'collecting' };
    }

    const existingProfile = {
      country:    updAnswers['country'],
      skinType:   updAnswers['skinType'],
      allergies:  normalizeAllergies(parseList(updAnswers['allergies']  ?? '')),
      conditions: parseList(updAnswers['conditions'] ?? ''),
    };

    await setSession(sessionId, { ...session, phase: 'processing' });
    console.log(`[chatService] session=${sessionId} invoking graph`);

    let graphResult;
    try {
      graphResult = await run({ sessionId, userQuery, existingProfile });
    } catch (err) {
      await setSession(sessionId, { ...session, phase: 'error' });
      return graphErrorResponse(sessionId, err);
    }
    const recs = (graphResult.finalRecommendations ?? []) as RecommendationResult[];
    console.log(`[chatService] session=${sessionId} graph done recs=${recs.length}`);

    if (graphResult.pendingQuestions && graphResult.pendingQuestions.length > 0) {
      const questioningState: QuestioningState = {
        userQuery,
        existingProfile,
        pendingQuestions: graphResult.pendingQuestions,
        questionIndex: 0,
        conversationHistory: [],
      };
      await setSession(sessionId, { ...session, phase: 'questioning', questioning: questioningState });
      return { messages: [await reply(sessionId, graphResult.pendingQuestions[0])], phase: 'questioning' };
    }

    await setSession(sessionId, { ...session, phase: 'done' });
    const response = recs.length === 0 ? noProductsFound() : recommendationsResponse(recs);
    await appendMessage(sessionId, 'assistant', response.messages[0].content);
    return response;
  }

  // ── QUESTIONING ────────────────────────────────────────────────────────────
  if (session.phase === 'questioning' && session.questioning) {
    const { pendingQuestions, questionIndex, conversationHistory, userQuery, existingProfile } = session.questioning;
    const currentQ = pendingQuestions[questionIndex];
    const now      = new Date();

    const updatedHistory = [
      ...conversationHistory.map(m => ({ ...m, timestamp: now })),
      { role: 'assistant' as const, content: currentQ,  timestamp: now },
      { role: 'user'      as const, content: message,   timestamp: now },
    ];

    const nextIndex = questionIndex + 1;

    if (nextIndex < pendingQuestions.length) {
      await setSession(sessionId, {
        ...session,
        questioning: { ...session.questioning, questionIndex: nextIndex, conversationHistory: updatedHistory },
      });
      return { messages: [await reply(sessionId, pendingQuestions[nextIndex])], phase: 'questioning' };
    }

    await setSession(sessionId, { ...session, phase: 'processing' });
    console.log(`[chatService] session=${sessionId} invoking graph (questioning complete)`);

    let graphResult;
    try {
      graphResult = await run({ sessionId, userQuery, existingProfile, conversationHistory: updatedHistory });
    } catch (err) {
      await setSession(sessionId, { ...session, phase: 'error' });
      return graphErrorResponse(sessionId, err);
    }
    const recs = (graphResult.finalRecommendations ?? []) as RecommendationResult[];
    console.log(`[chatService] session=${sessionId} graph done recs=${recs.length}`);

    if (graphResult.pendingQuestions && graphResult.pendingQuestions.length > 0) {
      const nextQuestioningState: QuestioningState = {
        userQuery,
        existingProfile,
        pendingQuestions: graphResult.pendingQuestions,
        questionIndex: 0,
        conversationHistory: updatedHistory,
      };
      await setSession(sessionId, { ...session, phase: 'questioning', questioning: nextQuestioningState });
      return { messages: [await reply(sessionId, graphResult.pendingQuestions[0])], phase: 'questioning' };
    }

    await setSession(sessionId, { ...session, phase: 'done' });
    const response = recs.length === 0 ? noProductsFound() : recommendationsResponse(recs);
    await appendMessage(sessionId, 'assistant', response.messages[0].content);
    return response;
  }

  // ── DONE / ERROR — restart ─────────────────────────────────────────────────
  if (session.phase === 'done' || session.phase === 'error') {
    const newSession = await createSession(sessionId);
    await setSession(sessionId, {
      ...newSession,
      phase: 'collecting',
      profile: { userQuery: message, questionIndex: 0, answers: {} },
    });
    const text = `Starting a new search. First question:\n\n${PROFILE_QUESTIONS[0].text}`;
    return { messages: [await reply(sessionId, text)], phase: 'collecting' };
  }

  return { messages: [await reply(sessionId, 'Tell me about your skin or hair concern to get started.')], phase: 'collecting' };
}
