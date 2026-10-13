export function extractMetadataFromText(rawText = '') {
  const text = rawText || '';
  const lines = text.split(/\r?\n|\s{2,}/).map((line) => line.trim()).filter(Boolean);
  const pickFirst = (patterns) => {
    for (const pattern of patterns) {
      const match = text.match(new RegExp(pattern, 'i'));
      if (match && match[1]) return match[1].trim();
    }
    return '';
  };

  return {
    title: pickFirst([
      /title\s*[:\-]?\s*(.+)/i,
      /book\s*title\s*[:\-]?\s*(.+)/i,
      /^(.+)$/i,
    ]),
    author: pickFirst([
      /author\s*[:\-]?\s*(.+)/i,
      /by\s+(.+)/i,
    ]),
    publisher: pickFirst([
      /publisher\s*[:\-]?\s*(.+)/i,
      /published\s+by\s+(.+)/i,
    ]),
    publication_place: pickFirst([
      /place\s+of\s+publication\s*[:\-]?\s*(.+)/i,
      /published\s+in\s+(.+)/i,
    ]),
    publication_year: pickFirst([
      /publication\s+year\s*[:\-]?\s*(\d{4})/i,
      /published\s*(\d{4})/i,
    ]),
    edition: pickFirst([
      /edition\s*[:\-]?\s*(.+)/i,
    ]),
    isbn: pickFirst([
      /isbn(?:-13|-10)?\s*[:\-]?\s*([0-9Xx\-]+)/i,
      /(?:978|979)[0-9Xx\-]{10,}/i,
    ]),
    pages: pickFirst([
      /pages\s*[:\-]?\s*(\d+)/i,
      /\b(\d+)\s+pages\b/i,
    ]),
    physical_description: lines.find((line) => /\b(illustrations|maps|volume|pp\.|diagrams)/i.test(line)) || '',
    subjects: lines.filter((line) => /subject|keywords|classification/i.test(line)).slice(0, 3),
  };
}
