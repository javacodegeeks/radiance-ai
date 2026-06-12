'use client';

import { useState, KeyboardEvent } from 'react';

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function InputBar({ onSend, disabled = false, placeholder = 'Type a message...' }: Props) {
  const [value, setValue] = useState('');

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="px-4 py-3 bg-white border-t border-rose-100">
      <div className="flex items-end gap-3 bg-rose-50 rounded-2xl px-4 py-3 border border-rose-100">
        <textarea
          className="flex-1 bg-transparent resize-none text-sm text-gray-800 placeholder-gray-400 outline-none max-h-32 leading-relaxed"
          rows={1}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKey}
          placeholder={placeholder}
          disabled={disabled}
        />
        <button
          onClick={submit}
          disabled={disabled || !value.trim()}
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-rose-500 text-white disabled:opacity-40 hover:bg-rose-600 transition-colors"
          aria-label="Send"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
          </svg>
        </button>
      </div>
      <p className="text-xs text-gray-400 text-center mt-2">
        Press Enter to send · Shift+Enter for new line
      </p>
    </div>
  );
}
