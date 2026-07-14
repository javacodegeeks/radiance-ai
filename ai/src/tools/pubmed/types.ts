// ─── Article type filters ─────────────────────────────────────────────────────

export type ArticleTypeFilter =
  | 'rct'
  | 'systematic_review'
  | 'meta_analysis'
  | 'clinical_trial';

// ─── Search options ───────────────────────────────────────────────────────────

export interface SearchFilters {
  /** YYYY/MM/DD */
  dateFrom?: string;
  /** YYYY/MM/DD */
  dateTo?: string;
  articleTypes?: ArticleTypeFilter[];
  freeFullText?: boolean;
  /** Pagination offset (0-based) */
  retstart?: number;
  maxResults?: number;
}

// ─── Normalised domain model ──────────────────────────────────────────────────

export interface NormalizedArticle {
  pmid: string;
  title: string;
  authors: string[];
  journal: string;
  publicationDate: string;
  doi: string | null;
  abstract: string;
  articleTypes: string[];
  /** 0–1 relevance score derived from esearch rank position */
  relevanceScore: number;
}

export interface PubMedSearchResult {
  query: string;
  totalFound: number;
  returnedCount: number;
  articles: NormalizedArticle[];
}

// ─── Raw NCBI response shapes ─────────────────────────────────────────────────

export interface RawEsearchResponse {
  esearchresult: {
    count: string;
    retmax: string;
    retstart: string;
    idlist: string[];
    errorlist?: {
      phrasesnotfound?: string[];
      fieldsnotfound?: string[];
    };
    warninglist?: {
      phrasesignored?: string[];
      quotedphrasesnotfound?: string[];
      outputmessages?: string[];
    };
  };
}

export interface RawEsummaryAuthor {
  name: string;
  authtype?: string;
  clusterid?: string;
}

export interface RawEsummaryArticleId {
  idtype: string;
  idtypen: number;
  value: string;
}

export interface RawEsummaryDocsum {
  uid: string;
  pubdate?: string;
  epubdate?: string;
  source?: string;
  authors?: RawEsummaryAuthor[];
  lastauthor?: string;
  title?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  elocationid?: string;
  fulljournalname?: string;
  articleids?: RawEsummaryArticleId[];
  pubtype?: string[];
  [key: string]: unknown;
}

export interface RawEsummaryResponse {
  result: {
    uids: string[];
    [pmid: string]: RawEsummaryDocsum | string[];
  };
}

// ─── Error types ──────────────────────────────────────────────────────────────

export type PubMedErrorCode =
  | 'SEARCH_FAILED'
  | 'METADATA_FAILED'
  | 'ABSTRACT_FAILED'
  | 'NO_RESULTS'
  | 'INVALID_QUERY'
  | 'RATE_LIMITED'
  | 'PARSE_ERROR'
  | 'NETWORK_ERROR';

export class PubMedError extends Error {
  constructor(
    public readonly code: PubMedErrorCode,
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PubMedError';
  }
}
