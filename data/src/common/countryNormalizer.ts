/**
 * Country & continent normalizer
 *
 * Converts comma-separated country/continent names (with optional language prefixes)
 * into normalized ISO 3166-1 alpha-2 country codes.
 *
 * Includes LLM fallback for unrecognized country names (if LLM credentials are available).
 *
 * Examples:
 *   "Switzerland,United States" → ["CH", "US"]
 *   "France, en:morocco" → ["FR", "MA"]
 *   "Switzerland,United States,Europe" → ["CH", "US", "AT", "BE", "BG", ...]
 *   "World" → [all country codes]
 *   "Helvetia" → calls LLM → ["CH"] (if LLM can identify it)
 */

import fs from 'fs';
import path from 'path';

// ISO 3166-1 alpha-2 country codes mapped by name (in English)
const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  // A
  afghanistan: 'AF', albania: 'AL', algeria: 'DZ', 'american samoa': 'AS', andorra: 'AD',
  angola: 'AO', anguilla: 'AI', 'antigua and barbuda': 'AG', argentina: 'AR', armenia: 'AM',
  aruba: 'AW', australia: 'AU', austria: 'AT', azerbaijan: 'AZ',
  // B
  bahamas: 'BS', bahrain: 'BH', bangladesh: 'BD', barbados: 'BB', belarus: 'BY',
  belgium: 'BE', belize: 'BZ', benin: 'BJ', bhutan: 'BT', bolivia: 'BO',
  'bosnia and herzegovina': 'BA', botswana: 'BW', brazil: 'BR', brunei: 'BN', bulgaria: 'BG',
  'burkina faso': 'BF', burundi: 'BI',
  // C
  cambodia: 'KH', cameroon: 'CM', canada: 'CA', 'cape verde': 'CV', 'cayman islands': 'KY',
  'central african republic': 'CF', chad: 'TD', chile: 'CL', china: 'CN', 'christmas island': 'CX',
  'cocos islands': 'CC', colombia: 'CO', comoros: 'KM', congo: 'CG', 'congo (drc)': 'CD',
  'cook islands': 'CK', 'costa rica': 'CR', croatia: 'HR', cuba: 'CU',
  cyprus: 'CY', 'czech republic': 'CZ', czechia: 'CZ',
  // D
  denmark: 'DK', djibouti: 'DJ', dominica: 'DM', 'dominican republic': 'DO',
  // E
  ecuador: 'EC', egypt: 'EG', 'el salvador': 'SV', 'equatorial guinea': 'GQ', eritrea: 'ER',
  estonia: 'EE', eswatini: 'SZ', ethiopia: 'ET',
  // F
  'falkland islands': 'FK', 'faroe islands': 'FO', fiji: 'FJ', finland: 'FI', france: 'FR',
  'french guiana': 'GF', 'french polynesia': 'PF',
  // G
  gabon: 'GA', gambia: 'GM', georgia: 'GE', germany: 'DE', ghana: 'GH',
  gibraltar: 'GI', greece: 'GR', greenland: 'GL', grenada: 'GD', guadeloupe: 'GP', guam: 'GU',
  guatemala: 'GT', guernsey: 'GG', guinea: 'GN', 'guinea-bissau': 'GW', guyana: 'GY',
  // H
  haiti: 'HT', 'heard island': 'HM', honduras: 'HN', 'hong kong': 'HK', hungary: 'HU',
  // I
  iceland: 'IS', india: 'IN', indonesia: 'ID', iran: 'IR', iraq: 'IQ',
  ireland: 'IE', 'isle of man': 'IM', israel: 'IL', italy: 'IT', 'ivory coast': 'CI',
  // J
  jamaica: 'JM', japan: 'JP', jersey: 'JE', jordan: 'JO',
  // K
  kazakhstan: 'KZ', kenya: 'KE', kiribati: 'KI', korea: 'KR', 'south korea': 'KR', 'north korea': 'KP',
  kuwait: 'KW', kyrgyzstan: 'KG',
  // L
  laos: 'LA', latvia: 'LV', lebanon: 'LB', lesotho: 'LS', liberia: 'LR',
  libya: 'LY', liechtenstein: 'LI', lithuania: 'LT', luxembourg: 'LU',
  // M
  macau: 'MO', madagascar: 'MG', malawi: 'MW', malaysia: 'MY', maldives: 'MV',
  mali: 'ML', malta: 'MT', 'marshall islands': 'MH', martinique: 'MQ', mauritania: 'MR',
  mauritius: 'MU', mayotte: 'YT', mexico: 'MX', micronesia: 'FM', moldova: 'MD',
  monaco: 'MC', mongolia: 'MN', montenegro: 'ME', montserrat: 'MS', morocco: 'MA', mozambique: 'MZ',
  myanmar: 'MM',
  // N
  namibia: 'NA', nauru: 'NR', nepal: 'NP', netherlands: 'NL', 'new caledonia': 'NC',
  'new zealand': 'NZ', nicaragua: 'NI', niger: 'NE', nigeria: 'NG', niue: 'NU',
  'norfolk island': 'NF', 'north macedonia': 'MK', 'northern mariana islands': 'MP', norway: 'NO',
  // O
  oman: 'OM',
  // P
  pakistan: 'PK', palau: 'PW', palestine: 'PS', panama: 'PA', 'papua new guinea': 'PG',
  paraguay: 'PY', peru: 'PE', philippines: 'PH', 'pitcairn islands': 'PN', poland: 'PL',
  portugal: 'PT', 'puerto rico': 'PR',
  // Q
  qatar: 'QA',
  // R
  reunion: 'RE', romania: 'RO', russia: 'RU', 'russian federation': 'RU', rwanda: 'RW',
  // S
  'saint barthelemy': 'BL', 'saint kitts and nevis': 'KN', 'saint lucia': 'LC',
  'saint martin': 'MF', 'saint pierre and miquelon': 'PM', 'saint vincent and the grenadines': 'VC',
  samoa: 'WS', 'san marino': 'SM', 'sao tome and principe': 'ST', 'saudi arabia': 'SA',
  senegal: 'SN', serbia: 'RS', seychelles: 'SC', 'sierra leone': 'SL', singapore: 'SG',
  'sint maarten': 'SX', slovakia: 'SK', slovenia: 'SI', 'solomon islands': 'SB',
  somalia: 'SO', 'south africa': 'ZA', 'south sudan': 'SS', spain: 'ES', 'sri lanka': 'LK',
  sudan: 'SD', suriname: 'SR', sweden: 'SE', switzerland: 'CH', syria: 'SY',
  // T
  taiwan: 'TW', tajikistan: 'TJ', tanzania: 'TZ', thailand: 'TH', 'timor-leste': 'TL',
  togo: 'TG', tokelau: 'TK', tonga: 'TO', 'trinidad and tobago': 'TT', tunisia: 'TN',
  turkey: 'TR', turkmenistan: 'TM', 'turks and caicos islands': 'TC', tuvalu: 'TV',
  // U
  uganda: 'UG', ukraine: 'UA', 'united arab emirates': 'AE', 'united kingdom': 'GB', 'united states': 'US',
  'us minor outlying islands': 'UM', uruguay: 'UY', uzbekistan: 'UZ',
  // V
  vanuatu: 'VU', 'vatican city': 'VA', venezuela: 'VE', vietnam: 'VN',
  'virgin islands (british)': 'VG', 'virgin islands (us)': 'VI',
  // W
  'wallis and futuna': 'WF', 'western sahara': 'EH',
  // Y
  yemen: 'YE',
  // Z
  zambia: 'ZM', zimbabwe: 'ZW',
};

