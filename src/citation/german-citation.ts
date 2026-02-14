export interface GermanCitationParsed {
  type: "paragraph" | "article";
  normalized: string;
  parsed: Record<string, string>;
  lookupCitations: string[];
}

const SECTION_PATTERN = String.raw`(?<section>\d+[a-z]?(?:\s*(?:bis|-|,)\s*\d+[a-z]?){0,5})`;

const PARAGRAPH_PATTERN = new RegExp(
  String.raw`^(?<marker>§{1,2})\s*${SECTION_PATTERN}` +
    String.raw`(?:\s*(?:Abs\.?|Absatz)\s*(?<paragraph>\d+[a-z]?))?` +
    String.raw`(?:\s*(?:S\.?|Satz)\s*(?<sentence>\d+[a-z]?))?` +
    String.raw`(?:\s*(?:Nr\.?|Nummer)\s*(?<number>\d+[a-z]?))?` +
    String.raw`(?:\s*(?:Buchst\.?|Buchstabe)\s*(?<letter>[a-z]))?` +
    String.raw`\s*(?<code>[A-Za-z][A-Za-z0-9_-]{1,19})$`,
  "i",
);

const ARTICLE_PATTERN = new RegExp(
  String.raw`^(?:Art\.?|Artikel)\s*(?<article>\d+[a-z]?)` +
    String.raw`(?:\s*(?:Abs\.?|Absatz)\s*(?<paragraph>\d+[a-z]?))?` +
    String.raw`(?:\s*(?:S\.?|Satz)\s*(?<sentence>\d+[a-z]?))?` +
    String.raw`(?:\s*(?:Nr\.?|Nummer)\s*(?<number>\d+[a-z]?))?` +
    String.raw`(?:\s*(?:Buchst\.?|Buchstabe)\s*(?<letter>[a-z]))?` +
    String.raw`\s*(?<code>[A-Za-z][A-Za-z0-9_-]{1,19})$`,
  "i",
);

export function parseGermanCitation(input: string): GermanCitationParsed | null {
  const normalizedInput = normalizeWhitespace(input);
  const paragraphMatch = normalizedInput.match(PARAGRAPH_PATTERN);
  if (paragraphMatch?.groups) {
    const section = paragraphMatch.groups.section;
    const marker = paragraphMatch.groups.marker;
    const code = paragraphMatch.groups.code;
    if (!section || !marker || !code) {
      return null;
    }

    const paragraph = paragraphMatch.groups.paragraph;
    const sentence = paragraphMatch.groups.sentence;
    const number = paragraphMatch.groups.number;
    const letter = paragraphMatch.groups.letter;
    const normalizedCode = normalizeCode(code);
    const normalizedSection = normalizeWhitespace(section);
    const normalizedMarker = resolveSectionMarker(marker, normalizedSection);
    const paragraphCitationParts: ParagraphCitationParts = {
      marker: normalizedMarker,
      section: normalizedSection,
      code: normalizedCode,
      ...(paragraph ? { paragraph } : {}),
      ...(sentence ? { sentence } : {}),
      ...(number ? { number } : {}),
      ...(letter ? { letter } : {}),
    };

    return {
      type: "paragraph",
      normalized: buildParagraphCitation(paragraphCitationParts),
      parsed: {
        type: "paragraph",
        marker: normalizedMarker,
        section: normalizedSection,
        ...(paragraph ? { paragraph } : {}),
        ...(sentence ? { sentence } : {}),
        ...(number ? { number } : {}),
        ...(letter ? { letter: letter.toLowerCase() } : {}),
        code: normalizedCode,
      },
      lookupCitations: [
        `${normalizedMarker} ${normalizedSection} ${normalizedCode}`,
      ],
    };
  }

  const articleMatch = normalizedInput.match(ARTICLE_PATTERN);
  if (articleMatch?.groups) {
    const article = articleMatch.groups.article;
    const code = articleMatch.groups.code;
    if (!article || !code) {
      return null;
    }

    const paragraph = articleMatch.groups.paragraph;
    const sentence = articleMatch.groups.sentence;
    const number = articleMatch.groups.number;
    const letter = articleMatch.groups.letter;
    const normalizedCode = normalizeCode(code);
    const normalizedArticle = normalizeWhitespace(article);
    const articleCitationParts: ArticleCitationParts = {
      article: normalizedArticle,
      code: normalizedCode,
      ...(paragraph ? { paragraph } : {}),
      ...(sentence ? { sentence } : {}),
      ...(number ? { number } : {}),
      ...(letter ? { letter } : {}),
    };

    return {
      type: "article",
      normalized: buildArticleCitation(articleCitationParts),
      parsed: {
        type: "article",
        article: normalizedArticle,
        ...(paragraph ? { paragraph } : {}),
        ...(sentence ? { sentence } : {}),
        ...(number ? { number } : {}),
        ...(letter ? { letter: letter.toLowerCase() } : {}),
        code: normalizedCode,
      },
      lookupCitations: [`Art ${normalizedArticle} ${normalizedCode}`],
    };
  }

  return null;
}

interface ParagraphCitationParts {
  marker: "§" | "§§";
  section: string;
  paragraph?: string;
  sentence?: string;
  number?: string;
  letter?: string;
  code: string;
}

function buildParagraphCitation(parts: ParagraphCitationParts): string {
  const segments = [`${parts.marker} ${parts.section}`];
  if (parts.paragraph) {
    segments.push(`Abs. ${parts.paragraph}`);
  }
  if (parts.sentence) {
    segments.push(`S. ${parts.sentence}`);
  }
  if (parts.number) {
    segments.push(`Nr. ${parts.number}`);
  }
  if (parts.letter) {
    segments.push(`Buchst. ${parts.letter.toLowerCase()}`);
  }
  segments.push(parts.code);
  return segments.join(" ");
}

interface ArticleCitationParts {
  article: string;
  paragraph?: string;
  sentence?: string;
  number?: string;
  letter?: string;
  code: string;
}

function buildArticleCitation(parts: ArticleCitationParts): string {
  const segments = [`Art. ${parts.article}`];
  if (parts.paragraph) {
    segments.push(`Abs. ${parts.paragraph}`);
  }
  if (parts.sentence) {
    segments.push(`S. ${parts.sentence}`);
  }
  if (parts.number) {
    segments.push(`Nr. ${parts.number}`);
  }
  if (parts.letter) {
    segments.push(`Buchst. ${parts.letter.toLowerCase()}`);
  }
  segments.push(parts.code);
  return segments.join(" ");
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeCode(value: string): string {
  return value.toUpperCase();
}

function resolveSectionMarker(marker: string, section: string): "§" | "§§" {
  if (marker === "§§" || /(?:\bbis\b|,|-)/i.test(section)) {
    return "§§";
  }
  return "§";
}
