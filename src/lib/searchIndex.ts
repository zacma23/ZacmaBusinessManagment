import type { FormSubmission, Lead } from '../types';

export interface IndexedField<T> {
  name: string;
  weight: number;
  /** Enables compact alphanumeric/digit indexing for IDs, references, and phone numbers. */
  isIdentifier?: boolean;
  extract: (item: T) => string;
}

export interface SearchMatch<T> {
  item: T;
  score: number;
}

export interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * Strips diacritics and lowercases text for case- and accent-insensitive matching.
 */
export function normalizeText(input: string): string {
  if (!input) return '';
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Removes all non-alphanumeric characters (ideal for matching ZCM-2026-0142 as zcm20260142
 * or +251-911-234-567 as 251911234567).
 */
export function compactAlphanumeric(input: string): string {
  return normalizeText(input).replace(/[^a-z0-9]/g, '');
}

/**
 * Tokenizes normalized text into searchable words & reference segments.
 */
export function tokenize(input: string): string[] {
  const norm = normalizeText(input);
  if (!norm) return [];
  return norm.split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Flattens dynamic form response payloads (Record<string, unknown>) into searchable text.
 */
export function flattenResponses(responses: Record<string, unknown> | undefined | null): string {
  if (!responses || typeof responses !== 'object') return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(responses)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      const joined = value
        .map((v) => (v === null || v === undefined ? '' : String(v)))
        .filter(Boolean)
        .join(' ');
      if (joined) parts.push(`${key} ${joined}`);
    } else if (typeof value === 'object') {
      try {
        parts.push(`${key} ${JSON.stringify(value)}`);
      } catch {
        // ignore circular structures
      }
    } else {
      const str = String(value).trim();
      if (str) parts.push(`${key} ${str}`);
    }
  }
  return parts.join(' ');
}

/**
 * Fast bounded Damerau-Levenshtein check: returns true if a and b are within edit distance <= 1.
 * Used for forgiving typo tolerance on contact names & longer terms without sacrificing speed.
 */
function isWithinOneEdit(a: string, b: string): boolean {
  const lenA = a.length;
  const lenB = b.length;
  if (Math.abs(lenA - lenB) > 1) return false;
  if (a === b) return true;

  let i = 0;
  let j = 0;
  let edits = 0;

  while (i < lenA && j < lenB) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    edits++;
    if (edits > 1) return false;

    // Adjacent transposition (e.g. "abbee" -> "abebe")
    if (i + 1 < lenA && j + 1 < lenB && a[i] === b[j + 1] && a[i + 1] === b[j]) {
      i += 2;
      j += 2;
    } else if (lenA > lenB) {
      i++;
    } else if (lenB > lenA) {
      j++;
    } else {
      i++;
      j++;
    }
  }

  if (i < lenA || j < lenB) {
    edits++;
  }
  return edits <= 1;
}

interface IdentifierRecord {
  docIndex: number;
  compact: string;
  weight: number;
}

/**
 * In-memory inverted full-text search index with:
 * - Sorted vocabulary + binary search for O(log V) prefix matching
 * - Field-weighted relevance scoring (leadRef & contact name prioritized)
 * - Compact identifier index for hyphenless / partial Lead Reference IDs & phone numbers
 * - Multi-term AND filtering with 1-edit-distance fuzzy fallback on words >= 4 chars
 */
export class FullTextSearchIndex<T extends { id: string }> {
  private readonly items: T[];
  private readonly invertedIndex: Map<string, Map<number, number>>;
  private readonly sortedTokens: string[];
  private readonly exactNormalizedFieldMap: Map<string, Array<{ docIndex: number; weight: number }>>;
  private readonly compactIdentifiers: IdentifierRecord[];
  private readonly trigramIndex: Map<string, Set<number>>;

