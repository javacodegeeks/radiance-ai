/**
 * Chat service — owns session phase transitions and AI graph orchestration.
 * No HTTP knowledge: takes plain values, returns plain response objects.
 */

import { v4 as uuidv4 } from 'uuid';
import { run } from '../graph/runner';
import { AgentError, RepositoryError } from '../common/errors';
import { PROFILE_QUESTIONS } from '../config/profileQuestions';
import {
  getSession,
  setSession,
  createSession,
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

// ─── Service ──────────────────────────────────────────────────────────────────

export async function processMessage(sessionId: string, message: string): Promise<ChatResponse> {
  let session = getSession(sessionId) ?? createSession(sessionId);
  console.log(`[chatService] session=${sessionId} phase=${session.phase}`);

  // ── INIT ───────────────────────────────────────────────────────────────────
  if (session.phase === 'init') {
    setSession(sessionId, {
      ...session,
      phase: 'collecting',
      profile: { userQuery: message, questionIndex: 0, answers: {} },
    });
    return {
      messages: [msg('assistant', `Got it. A few quick questions to personalise your recommendations.\n\n${PROFILE_QUESTIONS[0].text}`)],
      phase: 'collecting',
    };
  }

  // ── COLLECTING ─────────────────────────────────────────────────────────────
  if (session.phase === 'collecting' && session.profile) {
    const { questionIndex, answers, userQuery } = session.profile;
    const currentQ   = PROFILE_QUESTIONS[questionIndex];
    const updAnswers = { ...answers, [currentQ.key]: message };
    const nextIndex  = questionIndex + 1;

    if (nextIndex < PROFILE_QUESTIONS.length) {
      setSession(sessionId, {
        ...session,
        profile: { userQuery, questionIndex: nextIndex, answers: updAnswers },
      });
      return { messages: [msg('assistant', PROFILE_QUESTIONS[nextIndex].text)], phase: 'collecting' };
    }

    const existingProfile = {
      country:    updAnswers['country'],
      skinType:   updAnswers['skinType'],
      allergies:  parseList(updAnswers['allergies']  ?? ''),
      conditions: parseList(updAnswers['conditions'] ?? ''),
    };

    setSession(sessionId, { ...session, phase: 'processing' });

    console.log(`[chatService] session=${sessionId} invoking graph`);
    let graphResult;
    try {
      graphResult = await run({ sessionId, userQuery, existingProfile });
    } catch (err) {
      setSession(sessionId, { ...session, phase: 'error' });
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
      setSession(sessionId, { ...session, phase: 'questioning', questioning: questioningState });
      return { messages: [msg('assistant', graphResult.pendingQuestions[0])], phase: 'questioning' };
    }

    setSession(sessionId, { ...session, phase: 'done' });
    return recs.length === 0 ? noProductsFound() : recommendationsResponse(recs);
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
      setSession(sessionId, {
        ...session,
        questioning: { ...session.questioning, questionIndex: nextIndex, conversationHistory: updatedHistory },
      });
      return { messages: [msg('assistant', pendingQuestions[nextIndex])], phase: 'questioning' };
    }

    setSession(sessionId, { ...session, phase: 'processing' });
    console.log(`[chatService] session=${sessionId} invoking graph (questioning complete)`);
    let graphResult;
    try {
      graphResult = await run({ sessionId, userQuery, existingProfile, conversationHistory: updatedHistory });
    } catch (err) {
      setSession(sessionId, { ...session, phase: 'error' });
      return graphErrorResponse(sessionId, err);
    }
    const recs = (graphResult.finalRecommendations ?? []) as RecommendationResult[];
    console.log(`[chatService] session=${sessionId} graph done recs=${recs.length}`);

    setSession(sessionId, { ...session, phase: 'done' });
    return recs.length === 0 ? noProductsFound() : recommendationsResponse(recs);
  }

  // ── DONE / ERROR — restart ─────────────────────────────────────────────────
  if (session.phase === 'done' || session.phase === 'error') {
    setSession(sessionId, {
      ...createSession(sessionId),
      phase: 'collecting',
      profile: { userQuery: message, questionIndex: 0, answers: {} },
    });
    return {
      messages: [msg('assistant', `Starting a new search. First question:\n\n${PROFILE_QUESTIONS[0].text}`)],
      phase: 'collecting',
    };
  }

  return { messages: [msg('assistant', 'Tell me about your skin or hair concern to get started.')], phase: 'collecting' };
}
