jest.mock('../../src/llm/client', () => ({
  chatCompletion: jest.fn(),
}));

import { chatCompletion } from '../../src/llm/client';
import { findIngredients } from '../../src/common/inci';

describe('findIngredients', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null without calling the LLM when the input is empty or whitespace-only', async () => {
    expect(await findIngredients('')).toBeNull();
    expect(await findIngredients('   ')).toBeNull();
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it('passes the trimmed condition through to the LLM using the "inci" preset', async () => {
    (chatCompletion as jest.Mock).mockResolvedValue('Niacinamide, Salicylic Acid');

    await findIngredients('  acne  ');

    expect(chatCompletion).toHaveBeenCalledWith('inci', [
      { role: 'system', content: expect.any(String) },
      { role: 'user', content: expect.stringContaining('acne') },
    ]);
  });

  it('returns a short comma-separated response as-is', async () => {
    (chatCompletion as jest.Mock).mockResolvedValue('Niacinamide, Salicylic Acid, Zinc PCA');

    const result = await findIngredients('acne');

    expect(result).toBe('Niacinamide, Salicylic Acid, Zinc PCA');
  });

  it('returns null when the LLM responds "Unknown"', async () => {
    (chatCompletion as jest.Mock).mockResolvedValue('Unknown');

    expect(await findIngredients('a condition with no known ingredients')).toBeNull();
  });

  it('returns null when the LLM explains it cannot determine an answer', async () => {
    (chatCompletion as jest.Mock).mockResolvedValue('I am unable to determine suitable ingredients for this.');

    expect(await findIngredients('an obscure condition')).toBeNull();
  });

  it('extracts the best comma-separated line from a chatty, multi-sentence response over 200 characters', async () => {
    // Long enough to skip the short-response fast path, so the per-line
    // extraction heuristic runs: line 1 is filtered out via the
    // recommend/following keyword regex, line 3 via the "properties"
    // keyword regex — only line 2's 5-item ingredient list survives.
    (chatCompletion as jest.Mock).mockResolvedValue(
      'For this condition, we recommend the following combination of active ingredients to help calm and repair the skin barrier over time. ' +
      'Niacinamide, Salicylic Acid, Zinc PCA, Panthenol, Ceramide NP. ' +
      'These ingredients have soothing and anti-inflammatory properties for sensitive skin over the long term.',
    );

    const result = await findIngredients('acne');

    expect(result).toBe('Niacinamide, Salicylic Acid, Zinc PCA, Panthenol, Ceramide NP');
  });

  it('returns null when a long response contains no comma-separated ingredient-list-shaped line', async () => {
    (chatCompletion as jest.Mock).mockResolvedValue(
      'For this condition it is best to consult a dermatologist directly since there is no single ' +
      'ingredient that reliably addresses every case here and providing a general answer could be ' +
      'misleading given how much the presentation varies from person to person.',
    );

    expect(await findIngredients('a rare condition')).toBeNull();
  });

  it('returns null and does not throw when the LLM call fails', async () => {
    (chatCompletion as jest.Mock).mockRejectedValue(new Error('LiteLLM unreachable'));

    const result = await findIngredients('acne');

    expect(result).toBeNull();
  });
});
