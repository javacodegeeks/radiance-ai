'use client';

import { useState, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { ChatMessage, ChatPhase, RecommendationResult } from '@/types/chat';

const WELCOME: ChatMessage = {
  id:        uuidv4(),
  role:      'assistant',
  content:   "Hi! I'm your Radiance AI consultant. Tell me about your skin or hair concern and I'll find the right products for you.",
  timestamp: new Date().toISOString(),
};

export function useChat() {
  const [messages,        setMessages]        = useState<ChatMessage[]>([WELCOME]);
  const [phase,           setPhase]           = useState<ChatPhase>('collecting');
  const [recommendations, setRecommendations] = useState<RecommendationResult[]>([]);
  const [isLoading,       setIsLoading]       = useState(false);
  const sessionId = useRef<string>(uuidv4());

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    // Append the user's message immediately
    const userMsg: ChatMessage = {
      id:        uuidv4(),
      role:      'user',
      content:   text.trim(),
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const res  = await fetch('/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sessionId: sessionId.current, message: text.trim() }),
      });
      const data = await res.json();

      setMessages(prev => [...prev, ...data.messages]);
      setPhase(data.phase);
      if (data.recommendations) {
        setRecommendations(data.recommendations);
      }
    } catch {
      setMessages(prev => [
        ...prev,
        {
          id:        uuidv4(),
          role:      'assistant' as const,
          content:   'Something went wrong. Please try again.',
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading]);

  const restart = useCallback(() => {
    sessionId.current = uuidv4();
    setMessages([{
      ...WELCOME,
      id:        uuidv4(),
      timestamp: new Date().toISOString(),
    }]);
    setPhase('collecting');
    setRecommendations([]);
  }, []);

  return { messages, phase, recommendations, isLoading, sendMessage, restart };
}
