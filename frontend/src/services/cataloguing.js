const labelDefinitions = [
  { field: 'publication_place', labels: ['place of publication', 'publication place', 'published in'] },
  { field: 'publication_year', labels: ['publication year', 'year of publication', 'published'] },
  { field: 'physical_description', labels: ['physical description', 'physical details'] },
  { field: 'ddc_number', labels: ['ddc number', 'ddc', 'classification number'] },
  { field: 'call_number', labels: ['call number', 'shelf mark'] },
  { field: 'publisher', labels: ['published by', 'publisher', 'imprint'] },
  { field: 'author', labels: ['written by', 'edited by', 'compiled by', 'authors', 'author', 'by'] },
  { field: 'subtitle', labels: ['subtitle', 'sub-title'] },
  { field: 'title', labels: ['main title', 'book title', 'title'] },
  { field: 'edition', labels: ['edition'] },
  { field: 'isbn', labels: ['isbn-13', 'isbn-10', 'isbn'] },
  { field: 'pages', labels: ['number of pages', 'pages'] },
  { field: 'language', labels: ['language'] },
  { field: 'subjects', labels: ['subject headings', 'subjects', 'keywords'] },
  { field: 'notes', labels: ['notes', 'remarks'] },
];

const labelToField = new Map(
  labelDefinitions.flatMap(({ field, labels }) => labels.map((label) => [label, field])),
);
const commonTitleWords = new Set(['a', 'an', 'and', 'for', 'from', 'in', 'of', 'on', 'the', 'to', 'with']);
const labelPattern = labelDefinitions
  .flatMap(({ labels }) => labels)
  .sort((left, right) => right.length - left.length)
  .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
const labeledFieldPattern = new RegExp(
  `\\b(${labelPattern})\\b[ \\t]*(?:[:\\-][ \\t]*|(?<=\\bby)[ \\t]+)`,
  'gi',
);

