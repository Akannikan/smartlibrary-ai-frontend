const OPEN_LIBRARY_BASE_URL = 'https://openlibrary.org';
const OPEN_LIBRARY_SEARCH_URL = `${OPEN_LIBRARY_BASE_URL}/search.json`;
const SEARCH_TIMEOUT_MS = 8000;
const TITLE_STOP_WORDS = new Set(['a', 'an', 'and', 'for', 'in', 'of', 'the', 'to']);
const LANGUAGE_NAMES = {
  ara: 'Arabic',
  chi: 'Chinese',
  zho: 'Chinese',
  deu: 'German',
  eng: 'English',
  fas: 'Persian',
  fre: 'French',
  fra: 'French',
  hin: 'Hindi',
  ita: 'Italian',
  jpn: 'Japanese',
  por: 'Portuguese',
  rus: 'Russian',
  spa: 'Spanish',
};

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

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function titleTokenMatches(wanted, found) {
  if (wanted === found) return true;
  if (Math.min(wanted.length, found.length) < 4) return false;
  return editDistance(wanted, found) <= Math.max(1, Math.floor(Math.min(wanted.length, found.length) * 0.2));
}

function firstValue(value) {
  return Array.isArray(value) ? value.find((item) => item) : value;
}

function formatSummary(value) {
  if (Array.isArray(value)) return formatSummary(value[0]);
  const summary = typeof value === 'object' && value !== null ? value.value : value;
  if (Array.isArray(summary)) return formatSummary(summary[0]);
  if (typeof summary !== 'string') return '';

  const clean = summary.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length <= 600) return clean;
  const sentenceEnd = clean.slice(0, 600).search(/[.!?](?:\s|$)/);
  return clean.slice(0, sentenceEnd > 0 ? sentenceEnd + 1 : 600).trim();
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
  const isbns = Array.isArray(document.isbn)
    ? [...new Set(document.isbn.map((isbn) => String(isbn).replace(/[^0-9Xx]/g, '').toUpperCase()).filter(Boolean))]
    : [];
  const isbn = isbns.length === 1 ? isbns[0] : '';
  const pages = Number(document.number_of_pages_median);
  const language = firstValue(document.language);
  const publicationDates = Array.isArray(document.publish_date) ? document.publish_date : [];
  const publicationYear = publicationDates
    .map((date) => String(date).match(/\b(?:18|19|20|21)\d{2}\b/)?.[0])
    .find(Boolean)
    || document.first_publish_year
    || '';
  const ddcNumber = classification.number;
  const authorCode = normalize(authors[0]?.split(/\s+/).at(-1) || '')
    .slice(0, 3)
    .toUpperCase();

  return {
    title: String(document.title || '').trim(),
    author: authors.join('; '),
    subtitle: String(document.subtitle || '').trim(),
    edition: String(document.edition_name || document.edition_statement || '').trim(),
    publisher: String(firstValue(document.publisher) || '').trim(),
    publication_place: String(firstValue(document.publish_place) || '').trim(),
    publication_year: String(publicationYear),
    isbn,
    isbn_options: isbns,
    pages: Number.isFinite(pages) && pages > 0 ? String(pages) : '',
    language: LANGUAGE_NAMES[String(language || '').replace(/^\/languages\//, '').toLowerCase()]
      || String(language || '').replace(/^\/languages\//, ''),
    physical_description: Number.isFinite(pages) && pages > 0 ? `${pages} pages` : '',
    notes: formatSummary(document.first_sentence),
    subjects,
    ddc_number: ddcNumber,
    call_number: ddcNumber && authorCode ? `${ddcNumber} ${authorCode}` : '',
    classification_source: classification.source,
    source: document.source || 'Open Library',
    source_url: document.source_url || '',
    source_record_id: document.source_record_id || '',
    work_key: String(document.key || ''),
  };
}

function scoreDocument(document, title, author, isbn) {
  const wantedTitle = titleTokens(title);
  const documentTitleTokens = titleTokens(document.title);
  const matchedTitleWords = wantedTitle.filter((word) => (
    documentTitleTokens.some((candidate) => titleTokenMatches(word, candidate))
  )).length;
  const titleScore = wantedTitle.length ? matchedTitleWords / wantedTitle.length : 0;
  const titleSimilarity = wantedTitle.length && documentTitleTokens.length
    ? matchedTitleWords / (wantedTitle.length + documentTitleTokens.length - matchedTitleWords)
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
  const normalizedIsbn = String(isbn || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  const isbnMatch = Boolean(normalizedIsbn && (document.isbn || []).includes(normalizedIsbn));

  return {
    ...normalizeDocument(document),
    ...(isbnMatch ? { isbn: normalizedIsbn } : {}),
    score: titleScore + titleSimilarity * 2 + (authorMatch ? 0.35 : 0) + (isbnMatch ? 10 : 0),
    titleScore,
    titleSimilarity,
    titleCoverage: wantedTitle.length ? matchedTitleWords / wantedTitle.length : 0,
    authorMatch,
    isbnMatch,
  };
}

async function fetchDocuments(parameters, fetchImplementation) {
  const url = new URL(OPEN_LIBRARY_SEARCH_URL);
  url.searchParams.set(
    'fields',
    'title,subtitle,edition_name,edition_statement,author_name,subject,dewey_decimal_class,isbn,publisher,publish_place,first_publish_year,publish_date,number_of_pages_median,language,first_sentence,key',
  );
  url.searchParams.set('limit', '50');
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

async function fetchWorkSummary(workKey, fetchImplementation) {
  const match = workKey.match(/^\/works\/(OL\d+W)$/);
  if (!match) return '';

  const response = await fetchImplementation(`${OPEN_LIBRARY_BASE_URL}${workKey}.json`, {
    headers: { 'User-Agent': 'SmartLibrary-AI-MVP/1.0 (book cataloguing)' },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw Object.assign(new Error(`Open Library work details failed (HTTP ${response.status}).`), {
      status: 502,
    });
  }

  const work = await response.json();
  return formatSummary(work.description);
}

async function searchBooks({ title = '', author = '', isbn = '' } = {}, fetchImplementation = fetch) {
  const cleanTitle = String(title).trim().slice(0, 160);
  const cleanAuthor = String(author).trim().slice(0, 120);
  const cleanIsbn = String(isbn).replace(/[^0-9Xx]/g, '').toUpperCase();
  const usableIsbn = /^(?:\d{9}[\dX]|\d{13})$/.test(cleanIsbn);
  const usableTitle = titleTokens(cleanTitle).length >= 1;
  const authorSurname = normalize(cleanAuthor).split(/\s+/).at(-1);

  if (!usableTitle && !authorSurname && !usableIsbn) {
    return { match: null, candidates: [] };
  }

  const queries = [];
  const addQuery = (parameters) => {
    if (parameters && !queries.some((query) => JSON.stringify(query) === JSON.stringify(parameters))) {
      queries.push(parameters);
    }
  };
  if (usableIsbn) addQuery({ isbn: cleanIsbn });
  if (usableTitle) {
    addQuery({ title: cleanTitle, ...(cleanAuthor ? { author: cleanAuthor } : {}) });
    if (cleanAuthor) addQuery({ title: cleanTitle });
  }
  if (authorSurname) {
    addQuery({ author: authorSurname });
    if (/^l[a-z]{3,}$/.test(authorSurname)) {
      addQuery({ author: `i${authorSurname.slice(1)}` });
    }
  }

  const documents = (await Promise.all(
    queries.map((parameters) => fetchDocuments(parameters, fetchImplementation)),
  )).flat();
  const deduplicated = [...new Map(documents.map((document) => [
    `${normalize(document.title)}|${(document.author_name || []).map(normalize).sort().join('|')}`,
    document,
  ])).values()];
  const rankDocuments = (books) => books
    .map((document) => scoreDocument(document, cleanTitle, cleanAuthor, usableIsbn ? cleanIsbn : ''))
    .filter((book) => book.title && (book.author || book.subjects.length))
    .sort((left, right) => right.score - left.score)
    .slice(0, 8)
    .map(({ score, titleScore, titleSimilarity, titleCoverage, authorMatch, isbnMatch, ...book }) => ({
      ...book,
      matchScore: Math.round(score * 100),
      authorMatch,
      isbnMatch,
      titleSimilarity: Math.round(titleSimilarity * 100),
      titleCoverage: Math.round(titleCoverage * 100),
    }));
  let ranked = rankDocuments(deduplicated);
  const isStrongMatch = (book) => Boolean(
    (usableIsbn && book?.isbnMatch)
    || (
      usableTitle
      && book?.titleSimilarity >= 85
      && (book.authorMatch || !cleanAuthor)
    )
    || (
      usableTitle
      && titleTokens(cleanTitle).length >= 2
      && book?.authorMatch
      && book.titleCoverage >= 75
      && book.titleSimilarity >= 60
    ),
  );

  if (!isStrongMatch(ranked[0]) && usableTitle) {
    const fallbackQueries = [
      { q: `${cleanTitle} ${cleanAuthor}`.trim() },
      ...(!cleanAuthor ? [] : [{ q: cleanTitle }]),
    ];
    const fallbackDocuments = (await Promise.all(
      fallbackQueries.map((parameters) => fetchDocuments(parameters, fetchImplementation)),
    )).flat();
    const combined = [...new Map([...deduplicated, ...fallbackDocuments].map((document) => [
      `${normalize(document.title)}|${(document.author_name || []).map(normalize).sort().join('|')}`,
      document,
    ])).values()];
    ranked = rankDocuments(combined);
  }

  const best = ranked[0];
  const strongIsbnMatch = usableIsbn && best?.isbnMatch;
  const strongTitleMatch = usableTitle && best?.titleSimilarity >= 85
    && (best.authorMatch || !cleanAuthor);
  const OCRTitleMatch = usableTitle
    && titleTokens(cleanTitle).length >= 2
    && best?.authorMatch
    && best.titleCoverage >= 75
    && best.titleSimilarity >= 60;
  const match = strongIsbnMatch || strongTitleMatch || OCRTitleMatch ? best : null;
  let summaryMessage = '';

  if (match && !match.notes && match.work_key) {
    try {
      match.notes = await fetchWorkSummary(match.work_key, fetchImplementation);
    } catch {
      summaryMessage = 'Open Library found the book, but its summary could not be loaded. You can still enter notes manually.';
    }
  }

  return {
    match: match ? (({ work_key, ...book }) => book)(match) : null,
    candidates: ranked.map(({ work_key, ...book }) => book),
    summaryMessage,
  };
}

module.exports = { searchBooks, inferDeweyNumber };
