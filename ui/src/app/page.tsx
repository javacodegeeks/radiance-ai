'use client';

import { useRef, useEffect } from 'react';
import { useChat } from '@/hooks/useChat';
import { MessageBubble } from '@/components/MessageBubble';
import { RecommendationCard } from '@/components/RecommendationCard';
import { InputBar } from '@/components/InputBar';

export default function Home() {
  const { messages, phase, recommendations, isLoading, sendMessage, restart } = useChat();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, recommendations, isLoading]);

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-white border-b border-rose-100 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-rose-600">Radiance AI</h1>
          <p className="text-xs text-gray-400">Personalised cosmetic recommendations</p>
        </div>
        {phase === 'done' && (
          <button
            onClick={restart}
            className="text-sm text-rose-500 hover:text-rose-700 font-medium transition-colors"
          >
            New search
          </button>
        )}
      </header>

      {/* Chat stream */}
      <main className="flex-1 overflow-y-auto px-4 py-6 space-y-4 chat-scroll">
        {messages.map(m => (
          <MessageBubble key={m.id} message={m} />
        ))}

        {/* Typing indicator */}
        {isLoading && (
          <div className="flex items-center gap-2 text-gray-400 text-sm pl-2">
            <span className="animate-pulse">Analysing</span>
            <span className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-rose-300 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 bg-rose-300 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 bg-rose-300 rounded-full animate-bounce [animation-delay:300ms]" />
            </span>
          </div>
        )}

        {/* Recommendation cards (shown inline after the final message) */}
        {recommendations.length > 0 && (
          <div className="space-y-3 pt-2">
            {recommendations.map((r, i) => (
              <RecommendationCard key={`${r.name}-${i}`} rec={r} rank={i + 1} />
            ))}
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      {/* Input */}
      <InputBar
        onSend={sendMessage}
        disabled={isLoading || phase === 'processing'}
        placeholder={
          phase === 'done'
            ? 'Ask a follow-up or type a new concern...'
            : 'Type your answer...'
        }
      />
    </div>
  );
}