// Continent to country codes mapping
const CONTINENT_TO_COUNTRIES: Record<string, string[]> = {
  africa: [
    'DZ', 'AO', 'BJ', 'BW', 'BF', 'BI', 'CM', 'CV', 'CF', 'TD', 'KM', 'CG', 'CD',
    'CI', 'DJ', 'EG', 'GQ', 'ER', 'ET', 'GA', 'GM', 'GH', 'GN', 'GW', 'KE', 'LS',
    'LR', 'LY', 'MG', 'MW', 'ML', 'MR', 'MU', 'MA', 'MZ', 'NA', 'NE', 'NG', 'RW',
    'ST', 'SN', 'SC', 'SL', 'SO', 'ZA', 'SS', 'SD', 'SZ', 'TZ', 'TG', 'TN', 'UG',
    'EH', 'ZM', 'ZW',
  ],
  antarctica: ['AQ', 'GS', 'TF', 'HM', 'BV'],
  asia: [
    'AF', 'AM', 'AZ', 'BH', 'BD', 'BT', 'BN', 'KH', 'CN', 'GE', 'HK', 'IN', 'ID',
    'IR', 'IQ', 'IL', 'JP', 'JO', 'KZ', 'KP', 'KR', 'KW', 'KG', 'LA', 'LB', 'MO',
    'MY', 'MV', 'MN', 'MM', 'NP', 'OM', 'PK', 'PS', 'PH', 'QA', 'SA', 'SG', 'LK',
    'SY', 'TW', 'TJ', 'TH', 'TL', 'TR', 'TM', 'AE', 'UZ', 'VN', 'YE',
  ],
  europe: [
    'AL', 'AD', 'AT', 'BY', 'BE', 'BA', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FO',
    'FI', 'FR', 'DE', 'GI', 'GR', 'HU', 'IS', 'IE', 'IM', 'IT', 'JE', 'LV', 'LI',
    'LT', 'LU', 'MT', 'MD', 'MC', 'ME', 'NL', 'NO', 'PL', 'PT', 'RO', 'RU', 'SM',
    'RS', 'SK', 'SI', 'ES', 'SE', 'CH', 'UA', 'GB', 'VA',
  ],
  'north america': [
    'AI', 'AG', 'AW', 'BS', 'BB', 'BZ', 'CA', 'KY', 'CR', 'CU', 'DM', 'DO', 'SV',
    'GL', 'GD', 'GP', 'GT', 'HT', 'HN', 'JM', 'MQ', 'MX', 'MS', 'NI', 'PA', 'PM',
    'PR', 'BL', 'KN', 'LC', 'MF', 'VC', 'TT', 'TC', 'US', 'VG', 'VI',
  ],
  'south america': [
    'AR', 'BO', 'BR', 'CL', 'CO', 'EC', 'FK', 'GF', 'GY', 'PY', 'PE', 'SR', 'UY', 'VE',
  ],
  oceania: [
    'AS', 'AU', 'CX', 'CC', 'CK', 'FJ', 'PF', 'GU', 'HM', 'KI', 'MH', 'FM', 'NR',
    'NU', 'NF', 'MP', 'PW', 'PG', 'PN', 'WS', 'SB', 'TK', 'TO', 'TV', 'UM', 'VU', 'WF', 'NZ',
  ],
};

