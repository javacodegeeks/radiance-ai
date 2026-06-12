import type { RecommendationResult } from '@/types/chat';

interface Props {
  rec: RecommendationResult;
  rank: number;
}

const SAFETY_BADGE: Record<RecommendationResult['safetyStatus'], { label: string; cls: string }> = {
  safe:    { label: 'Safe',    cls: 'bg-green-100 text-green-700' },
  caution: { label: 'Caution', cls: 'bg-amber-100 text-amber-700' },
  unsafe:  { label: 'Unsafe',  cls: 'bg-red-100   text-red-700'   },
};

export function RecommendationCard({ rec, rank }: Props) {
  const badge = SAFETY_BADGE[rec.safetyStatus];

  return (
    <div className="bg-white border border-rose-100 rounded-2xl p-4 shadow-sm space-y-3">
      {/* Title row */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-rose-400">#{rank}</span>
            <h3 className="font-semibold text-gray-900 text-sm">{rec.name}</h3>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{rec.brand}</p>
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${badge.cls}`}>
          {badge.label}
        </span>
      </div>

      {/* Relevance */}
      {rec.relevanceToQuery && (
        <p className="text-sm text-gray-700 leading-relaxed">{rec.relevanceToQuery}</p>
      )}

      {/* Reasoning */}
      {rec.reasoning && (
        <div>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Why it works</p>
          <p className="text-sm text-gray-600 leading-relaxed">{rec.reasoning}</p>
        </div>
      )}

      {/* Usage tips */}
      {rec.usageTips && rec.usageTips.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">How to use</p>
          <ul className="space-y-1">
            {rec.usageTips.map((tip, i) => (
              <li key={i} className="text-sm text-gray-600 flex gap-2">
                <span className="text-rose-400 shrink-0">•</span>
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Safety notes (caution only) */}
      {rec.safetyNotes && rec.safetyStatus === 'caution' && (
        <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
          Note: {rec.safetyNotes}
        </p>
      )}

      {/* Availability + categories */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {rec.availabilityNotes && (
          <span className="text-xs text-gray-400">{rec.availabilityNotes}</span>
        )}
        {rec.categories.slice(0, 3).map(cat => (
          <span key={cat} className="text-xs bg-rose-50 text-rose-500 px-2 py-0.5 rounded-full">
            {cat}
          </span>
        ))}
        {rec.sourceUrl && (
          <a
            href={rec.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-rose-400 hover:text-rose-600 underline ml-auto"
          >
            View product
          </a>
        )}
      </div>
    </div>
  );
}
