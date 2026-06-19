import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getSession, setSession, createSession } from '@/lib/session';
import type { QuestioningState } from '@/lib/session';
import { invokeGraph } from '@/lib/aiClient';
import type { ChatMessage, ChatResponse, RecommendationResult } from '@/types/chat';

// Must run in the Node.js runtime — LangGraph uses Node.js-only APIs.
export const runtime = 'nodejs';

// ─── Profile collection questions ─────────────────────────────────────────────
// Order matters: each answer is stored by `key` and forwarded to the AI layer.
const PROFILE_QUESTIONS: { key: string; text: string }[] = [
  {
    key:  'country',
    text: 'Which country are you based in? (e.g. UK, US, France)',
  },
  {
    key:  'skinType',
    text: 'How would you describe your skin type? (dry / oily / combination / normal / sensitive)',
  },
  {
    key:  'allergies',
    text: 'Any known ingredient allergies or sensitivities? (type "none" if not)',
  },
  {
    key:  'conditions',
    text: 'Any health conditions we should be aware of? e.g. pregnancy, rosacea — type "none" if not',
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function msg(role: ChatMessage['role'], content: string): ChatMessage {
  return { id: uuidv4(), role, content, timestamp: new Date().toISOString() };
}

function parseList(raw: string): string[] {
  if (!raw || raw.trim().toLowerCase() === 'none') return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const { sessionId, message } = (await request.json()) as {
      sessionId: string;
      message: string;
    };

    let session = getSession(sessionId) ?? createSession(sessionId);

    // ── INIT: first message becomes the user's query ──────────────────────────
    if (session.phase === 'init') {
      const newSession = {
        ...session,
        phase:   'collecting' as const,
        profile: { userQuery: message, questionIndex: 0, answers: {} },
      };
      setSession(sessionId, newSession);

      const firstQ = PROFILE_QUESTIONS[0];
      return NextResponse.json<ChatResponse>({
        messages: [
          msg('assistant', `Got it. A few quick questions to personalise your recommendations.\n\n${firstQ.text}`),
        ],
        phase: 'collecting',
      });
    }

    // ── COLLECTING: record answer, advance to next question or run graph ──────
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
        return NextResponse.json<ChatResponse>({
          messages: [msg('assistant', PROFILE_QUESTIONS[nextIndex].text)],
          phase:    'collecting',
        });
      }

      // All answers collected — invoke the graph
      setSession(sessionId, { ...session, phase: 'processing' });

      const existingProfile = {
        country:    updAnswers['country'],
        skinType:   updAnswers['skinType'],
        allergies:  parseList(updAnswers['allergies']  ?? ''),
        conditions: parseList(updAnswers['conditions'] ?? ''),
      };

      let graphResult;
      try {
        graphResult = await invokeGraph({ sessionId, userQuery, existingProfile });
      } catch (err) {
        setSession(sessionId, { ...session, phase: 'error' });
        return NextResponse.json<ChatResponse>({
          messages: [msg('assistant', 'Something went wrong while analysing your query. Please try again.')],
          phase:    'error',
          error:    err instanceof Error ? err.message : String(err),
        });
      }

      // Graph needs more info — enter questioning phase
      if (graphResult.pendingQuestions && graphResult.pendingQuestions.length > 0) {
        const questioningState: QuestioningState = {
          userQuery,
          existingProfile,
          pendingQuestions: graphResult.pendingQuestions,
          questionIndex:    0,
          conversationHistory: [],
        };
        setSession(sessionId, { ...session, phase: 'questioning', questioning: questioningState });
        return NextResponse.json<ChatResponse>({
          messages: [msg('assistant', graphResult.pendingQuestions[0])],
          phase:    'questioning',
        });
      }

      return buildRecommendationResponse(session, sessionId, graphResult);
    }

    // ── QUESTIONING: collect answers to LLM follow-up questions, then resume ──
    if (session.phase === 'questioning' && session.questioning) {
      const { pendingQuestions, questionIndex, conversationHistory, userQuery, existingProfile } = session.questioning;
      const currentQ = pendingQuestions[questionIndex];

      const now = new Date();
      const updatedHistory = [
        ...conversationHistory.map(m => ({ ...m, timestamp: now })),
        { role: 'assistant' as const, content: currentQ, timestamp: now },
        { role: 'user'      as const, content: message,  timestamp: now },
      ];

      const nextIndex = questionIndex + 1;

      if (nextIndex < pendingQuestions.length) {
        setSession(sessionId, {
          ...session,
          questioning: { ...session.questioning, questionIndex: nextIndex, conversationHistory: updatedHistory },
        });
        return NextResponse.json<ChatResponse>({
          messages: [msg('assistant', pendingQuestions[nextIndex])],
          phase:    'questioning',
        });
      }

      // All questions answered — resume graph with conversation history
      setSession(sessionId, { ...session, phase: 'processing' });
      let graphResult;
      try {
        graphResult = await invokeGraph({ sessionId, userQuery, existingProfile, conversationHistory: updatedHistory });
      } catch (err) {
        setSession(sessionId, { ...session, phase: 'error' });
        return NextResponse.json<ChatResponse>({
          messages: [msg('assistant', 'Something went wrong while analysing your query. Please try again.')],
          phase:    'error',
          error:    err instanceof Error ? err.message : String(err),
        });
      }

      return buildRecommendationResponse(session, sessionId, graphResult);
    }

    // ── DONE / ERROR: treat next message as a fresh query ─────────────────────
    if (session.phase === 'done' || session.phase === 'error') {
      const fresh = {
        ...createSession(sessionId),
        phase:   'collecting' as const,
        profile: { userQuery: message, questionIndex: 0, answers: {} },
      };
      setSession(sessionId, fresh);

      const firstQ = PROFILE_QUESTIONS[0];
      return NextResponse.json<ChatResponse>({
        messages: [
          msg('assistant', `Starting a new search. First question:\n\n${firstQ.text}`),
        ],
        phase: 'collecting',
      });
    }

    return NextResponse.json<ChatResponse>({
      messages: [msg('assistant', 'Tell me about your skin or hair concern to get started.')],
      phase:    'collecting',
    });
  } catch (error) {
    return NextResponse.json<ChatResponse>(
      {
        messages: [],
        phase:    'error',
        error:    error instanceof Error ? error.message : 'Unexpected server error',
      },
      { status: 500 },
    );
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildRecommendationResponse(
  session: ReturnType<typeof createSession>,
  sessionId: string,
  graphResult: Awaited<ReturnType<typeof invokeGraph>>,
): ReturnType<typeof NextResponse.json<ChatResponse>> {
  setSession(sessionId, { ...session, phase: 'done' });

  const recs = (graphResult.finalRecommendations ?? []) as RecommendationResult[];
  if (recs.length === 0) {
    return NextResponse.json<ChatResponse>({
      messages: [
        msg('assistant', "I couldn't find suitable products for your concern right now. Try rephrasing or starting a new search."),
      ],
      phase:           'done',
      recommendations: [],
    });
  }

  return NextResponse.json<ChatResponse>({
    messages: [msg('assistant', 'Here are your personalised recommendations based on your concern:')],
    phase:           'done',
    recommendations: recs,
  });
}