// All world country codes (flattened from continents, with some extras)
const ALL_WORLD_CODES = Array.from(
  new Set(Object.values(CONTINENT_TO_COUNTRIES).flat()),
);

// Set of all valid country codes for fast lookup
const VALID_COUNTRY_CODES = new Set([
  ...Object.values(COUNTRY_NAME_TO_CODE),
  ...ALL_WORLD_CODES,
]);

const CACHE_DIR = path.join(__dirname, '..', '..', '.cache');
const LLM_COUNTRY_CACHE_FILE = path.join(CACHE_DIR, 'llm-country-cache.json');

// LLM lookup tuning
const MAX_COUNTRY_NAME_LENGTH = 100;
const FLUSH_EVERY_N_WRITES = 10;

const LLM_COUNTRY_IDENTIFIER_PROMPT = `
You are an ISO 3166-1 alpha-2 country code identifier.

Given a single country or official ISO territory name (including common aliases, abbreviations, misspellings, historical names, and names in any language), return ONLY its ISO 3166-1 alpha-2 country code as exactly two uppercase letters.

Trim leading and trailing whitespace and ignore letter case before matching.

Do not infer a country from cities, states, provinces, regions, continents, organizations, trade blocs, languages, nationalities, adjectives, landmarks, or incomplete text.

When in doubt, return UNKNOWN rather than guessing.

Return only the two-letter ISO code or UNKNOWN. Do not include explanations, punctuation, whitespace, markdown, quotes, or any additional text.
`;