  constructor(items: T[], fields: Array<IndexedField<T>>) {
    this.items = items;
    this.invertedIndex = new Map();
    this.exactNormalizedFieldMap = new Map();
    this.compactIdentifiers = [];
    this.trigramIndex = new Map();

    for (let docIndex = 0; docIndex < items.length; docIndex++) {
      const item = items[docIndex];

      for (const field of fields) {
        const raw = field.extract(item);
        if (!raw) continue;

        const normalized = normalizeText(raw);
        if (!normalized) continue;

        // Track full normalized phrase for high-priority exact-match boosting (names & leadRef)
        if (field.weight >= 40) {
          const list = this.exactNormalizedFieldMap.get(normalized);
          if (list) {
            list.push({ docIndex, weight: field.weight });
          } else {
            this.exactNormalizedFieldMap.set(normalized, [{ docIndex, weight: field.weight }]);
          }
        }

        // Index individual tokens with max field weight per (token, doc)
        const tokens = tokenize(normalized);
        for (let tIdx = 0; tIdx < tokens.length; tIdx++) {
          const token = tokens[tIdx];
          // Give first-position tokens (e.g. first name or leadRef prefix) a slight boost
          const positionalBoost = tIdx === 0 ? 1.15 : 1.0;
          const score = field.weight * positionalBoost;
          this.addTokenPosting(token, docIndex, score);
        }

        // Index compact identifier strings (leadRef like ZCM-2026-0142 & phone numbers)
        if (field.isIdentifier) {
          const compact = compactAlphanumeric(raw);
          if (compact) {
            this.addTokenPosting(compact, docIndex, field.weight * 1.25);
            const idRecordIndex = this.compactIdentifiers.length;
            this.compactIdentifiers.push({
              docIndex,
              compact,
              weight: field.weight,
            });
            // Build character trigram index over compact identifiers for instant substring lookup
            if (compact.length >= 3) {
              for (let i = 0; i <= compact.length - 3; i++) {
                const gram = compact.slice(i, i + 3);
                let bucket = this.trigramIndex.get(gram);
                if (!bucket) {
                  bucket = new Set();
                  this.trigramIndex.set(gram, bucket);
                }
                bucket.add(idRecordIndex);
              }
            }
          }
        }
      }
    }

    this.sortedTokens = Array.from(this.invertedIndex.keys()).sort();
  }

  get size(): number {
    return this.items.length;
  }

  private addTokenPosting(token: string, docIndex: number, score: number) {
    let postings = this.invertedIndex.get(token);
    if (!postings) {
      postings = new Map();
      this.invertedIndex.set(token, postings);
    }
    const existing = postings.get(docIndex);
    if (existing === undefined || score > existing) {
      postings.set(docIndex, score);
    }
  }

  /**
   * Binary-searches sortedTokens for the first token >= prefix.
   */
  private lowerBound(prefix: string): number {
    let lo = 0;
    let hi = this.sortedTokens.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.sortedTokens[mid] < prefix) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  /**
   * Collects matching document scores for a single query term (exact, prefix, compact ID substring, or fuzzy).
   */
  private matchTerm(term: string, compactTerm: string): Map<number, number> {
    const docScores = new Map<number, number>();
    const recordScore = (docIndex: number, score: number) => {
      const prev = docScores.get(docIndex);
      if (prev === undefined || score > prev) {
        docScores.set(docIndex, score);
      }
    };

    // 1. Exact token match
    const exactPostings = this.invertedIndex.get(term);
    if (exactPostings) {
      for (const [docIndex, weight] of exactPostings.entries()) {
        recordScore(docIndex, weight * 1.4);
      }
    }

    // 2. Prefix token match via binary search on sorted vocabulary
    let idx = this.lowerBound(term);
    while (idx < this.sortedTokens.length) {
      const candidate = this.sortedTokens[idx];
      if (!candidate.startsWith(term)) break;
      if (candidate !== term) {
        const postings = this.invertedIndex.get(candidate)!;
        // Closer prefix coverage scores higher
        const coverage = term.length / candidate.length;
        for (const [docIndex, weight] of postings.entries()) {
          recordScore(docIndex, weight * (0.75 + 0.35 * coverage));
        }
      }
      idx++;
    }

    // 3. Compact identifier substring match (handles "0142", "20260142", "911234", "ZCM2026")
    if (compactTerm.length >= 2) {
      if (compactTerm.length >= 3) {
        const firstGram = compactTerm.slice(0, 3);
        const candidates = this.trigramIndex.get(firstGram);
        if (candidates) {
          for (const recIdx of candidates) {
            const rec = this.compactIdentifiers[recIdx];
            if (rec.compact === compactTerm) {
              recordScore(rec.docIndex, rec.weight * 1.6);
            } else if (rec.compact.startsWith(compactTerm)) {
              recordScore(rec.docIndex, rec.weight * 1.25);
            } else if (rec.compact.includes(compactTerm)) {
              recordScore(rec.docIndex, rec.weight * 0.9);
            }
          }
        }
      } else {
        // Short 2-char identifier fragment
        for (const rec of this.compactIdentifiers) {
          if (rec.compact.includes(compactTerm)) {
            recordScore(rec.docIndex, rec.weight * 0.75);
          }
        }
      }
    }

    // 4. Typo-tolerant 1-edit-distance fallback when exact/prefix had few matches & term >= 4 chars
    if (term.length >= 4 && docScores.size < 5) {
      for (const candidate of this.sortedTokens) {
        if (Math.abs(candidate.length - term.length) > 1) continue;
        // Fast pre-filter: share first or last character
        if (candidate[0] !== term[0] && candidate[candidate.length - 1] !== term[term.length - 1]) {
          continue;
        }
        if (isWithinOneEdit(term, candidate)) {
          const postings = this.invertedIndex.get(candidate)!;
          for (const [docIndex, weight] of postings.entries()) {
            recordScore(docIndex, weight * 0.55);
          }
        }
      }
    }

    return docScores;
  }

