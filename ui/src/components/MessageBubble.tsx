import type { ChatMessage } from '@/types/chat';

interface Props {
  message: ChatMessage;
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`
          max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap
          ${isUser
            ? 'bg-rose-500 text-white rounded-br-sm'
            : 'bg-white text-gray-800 border border-rose-100 rounded-bl-sm shadow-sm'
          }
        `}
      >
        {message.content}
      </div>
    </div>
  );
}
