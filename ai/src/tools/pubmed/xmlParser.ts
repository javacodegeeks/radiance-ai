import { XMLParser } from 'fast-xml-parser';
import { PubMedError } from './types';

// ─── Parser configuration ─────────────────────────────────────────────────────

/**
 * Configured once at module load — XMLParser is stateless so safe to reuse.
 *
 * Key decisions:
 * - attributeNamePrefix '@_' avoids collisions with element text nodes.
 * - textNodeName '#text' lets us read mixed content (label attribute + text).
 * - isArray ensures single-element lists aren't collapsed to objects.
 */
const parser = new XMLParser({
  ignoreAttributes:     false,
  attributeNamePrefix:  '@_',
  textNodeName:         '#text',
  allowBooleanAttributes: true,
  parseAttributeValue:  false,
  trimValues:           true,
  isArray: (name: string) =>
    [
      'PubmedArticle',
      'AbstractText',
      'PublicationType',
      'Author',
      'MeshHeading',
      'Chemical',
      'Keyword',
    ].includes(name),
});

// ─── Internal XML shape types ─────────────────────────────────────────────────

type AbstractTextNode =
  | string
  | { '#text'?: string | number; '@_Label'?: string; '@_NlmCategory'?: string };

type PublicationTypeNode =
  | string
  | { '#text'?: string | number; '@_UI'?: string };

type PMIDNode =
  | string
  | number
  | { '#text'?: string | number; '@_Version'?: string };

interface ParsedXmlArticle {
  MedlineCitation?: {
    PMID?: PMIDNode;
    Article?: {
      Abstract?: {
        AbstractText?: AbstractTextNode[];
      };
      PublicationTypeList?: {
        PublicationType?: PublicationTypeNode[];
      };
    };
  };
}

interface ParsedXmlRoot {
  PubmedArticleSet?: {
    PubmedArticle?: ParsedXmlArticle[];
  };
}

// ─── Exported shape ───────────────────────────────────────────────────────────

export interface ParsedAbstract {
  pmid: string;
  abstract: string;
  articleTypes: string[];
}

// ─── Node extractors ──────────────────────────────────────────────────────────

function extractPmid(node: PMIDNode | undefined): string {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return String(node['#text'] ?? '');
}

function extractAbstractText(nodes: AbstractTextNode[] | undefined): string {
  if (!nodes?.length) return '';
  return nodes
    .map(node => {
      if (typeof node === 'string') return node;
      const label = node['@_Label'];
      const text  = node['#text'] ?? '';
      return label ? `${label}: ${text}` : String(text);
    })
    .filter(Boolean)
    .join('\n');
}

function extractPublicationTypes(nodes: PublicationTypeNode[] | undefined): string[] {
  if (!nodes?.length) return [];
  return nodes
    .map(node => (typeof node === 'string' ? node : String(node['#text'] ?? '')))
    .filter(Boolean);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse the XML returned by `efetch.fcgi` (rettype=abstract) into structured
 * ParsedAbstract objects.
 *
 * Throws `PubMedError('PARSE_ERROR')` on malformed XML.
 */
export function parseAbstractsXml(xml: string): ParsedAbstract[] {
  let root: ParsedXmlRoot;
  try {
    root = parser.parse(xml) as ParsedXmlRoot;
  } catch (err) {
    throw new PubMedError(
      'PARSE_ERROR',
      `XML parsing failed: ${String(err)}`,
      { xmlSnippet: xml.slice(0, 200) },
    );
  }

  const articles = root?.PubmedArticleSet?.PubmedArticle ?? [];

  return articles.map<ParsedAbstract>(article => {
    const citation   = article.MedlineCitation;
    const pmid       = extractPmid(citation?.PMID);
    const abstract   = extractAbstractText(citation?.Article?.Abstract?.AbstractText);
    const articleTypes = extractPublicationTypes(
      citation?.Article?.PublicationTypeList?.PublicationType,
    );
    return { pmid, abstract, articleTypes };
  });
}
