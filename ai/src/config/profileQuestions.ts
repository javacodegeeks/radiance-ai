/**
 * User-facing question configuration — single source of truth for all
 * questions asked during profile collection and LLM fallback.
 *
 * PROFILE_QUESTIONS drives the sequential collecting phase in chatService.
 * FALLBACK_QUESTIONS drives the static fallback in the questioner agent.
 *
 * Changing question text requires editing only this file.
 */

export interface ProfileQuestion {
  key: string;
  text: string;
}

/** Sequential questions collected before the first graph invocation. */
export const PROFILE_QUESTIONS: ProfileQuestion[] = [
  { key: 'country',    text: 'Which country are you based in? (e.g. UK, US, France)' },
  { key: 'skinType',   text: 'How would you describe your skin type? (dry / oily / combination / normal / sensitive)' },
  { key: 'allergies',  text: 'Any known ingredient allergies or sensitivities? (type "none" if not)' },
  { key: 'conditions', text: 'Any health conditions we should be aware of? e.g. pregnancy, rosacea — type "none" if not' },
];

/**
 * Fallback questions used by the questioner agent when the LLM call fails.
 * Keyed by profile field name so the agent can ask only about missing fields.
 */
export const FALLBACK_QUESTIONS: Record<string, string> = {
  country:    'Which country are you in? (This helps us find products available near you.)',
  allergies:  'Do you have any known ingredient allergies or sensitivities? (e.g. fragrance, nuts, preservatives — or "none")',
  skinType:   'How would you describe your skin type? (e.g. oily, dry, combination, sensitive, normal)',
  conditions: 'Are you pregnant, breastfeeding, or do you have any relevant skin conditions? (or "none")',
  concerns:   'What is your main skin/hair concern right now?',
};
