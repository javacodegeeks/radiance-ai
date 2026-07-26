import { normalizeAllergies, normalizeConditions } from '../../src/common/allergyNormalizer';

describe('normalizeAllergies', () => {
  it('returns [] for null, undefined, or empty input', () => {
    expect(normalizeAllergies(null)).toEqual([]);
    expect(normalizeAllergies(undefined)).toEqual([]);
    expect(normalizeAllergies('')).toEqual([]);
  });

  it('maps a known alias to its contraindication tag', () => {
    expect(normalizeAllergies('nuts')).toEqual(['nut_allergy']);
    expect(normalizeAllergies('shrimp')).toEqual(['shellfish_allergy']);
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(normalizeAllergies(' Peanuts ')).toEqual(['peanut_allergy']);
    expect(normalizeAllergies('MILK')).toEqual(['milk_allergy']);
  });

  it('splits a comma-separated string into multiple normalized entries', () => {
    expect(normalizeAllergies('nuts, milk, shrimp')).toEqual([
      'nut_allergy',
      'milk_allergy',
      'shellfish_allergy',
    ]);
  });

  it('accepts an array of allergy strings as well', () => {
    expect(normalizeAllergies(['nuts', 'milk'])).toEqual(['nut_allergy', 'milk_allergy']);
  });

  it('passes through unrecognized terms unchanged (lowercased) instead of dropping them', () => {
    expect(normalizeAllergies('Latex')).toEqual(['latex']);
  });
});

describe('normalizeConditions', () => {
  it('returns [] for null, undefined, or empty input', () => {
    expect(normalizeConditions(null)).toEqual([]);
    expect(normalizeConditions(undefined)).toEqual([]);
    expect(normalizeConditions('')).toEqual([]);
  });

  it('maps known condition phrases to their tag', () => {
    expect(normalizeConditions('expecting a baby')).toEqual(['pregnancy']);
    expect(normalizeConditions('Pregnant')).toEqual(['pregnancy']);
    expect(normalizeConditions('rosacea')).toEqual(['rosacea']);
  });

  it('passes through unrecognized conditions unchanged (lowercased)', () => {
    expect(normalizeConditions('Eczema')).toEqual(['eczema']);
  });
});