function cleanValue(value) {
  return value
    .replace(/^[\s:;\-–—]+|[\s;]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeIsbn(value) {
  return String(value || '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

export function formatIsbn13(value) {
  let isbn = normalizeIsbn(value);
  if (/^\d{9}[\dX]$/.test(isbn) && isValidIsbn(isbn)) {
    const body = `978${isbn.slice(0, 9)}`;
    const checksum = [...body].reduce(
      (sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3),
      0,
    );
    isbn = `${body}${(10 - (checksum % 10)) % 10}`;
  }
  if (!/^\d{0,13}$/.test(isbn)) return '';

  return [
    isbn.slice(0, 3),
    isbn.slice(3, 4),
    isbn.slice(4, 7),
    isbn.slice(7, 12),
    isbn.slice(12, 13),
  ].filter(Boolean).join('-');
}

export function isValidIsbn(value) {
  const isbn = normalizeIsbn(value);
  if (/^\d{9}[\dX]$/.test(isbn)) {
    const checksum = [...isbn].reduce(
      (sum, digit, index) => sum + (digit === 'X' ? 10 : Number(digit)) * (10 - index),
      0,
    );
    return checksum % 11 === 0;
  }
  if (!/^97[89]\d{10}$/.test(isbn)) return false;

  const checksum = [...isbn].reduce(
    (sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return checksum % 10 === 0;
}

export function isValidFormattedIsbn13(value) {
  const match = String(value || '').match(/^(97[89])-(\d{1,5})-(\d{1,7})-(\d{1,6})-(\d)$/);
  return Boolean(match)
    && match.slice(1).join('').length === 13
    && isValidIsbn(match.slice(1).join(''));
}

function isPlausibleText(value) {
  if (/^\d{1,4}$/.test(value.trim())) return true;
  const words = value.match(/[A-Za-z][A-Za-z'’-]*/g) || [];
  const longerWords = words.filter((word) => word.length >= 3);
  const letters = (value.match(/[A-Za-z]/g) || []).length;
  const visibleCharacters = (value.match(/[A-Za-z0-9]/g) || []).length;
  const hasReadableWordShape = longerWords.length >= 2
    || (longerWords.length === 1 && words.length <= 3 && longerWords[0].length >= 4);

  return hasReadableWordShape && visibleCharacters > 0 && letters / visibleCharacters >= 0.75;
}

function isLikelyAuthorLine(value) {
  const words = value.split(/\s+/);
  return words.length >= 2
    && words.length <= 4
    && words.some((word) => /^[A-Z]/.test(word))
    && words.every((word) => /^[A-Za-z][A-Za-z'’-]*$/.test(word))
    && !words.some((word) => commonTitleWords.has(word.toLowerCase()));
}

function getLabeledValues(text) {
  const matches = [...text.matchAll(labeledFieldPattern)].filter((match, index, allMatches) => {
    const field = labelToField.get(match[1].toLowerCase());
    const lineStart = text.lastIndexOf('\n', match.index) + 1;
    const priorMatchOnLine = [...allMatches.slice(0, index)].reverse().find((candidate) => (
      candidate.index >= lineStart
    ));
    return field !== 'pages'
      || !priorMatchOnLine
      || labelToField.get(priorMatchOnLine[1].toLowerCase()) !== 'physical_description';
  });
  const values = {};

  matches.forEach((match, index) => {
    const label = match[1].toLowerCase();
    const field = labelToField.get(label);
    const start = match.index + match[0].length;
    const nextLabel = matches[index + 1]?.index ?? text.length;
    const nextLine = text.indexOf('\n', start);
    const end = nextLine >= 0 ? Math.min(nextLabel, nextLine) : nextLabel;
    const value = cleanValue(text.slice(start, end));
    if (field && value && !values[field]) values[field] = value;
  });

  return values;
}

function isMetadataLabelLine(line) {
  return /^(?:title|subtitle|author|by|publisher|published|place of publication|publication place|publication year|edition|isbn|pages|language|subject|keywords|classification|call number|ddc|notes|remarks|copyright)\b/i.test(line);
}

function extractIsbn(text) {
  const labeled = text.match(/\bISBN(?:-1[03])?\s*[:\-]?\s*([0-9Xx][0-9Xx \t-]{7,20})/i)?.[1];
  const candidates = [
    ...(labeled ? [labeled] : []),
    ...(text.match(/\b(?:97[89][ \t-]?)?(?:[0-9Xx][ \t-]?){9,13}[0-9Xx]\b/g) || []),
  ];

  for (const candidate of candidates) {
    const normalized = normalizeIsbn(candidate);
    if (isValidIsbn(normalized)) return normalized;
  }
  return '';
}

function extractYear(text) {
  return text.match(/\b(?:18|19|20|21)\d{2}\b/)?.[0] || '';
}

function extractPages(text) {
  return text.match(/\bpages?\s*[:\-]?\s*(\d{1,5})\b/i)?.[1]
    || text.match(/\b(\d{1,5})\s*(?:pages?|pp\.?)\b/i)?.[1]
    || '';
}

function splitTitleAndSubtitle(values) {
  if (!values.title || values.subtitle) return;
  const match = values.title.match(/^(.+?)\s*[:–—]\s+(.+)$/);
  if (match) {
    values.title = match[1].trim();
    values.subtitle = match[2].trim();
  }
}

export function extractMetadataFromText(rawText = '') {
  const text = String(rawText).replace(/\r\n?/g, '\n');
  const lines = text.split(/\n|\s{2,}/).map(cleanValue).filter(Boolean);
  const values = getLabeledValues(text);

  splitTitleAndSubtitle(values);

  if (!values.title) {
    const titleIndex = lines.findIndex((line) => (
      !isMetadataLabelLine(line)
      && !/^\d+$/.test(line)
      && !isLikelyAuthorLine(line)
      && isPlausibleText(line)
    ));
    if (titleIndex >= 0) {
      const titleLines = [lines[titleIndex]];
      const titleHasDisplayCaps = /[A-Z]/.test(lines[titleIndex])
        && (
          lines[titleIndex] === lines[titleIndex].toUpperCase()
          || /\b[A-Z]{3,}\b/.test(lines[titleIndex])
        );
      for (let index = titleIndex + 1; titleHasDisplayCaps && index < lines.length && titleLines.length < 3; index += 1) {
        const line = lines[index];
        if (
          isMetadataLabelLine(line)
          || isLikelyAuthorLine(line)
          || !isPlausibleText(line)
          || line !== line.toUpperCase()
          || !/[A-Z]/.test(line)
        ) break;
        titleLines.push(line);
      }
      values.title = titleLines.join(' ');
    }
  }
  if (!values.author) {
    values.author = text.match(/^\s*by[ \t]*(?:\n[ \t]*|[ \t]+)([^\n\r]+)/im)?.[1]?.trim() || '';
  }
  if (!values.author) {
    const authorLines = lines.filter((line) => isLikelyAuthorLine(line));
    if (authorLines.length) {
      values.author = [...new Set(authorLines)].join(' and ');
    }
  }
  if (!isPlausibleText(values.title || '')) values.title = '';
  if (!isPlausibleText(values.author || '')) values.author = '';

  values.isbn = extractIsbn(text) || (values.isbn ? extractIsbn(values.isbn) : '');
  values.publication_year = values.publication_year?.match(/\b(?:18|19|20|21)\d{2}\b/)?.[0] || extractYear(text);
  values.pages = values.pages?.match(/\d{1,5}/)?.[0] || extractPages(text);
  values.physical_description ||= lines.find((line) => /\b(illustrations|maps|volume|pp\.|diagrams|hardcover|hard cover|paperback|paper cover|\d+\s*cm)\b/i.test(line)) || '';
  values.subjects = values.subjects
    ? values.subjects.split(/[,;]|\s+\|\s+/).map(cleanValue).filter(Boolean)
    : lines.filter((line) => /^(?:subject|keywords?)\s*[:\-]/i.test(line))
      .map((line) => cleanValue(line.replace(/^(?:subject|keywords?)\s*[:\-]\s*/i, '')))
      .flatMap((line) => line.split(/[,;]|\s+\|\s+/).map(cleanValue).filter(Boolean))
      .slice(0, 5);

  return {
    title: values.title || '',
    subtitle: values.subtitle || '',
    author: values.author || '',
    publisher: values.publisher || '',
    publication_place: values.publication_place || '',
    publication_year: values.publication_year || '',
    edition: values.edition || '',
    isbn: values.isbn || '',
    pages: values.pages || '',
    language: values.language || '',
    physical_description: values.physical_description || '',
    subjects: values.subjects,
    ddc_number: values.ddc_number || '',
    call_number: values.call_number || '',
    notes: values.notes || '',
  };
}