function loadLlmCountryCacheFromFile(cacheFile = LLM_COUNTRY_CACHE_FILE): Map<string, string | null> {
  try {
    if (!fs.existsSync(cacheFile)) {
      return new Map();
    }

    const raw = fs.readFileSync(cacheFile, 'utf8').trim();
    if (!raw) {
      return new Map();
    }

    const parsed = JSON.parse(raw) as Record<string, string | null>;
    return new Map(Object.entries(parsed));
  } catch (err) {
    console.warn(`[countryNormalizer] Could not read LLM country cache: ${err instanceof Error ? err.message : String(err)}`);
    return new Map();
  }
}

function persistLlmCountryCacheToFile(cache: Map<string, string | null>, cacheFile = LLM_COUNTRY_CACHE_FILE): void {
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(Object.fromEntries(cache), null, 2));
  } catch (err) {
    console.warn(`[countryNormalizer] Could not write LLM country cache: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Cache for LLM-identified country codes to minimize API calls.
// Maps a normalized country name → ISO code (or null if the LLM confidently returned UNKNOWN).
const llmCountryCache = loadLlmCountryCacheFromFile();

// De-dupes concurrent lookups for the same country name so a burst of pipeline
// calls for the same unrecognized name doesn't fire multiple LLM requests.
const llmInFlightRequests = new Map<string, Promise<string | null>>();

let pendingWritesSinceFlush = 0;

function flushLlmCountryCacheToDisk(): void {
  persistLlmCountryCacheToFile(llmCountryCache);
  pendingWritesSinceFlush = 0;
}

/**
 * Cache a confident LLM result and periodically flush to disk so long-running
 * pipeline processes don't lose accumulated lookups on crash — the exit hook
 * alone only covers graceful shutdowns.
 */
function cacheConfidentResult(cacheKey: string, value: string | null): void {
  llmCountryCache.set(cacheKey, value);
  pendingWritesSinceFlush++;
  if (pendingWritesSinceFlush >= FLUSH_EVERY_N_WRITES) {
    flushLlmCountryCacheToDisk();
  }
}

/** Lowercase + hyphen-to-space normalization shared by dictionary lookups and the LLM cache key. */
function normalizeForLookup(name: string): string {
  return name.replaceAll('-', ' ').trim().toLowerCase();
}

/**
 * Call the LLM to identify a country code from an unrecognized country name.
 *
 * Only confident results are cached:
 * - a valid ISO code returned by the model
 * - an explicit "UNKNOWN" (the model looked and found nothing)
 *
 * Transient failures (network errors, non-2xx responses, missing
 * credentials) return null WITHOUT caching, so the same name can be retried
 * on a later run once the underlying issue is resolved.
 */
async function performLlmLookup(countryName: string, cacheKey: string): Promise<string | null> {
  const baseUrl = process.env.LITELLM_BASE_URL;
  const apiKey = process.env.LITELLM_API_KEY;
  const model = process.env.LLM_MODEL;

  if (!baseUrl || !apiKey || !model) {
    return null; // LLM not configured — nothing was determined, don't cache
  }

  if (countryName.length > MAX_COUNTRY_NAME_LENGTH) {
    console.warn(`[countryNormalizer] Skipping LLM lookup — name too long (${countryName.length} chars)`);
    return null; // data-quality issue, not a confident negative — don't cache
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 10,
        messages: [
          { role: 'system', content: LLM_COUNTRY_IDENTIFIER_PROMPT },
          { role: 'user', content: countryName },
        ],
      }),
    });

    if (!response.ok) {
      console.warn(`[countryNormalizer] LLM request failed: ${response.status} (not cached — will retry later)`);
      return null; // transient failure — do NOT cache
    }

    const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content?.trim() ?? '';

    // Confident positive: a valid 2-letter code
    if (content.length === 2 && VALID_COUNTRY_CODES.has(content.toUpperCase())) {
      const code = content.toUpperCase();
      cacheConfidentResult(cacheKey, code);
      console.log(`[countryNormalizer] LLM identified "${countryName}" as "${code}"`);
      return code;
    }

    // Confident negative: the model explicitly declined to guess (e.g. "UNKNOWN")
    cacheConfidentResult(cacheKey, null);
    return null;
  } catch (err) {
    console.warn(
      `[countryNormalizer] LLM call error: ${err instanceof Error ? err.message : String(err)} (not cached — will retry later)`,
    );
    return null; // network error — do NOT cache
  }
}

/**
 * Identify a country code via LLM, with result caching and in-flight de-duplication.
 */
async function identifyCountryViaLlm(countryName: string): Promise<string | null> {
  const cacheKey = normalizeForLookup(countryName);

  const cached = llmCountryCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const inFlight = llmInFlightRequests.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const promise = performLlmLookup(countryName, cacheKey);
  llmInFlightRequests.set(cacheKey, promise);

  try {
    return await promise;
  } finally {
    llmInFlightRequests.delete(cacheKey);
  }
}

/**
 * Normalize a country/continent string to an array of ISO 3166-1 alpha-2 country codes.
 *
 * Handles:
 * - Plain country names: "Switzerland" → ["CH"]
 * - Country codes: "FR", "ch", "US" → ["FR", "CH", "US"] (normalized to uppercase)
 * - Multiple countries: "Switzerland,United States" → ["CH", "US"]
 * - Language prefixes: "en:Morocco" → ["MA"]
 * - Continents: "Europe" → [all European country codes]
 * - Special case "World": "World" → [all country codes]
 * - Mixed: "France, en:morocco, Europe, FR" → ["FR", "MA", ...all European codes]
 * - Unrecognized names: resolved via LLM in parallel (if configured); results are cached
 *
 * @param countries Raw comma-separated string or array of country strings
 *   (e.g., "France, en:Morocco, CH" or ["France", "en:Morocco", "CH"]).
 * @returns Promise resolving to array of unique ISO country codes, or empty array if input is invalid
 */
export async function normalizeCountries(countries: string | string[] | null | undefined): Promise<string[]> {
  if (!countries) {
    return [];
  }

  const codes = new Set<string>();

  // Accept either a comma-separated string or an array of country strings
  const entries = (typeof countries === 'string' ? [countries] : countries)
    .map(item => String(item).trim())
    .filter(Boolean)
    .flatMap(item => item.split(','))
    .map(entry => entry.trim())
    .filter(Boolean);

  // Names that couldn't be resolved locally — looked up via LLM in parallel below.
  const unresolvedNames: string[] = [];

  for (const entry of entries) {
    // Strip language prefix if present (e.g., "en:Morocco" → "Morocco")
    const countryName = entry.includes(':') ? entry.split(':')[1].trim() : entry;

    let normalized = normalizeForLookup(countryName);

    // Check if it's the entire world
    if (normalized === 'world' || normalized === 'worldwide' || normalized === 'monde' || normalized === 'all') {
      ALL_WORLD_CODES.forEach(code => codes.add(code));
      continue;
    }

    // Check if it's a country code (2 letters)
    if (normalized.length === 2) {
      const upperCode = normalized.toUpperCase();
      if (VALID_COUNTRY_CODES.has(upperCode)) {
        codes.add(upperCode);
        continue;
      }
    }

    // Try direct country name lookup
    const countryCode = COUNTRY_NAME_TO_CODE[normalized];
    if (countryCode) {
      codes.add(countryCode);
      continue;
    }

    // Try continent lookup
    if (normalized === 'eu' || normalized === 'european union') {
      normalized = 'europe';
    }
    const continentCodes = CONTINENT_TO_COUNTRIES[normalized];
    if (continentCodes) {
      continentCodes.forEach(code => codes.add(code));
      continue;
    }

    unresolvedNames.push(countryName);
  }

  // Resolve all unrecognized names via LLM in parallel — identifyCountryViaLlm
  // already de-dupes identical/concurrent lookups, so duplicates here are cheap.
  if (unresolvedNames.length > 0) {
    const llmResults = await Promise.all(
      unresolvedNames.map(name => identifyCountryViaLlm(name)),
    );

    llmResults.forEach((code, idx) => {
      if (code) {
        codes.add(code);
      } else {
        console.warn(`[countryNormalizer] Unknown country/continent: "${unresolvedNames[idx]}"`);
      }
    });
  }

  return Array.from(codes).sort();
}

process.once('exit', flushLlmCountryCacheToDisk);
