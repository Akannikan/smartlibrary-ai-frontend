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
  const result = await searchBooks(
    { title: 'The Dangerous Book for Boys', author: 'Gonn Iggulden' },
    async (url) => {
      assert.match(url.searchParams.get('title'), /Dangerous Book/);
      assert.equal(url.searchParams.get('author'), 'Gonn Iggulden');
      return { ok: true, json: async () => ({ docs: [dangerousBook] }) };
    },
  );

  assert.equal(result.match.title, dangerousBook.title);
  assert.equal(result.match.author, 'Conn Iggulden; Hal Iggulden');
  assert.equal(result.match.ddc_number, '796.5');
  assert.equal(result.match.call_number, '796.5 IGG');
  assert.equal(result.match.classification_source, 'Suggested from subject headings');
  assert.deepEqual(result.match.subjects, dangerousBook.subject);
});

test('returns author-based candidates instead of guessing when OCR misses the title', async () => {
  const result = await searchBooks(
    { title: 'The', author: 'Gonn Iggulden' },
    async (url) => {
      assert.equal(url.searchParams.get('title'), null);
      assert.equal(url.searchParams.get('author'), 'iggulden');
      return { ok: true, json: async () => ({ docs: [dangerousBook] }) };
    },
  );

  assert.equal(result.match, null);
  assert.equal(result.candidates[0].title, dangerousBook.title);
  assert.equal(result.candidates[0].authorMatch, true);
});

test('retries an OCR-confused lowercase l as an uppercase I in the author surname', async () => {
  const result = await searchBooks(
    { title: 'The', author: 'Gonn lggulden' },
    async (url) => ({
      ok: true,
      json: async () => (
        url.searchParams.get('author') === 'iggulden'
          ? { docs: [dangerousBook] }
          : { docs: [] }
      ),
    }),
  );

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
