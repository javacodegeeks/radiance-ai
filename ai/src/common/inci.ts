import { chatCompletion } from '../llm/client';
import { PRODUCT_FINDER_INCI_SYSTEM } from '../llm/prompts';
import { LlmCallError } from '../common/errors';

export async function findIngredients(content: string): Promise<string | null> {
  const normalizedContent = content.trim();
  if (!normalizedContent) return null;

  try {
    console.log('[productFinder] prompt=PRODUCT_FINDER_INCI_SYSTEM');
    const rawText = (await chatCompletion('productFinder', [
      { role: 'system', content: PRODUCT_FINDER_INCI_SYSTEM },
      { role: 'user',   content: `Return a comma-separated INCI-formatted list of the most suitable ingredients for: ${normalizedContent}\n\nRespond with ONLY the comma-separated list or "Unknown". No other text.` },
    ])).trim();
    return extractInciList(rawText);
  } catch (error) {
    const e = new LlmCallError('productFinder', 'Ingredient proposition failed', error);
    console.error(`[productFinder] ${e.name}: ${e.message}`, error);
    return null;
  }
}

/**
 * Extract comma-separated INCI ingredient list from potentially chatty LLM response.
 */
function extractInciList(text: string): string | null {
  const normalized = text.trim();

  if (!normalized || /^unknown$/i.test(normalized) || /(no ingredient|unable to determine|n\/a)/i.test(normalized)) {
    return null;
  }

  if (normalized.length < 200 && normalized.includes(',')) {
    return normalized;
  }

  const lines = normalized.split(/[.\n]+/).filter((line) => line.trim());

  let bestMatch: string | null = null;
  let bestMatchCount = 0;

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (/:\s*$/.test(trimmedLine)) continue;
    if (/\b(recommend|following|provide|making|suitable|properties)\b/i.test(trimmedLine)) continue;
    if (/^(for|these|here|the|to|and|i)\s+/i.test(trimmedLine) && trimmedLine.split(',').length < 3) continue;

    if (trimmedLine.includes(',')) {
      const itemCount = trimmedLine.split(',').length;
      if (itemCount >= 2 && itemCount > bestMatchCount) {
        bestMatch = trimmedLine;
        bestMatchCount = itemCount;
      }
    }
  }

  return bestMatch;
}