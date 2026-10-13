const test = require('node:test');
const assert = require('node:assert/strict');
const { searchBooks, inferDeweyNumber } = require('./bookLookup');

const dangerousBook = {
  title: 'The Dangerous Book for Boys',
  author_name: ['Conn Iggulden', 'Hal Iggulden'],
  subject: [
    'Handbooks, vade-mecums',
    'Recreation',
    'Boys',
    'Outdoor Skills',
    'Reference',
  ],
};

test('matches a book by title and author and returns subjects with a reviewed DDC suggestion', async () => {
  const queries = [];
  const result = await searchBooks(
    { title: 'The Dangerous Book for Boys', author: 'Gonn Iggulden' },
    async (url) => {
      queries.push({
        title: url.searchParams.get('title'),
        author: url.searchParams.get('author'),
      });
      return { ok: true, json: async () => ({ docs: [dangerousBook] }) };
    },
  );

  assert.equal(queries.some(({ title, author }) => (
    title?.includes('Dangerous Book') && author === 'Gonn Iggulden'
  )), true);
  assert.equal(queries.some(({ title, author }) => (
    title?.includes('Dangerous Book') && !author
  )), true);
  assert.equal(result.match.title, dangerousBook.title);
  assert.equal(result.match.author, 'Conn Iggulden; Hal Iggulden');
  assert.equal(result.match.ddc_number, '796.5');
  assert.equal(result.match.call_number, '796.5 IGG');
  assert.equal(result.match.classification_source, 'Suggested from subject headings');
  assert.deepEqual(result.match.subjects, dangerousBook.subject);
});

test('returns author-based candidates instead of guessing when OCR misses the title', async () => {
  const queries = [];
  const result = await searchBooks(
    { title: 'The', author: 'Gonn Iggulden' },
    async (url) => {
      queries.push({
        title: url.searchParams.get('title'),
        author: url.searchParams.get('author'),
      });
      return { ok: true, json: async () => ({ docs: [dangerousBook] }) };
    },
  );

  assert.equal(queries.some(({ title, author }) => !title && author === 'iggulden'), true);
  assert.equal(result.match, null);
  assert.equal(result.candidates[0].title, dangerousBook.title);
  assert.equal(result.candidates[0].authorMatch, true);
});

test('retries an OCR-confused lowercase l as an uppercase I in the author surname', async () => {
  const queries = [];
  const result = await searchBooks(
    { title: 'The', author: 'Gonn lggulden' },
    async (url) => {
      const author = url.searchParams.get('author');
      queries.push(author);
      return {
        ok: true,
        json: async () => (author === 'iggulden' ? { docs: [dangerousBook] } : { docs: [] }),
      };
    },
  );

  assert.equal(queries.includes('iggulden'), true);
  assert.equal(result.candidates[0].title, dangerousBook.title);
  assert.equal(result.candidates[0].authorMatch, true);
});

test('rejects non-matching search results for automatic application', async () => {
  const result = await searchBooks(
    { title: 'The Quiet Library', author: 'Jane Doe' },
    async () => ({
      ok: true,
      json: async () => ({ docs: [dangerousBook] }),
    }),
  );

  assert.equal(result.match, null);
  assert.equal(result.candidates.length, 1);
});

test('does not auto-select a different title that only contains all OCR title words', async () => {
  const result = await searchBooks(
    { title: 'The Dangerous Book for Boys', author: 'Gonn Iggulden' },
    async () => ({
      ok: true,
      json: async () => ({
        docs: [{
          ...dangerousBook,
          title: 'El libro peligroso de bolsillo / The Pocket Dangerous Book for Boys',
        }],
      }),
    }),
  );

  assert.equal(result.match, null);
  assert.equal(result.candidates[0].titleSimilarity < 85, true);
});

test('surfaces errors from the public catalogue instead of treating them as no match', async () => {
  await assert.rejects(
    () => searchBooks(
      { title: 'The Dangerous Book for Boys', author: 'Conn Iggulden' },
      async () => ({ ok: false, status: 503 }),
    ),
    { status: 502, message: 'Open Library search failed (HTTP 503).' },
  );
});

test('uses a valid ISBN to select the matching book even when the title was not read', async () => {
  const book = { ...dangerousBook, isbn: ['9780060761274'] };
  const result = await searchBooks(
    { isbn: '978-0-06-076127-4' },
    async (url) => {
      assert.equal(url.searchParams.get('isbn'), '9780060761274');
      return { ok: true, json: async () => ({ docs: [book] }) };
    },
  );

  assert.equal(result.match.title, dangerousBook.title);
  assert.equal(result.match.isbnMatch, true);
});

test('searches title-only when OCR has a useful one-word title and no author', async () => {
  const result = await searchBooks(
    { title: 'Hamlet' },
    async (url) => {
      assert.equal(url.searchParams.get('title'), 'Hamlet');
      return {
        ok: true,
        json: async () => ({ docs: [{ ...dangerousBook, title: 'Hamlet' }] }),
      };
    },
  );

  assert.equal(result.candidates[0].title, 'Hamlet');
});

test('prefers subject-based classifications for outdoor/reference books', () => {
  assert.deepEqual(
    inferDeweyNumber(['Handbooks', 'Outdoor Skills', 'Reference']),
    { number: '796.5', source: 'Suggested from subject headings' },
  );
  assert.deepEqual(
    inferDeweyNumber([], ['823.914']),
    { number: '823.914', source: 'Open Library' },
  );
});