  /**
   * Executes a ranked full-text search and returns matches with relevance scores.
   * Empty/whitespace queries return all items in their original order.
   */
  searchWithScores(rawQuery: string): Array<SearchMatch<T>> {
    const normalizedQuery = normalizeText(rawQuery);
    if (!normalizedQuery) {
      return this.items.map((item) => ({ item, score: 0 }));
    }

    const compactFullQuery = compactAlphanumeric(normalizedQuery);
    const terms = tokenize(normalizedQuery);
    if (terms.length === 0 && !compactFullQuery) {
      return this.items.map((item) => ({ item, score: 0 }));
    }

    // Check full compact query first (e.g. "ZCM-2026-0142" or "zcm20260142" as a single identifier)
    const fullCompactMatches =
      compactFullQuery.length >= 3 ? this.matchTerm(compactFullQuery, compactFullQuery) : null;

    // Multi-token AND intersection across query terms
    let intersected: Map<number, number> | null = null;
    for (const term of terms) {
      const termMatches = this.matchTerm(term, compactAlphanumeric(term));
      if (intersected === null) {
        intersected = new Map(termMatches);
      } else {
        const next = new Map<number, number>();
        for (const [docIndex, accumScore] of intersected.entries()) {
          const termScore = termMatches.get(docIndex);
          if (termScore !== undefined) {
            next.set(docIndex, accumScore + termScore);
          }
        }
        intersected = next;
      }
      if (intersected.size === 0) break;
    }

    const finalScores = new Map<number, number>();
    if (intersected) {
      for (const [docIndex, score] of intersected.entries()) {
        finalScores.set(docIndex, score);
      }
    }

    // Union in exact/substring matches on the full compact query (e.g. "ZCM-2026-0142" typed with dashes)
    if (fullCompactMatches && fullCompactMatches.size > 0) {
      for (const [docIndex, score] of fullCompactMatches.entries()) {
        const prev = finalScores.get(docIndex) || 0;
        finalScores.set(docIndex, Math.max(prev, score * 1.15));
      }
    }

    // Boost exact normalized full-phrase matches (e.g., exact full contact name or exact leadRef)
    const exactPhraseHits = this.exactNormalizedFieldMap.get(normalizedQuery);
    if (exactPhraseHits) {
      for (const hit of exactPhraseHits) {
        const prev = finalScores.get(hit.docIndex) || 0;
        finalScores.set(hit.docIndex, prev + hit.weight * 2.0);
      }
    }

    if (finalScores.size === 0) return [];

    // Sort by descending relevance score; preserve original order on equal scores
    return Array.from(finalScores.entries())
      .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0] - b[0]))
      .map(([docIndex, score]) => ({
        item: this.items[docIndex],
        score,
      }));
  }

  /**
   * Executes a ranked full-text search and returns matching items.
   */
  search(rawQuery: string): T[] {
    if (!rawQuery || !rawQuery.trim()) return this.items;
    return this.searchWithScores(rawQuery).map((m) => m.item);
  }

  /**
   * Returns a Set of matching document IDs for fast lookup/filtering.
   */
  searchIds(rawQuery: string): Set<string> {
    if (!rawQuery || !rawQuery.trim()) {
      return new Set(this.items.map((item) => item.id));
    }
    return new Set(this.search(rawQuery).map((item) => item.id));
  }
}

/**
 * Builds a weighted full-text search index over CRM Leads.
 * Prioritizes Lead Reference ID and Contact Name, while also indexing email, phone,
 * business unit, form title, assigned staff, notes, and custom form answers.
 */
