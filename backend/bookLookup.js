const OPEN_LIBRARY_SEARCH_URL = 'https://openlibrary.org/search.json';
const SEARCH_TIMEOUT_MS = 8000;
const TITLE_STOP_WORDS = new Set(['a', 'an', 'and', 'for', 'in', 'of', 'the', 'to']);

function normalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function titleTokens(value) {
  return normalize(value).split(/\s+/).filter((word) => word && !TITLE_STOP_WORDS.has(word));
}

function inferDeweyNumber(subjects, suppliedNumbers = []) {
  const numberList = Array.isArray(suppliedNumbers) ? suppliedNumbers : [suppliedNumbers];
  const supplied = numberList.find((value) => /^\d{3}(?:\.\d+)?$/.test(String(value).trim()));
  if (supplied) return { number: String(supplied).trim(), source: 'Open Library' };

  const subjectText = subjects.join(' ').toLowerCase();
  const classifications = [
    { pattern: /\b(outdoor skills|outdoor life|camping|outdoor recreation)\b/, number: '796.5' },
    { pattern: /\b(biography|biographies|memoir|autobiograph)\b/, number: '920' },
    { pattern: /\b(history|historical)\b/, number: '900' },
    { pattern: /\b(fiction|novel|novels|stories)\b/, number: '800' },
    { pattern: /\b(handbook|handbooks|reference|miscellanea|general knowledge)\b/, number: '031.02' },
    { pattern: /\b(recreation|amusements|sports|games)\b/, number: '790' },
    { pattern: /\b(science|natural history)\b/, number: '500' },
  ];
  const classification = classifications.find(({ pattern }) => pattern.test(subjectText));

  return classification
    ? { number: classification.number, source: 'Suggested from subject headings' }
    : { number: '', source: '' };
}

function normalizeDocument(document) {
  const subjects = Array.isArray(document.subject)
    ? [...new Set(document.subject.map((subject) => String(subject).trim()).filter(Boolean))]
      .slice(0, 8)
    : [];
  const classification = inferDeweyNumber(subjects, document.dewey_decimal_class || []);
  const authors = Array.isArray(document.author_name)
    ? [...new Set(document.author_name.map((author) => String(author).trim()).filter(Boolean))]
      .slice(0, 5)
    : [];
  const ddcNumber = classification.number;
  const authorCode = normalize(authors[0]?.split(/\s+/).at(-1) || '')
    .slice(0, 3)
    .toUpperCase();

  return {
    title: String(document.title || '').trim(),
    author: authors.join('; '),
    subjects,
    ddc_number: ddcNumber,
    call_number: ddcNumber && authorCode ? `${ddcNumber} ${authorCode}` : '',
    classification_source: classification.source,
    source: 'Open Library',
  };
}

function scoreDocument(document, title, author) {
  const wantedTitle = titleTokens(title);
  const documentTitleTokens = titleTokens(document.title);
  const foundTitle = new Set(documentTitleTokens);
  const matchedTitleWords = wantedTitle.filter((word) => foundTitle.has(word)).length;
  const titleScore = wantedTitle.length ? matchedTitleWords / wantedTitle.length : 0;
  const titleSimilarity = wantedTitle.length && documentTitleTokens.length
    ? matchedTitleWords / new Set([...wantedTitle, ...documentTitleTokens]).size
    : 0;
  const wantedSurname = normalize(author).split(/\s+/).at(-1);
  const wantedSurnames = new Set([
    wantedSurname,
    ...(wantedSurname && /^l[a-z]{3,}$/.test(wantedSurname)
      ? [`i${wantedSurname.slice(1)}`]
      : []),
  ]);
  const foundAuthors = (document.author_name || []).map(normalize);
  const authorMatch = Boolean(wantedSurname && foundAuthors.some((name) => (
    name.split(/\s+/).some((word) => wantedSurnames.has(word))
  )));

  return {
    ...normalizeDocument(document),
    score: titleScore + titleSimilarity * 2 + (authorMatch ? 0.35 : 0),
    titleScore,
    titleSimilarity,
    authorMatch,
  };
}

async function fetchDocuments(parameters, fetchImplementation) {
  const url = new URL(OPEN_LIBRARY_SEARCH_URL);
  url.searchParams.set('fields', 'title,author_name,subject,dewey_decimal_class');
  url.searchParams.set('limit', '20');
  Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, value));

  const response = await fetchImplementation(url, {
    headers: { 'User-Agent': 'SmartLibrary-AI-MVP/1.0 (book cataloguing)' },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw Object.assign(new Error(`Open Library search failed (HTTP ${response.status}).`), {
      status: 502,
    });
  }

  const result = await response.json();
  return Array.isArray(result.docs) ? result.docs : [];
}

async function searchBooks({ title = '', author = '' } = {}, fetchImplementation = fetch) {
  const cleanTitle = String(title).trim().slice(0, 160);
  const cleanAuthor = String(author).trim().slice(0, 120);
  const usableTitle = titleTokens(cleanTitle).length >= 2;
  const authorSurname = normalize(cleanAuthor).split(/\s+/).at(-1);

  if (!usableTitle && !authorSurname) {
    return { match: null, candidates: [] };
  }

  const parameters = usableTitle
    ? { title: cleanTitle, ...(cleanAuthor ? { author: cleanAuthor } : {}) }
    : { author: authorSurname };
  let documents = await fetchDocuments(parameters, fetchImplementation);

  if (!documents.length && cleanAuthor && authorSurname && authorSurname !== normalize(cleanAuthor)) {
    documents = await fetchDocuments({ author: authorSurname }, fetchImplementation);
  }
  if (!documents.length && !usableTitle && /^l[a-z]{3,}$/.test(authorSurname)) {
    documents = await fetchDocuments({ author: `i${authorSurname.slice(1)}` }, fetchImplementation);
  }

  const ranked = documents
    .map((document) => scoreDocument(document, cleanTitle, cleanAuthor))
    .filter((book) => book.title && (book.author || book.subjects.length))
    .sort((left, right) => right.score - left.score)
    .slice(0, 8)
    .map(({ score, titleScore, titleSimilarity, authorMatch, ...book }) => ({
      ...book,
      matchScore: Math.round(score * 100),
      authorMatch,
      titleSimilarity: Math.round(titleSimilarity * 100),
    }));
  const best = ranked[0];
  const strongTitleMatch = usableTitle && best?.titleSimilarity >= 85
    && (best.authorMatch || !cleanAuthor);

  return {
    match: strongTitleMatch ? best : null,
    candidates: ranked,
  };
}

module.exports = { searchBooks, inferDeweyNumber };