export function buildLeadSearchIndex(leads: Lead[]): FullTextSearchIndex<Lead> {
  return new FullTextSearchIndex<Lead>(leads, [
    {
      name: 'leadRef',
      weight: 100,
      isIdentifier: true,
      extract: (lead) => lead.leadRef || '',
    },
    {
      name: 'fullName',
      weight: 70,
      extract: (lead) => lead.fullName || '',
    },
    {
      name: 'email',
      weight: 35,
      extract: (lead) => lead.email || '',
    },
    {
      name: 'phone',
      weight: 35,
      isIdentifier: true,
      extract: (lead) => lead.phone || '',
    },
    {
      name: 'businessUnitName',
      weight: 20,
      extract: (lead) => lead.businessUnitName || '',
    },
    {
      name: 'formTitle',
      weight: 18,
      extract: (lead) => lead.formTitle || '',
    },
    {
      name: 'assignedStaffName',
      weight: 16,
      extract: (lead) => lead.assignedStaffName || '',
    },
    {
      name: 'source',
      weight: 12,
      extract: (lead) => lead.source || '',
    },
    {
      name: 'internalNotes',
      weight: 10,
      extract: (lead) => lead.internalNotes || '',
    },
    {
      name: 'responses',
      weight: 8,
      extract: (lead) => flattenResponses(lead.responses),
    },
  ]);
}

/**
 * Builds a weighted full-text search index over Form Submissions.
 * Prioritizes Lead Reference ID and Submitter Name, while also indexing email, phone,
 * form title, business unit, and all dynamic response answers.
 */
export function buildSubmissionSearchIndex(
  submissions: FormSubmission[]
): FullTextSearchIndex<FormSubmission> {
  return new FullTextSearchIndex<FormSubmission>(submissions, [
    {
      name: 'leadRef',
      weight: 100,
      isIdentifier: true,
      extract: (sub) => sub.leadRef || '',
    },
    {
      name: 'submitterName',
      weight: 70,
      extract: (sub) => sub.submitterName || '',
    },
    {
      name: 'submitterEmail',
      weight: 35,
      extract: (sub) => sub.submitterEmail || '',
    },
    {
      name: 'submitterPhone',
      weight: 35,
      isIdentifier: true,
      extract: (sub) => sub.submitterPhone || '',
    },
    {
      name: 'formTitle',
      weight: 22,
      extract: (sub) => sub.formTitle || '',
    },
    {
      name: 'businessUnitName',
      weight: 20,
      extract: (sub) => sub.businessUnitName || '',
    },
    {
      name: 'source',
      weight: 10,
      extract: (sub) => sub.source || '',
    },
    {
      name: 'responses',
      weight: 12,
      extract: (sub) => flattenResponses(sub.responses),
    },
  ]);
}

/**
 * Safely splits text into highlighted and non-highlighted segments for React JSX rendering.
 * Supports multi-term queries as well as hyphenless identifier matches (e.g. "zcm2026" inside "ZCM-2026-0142").
 * Never produces raw HTML.
 */
export function getHighlightSegments(text: string, rawQuery: string): HighlightSegment[] {
  if (!text) return [];
  const trimmedQuery = rawQuery.trim();
  if (!trimmedQuery) return [{ text, match: false }];

  const lowerText = text.toLowerCase();
  const terms = tokenize(trimmedQuery);
  const ranges: Array<[number, number]> = [];

  // Direct substring ranges for each query token
  for (const term of terms) {
    if (!term) continue;
    let startIdx = 0;
    while (startIdx < lowerText.length) {
      const found = lowerText.indexOf(term, startIdx);
      if (found === -1) break;
      ranges.push([found, found + term.length]);
      startIdx = found + term.length;
    }
  }

  // Also match hyphenless/compact identifier spans (e.g. "zcm20260142" inside "ZCM-2026-0142")
  const compactQuery = compactAlphanumeric(trimmedQuery);
  if (ranges.length === 0 && compactQuery.length >= 2) {
    const charPositions: number[] = [];
    let compactText = '';
    for (let i = 0; i < lowerText.length; i++) {
      const ch = lowerText[i];
      if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) {
        compactText += ch;
        charPositions.push(i);
      }
    }
    const found = compactText.indexOf(compactQuery);
    if (found !== -1) {
      const startOrig = charPositions[found];
      const endOrig = charPositions[found + compactQuery.length - 1] + 1;
      ranges.push([startOrig, endOrig]);
    }
  }

  if (ranges.length === 0) {
    return [{ text, match: false }];
  }

  // Sort and merge overlapping intervals
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of ranges) {
    if (merged.length === 0 || start > merged[merged.length - 1][1]) {
      merged.push([start, end]);
    } else if (end > merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = end;
    }
  }

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), match: false });
    }
    segments.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), match: false });
  }

  return segments;
}
