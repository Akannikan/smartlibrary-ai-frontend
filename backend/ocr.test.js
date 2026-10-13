const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { recognizeImage, terminateOCRWorker } = require('./ocr');

test('rejects unsupported image data URLs', () => {
  assert.throws(
    () => recognizeImage('data:text/plain;base64,SGVsbG8='),
    { status: 400 },
  );
});

test('rejects image data with a mismatched signature', () => {
  assert.throws(
    () => recognizeImage('data:image/jpeg;base64,SGVsbG8='),
    { status: 400, message: /does not match/ },
  );
});

test('rejects images larger than 7 MB', () => {
  const oversizedPng = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.alloc(7 * 1024 * 1024),
  ]);

  assert.throws(
    () => recognizeImage(`data:image/png;base64,${oversizedPng.toString('base64')}`),
    { status: 413, message: /no more than 7 MB/ },
  );
});

test('recognizes a clear title page using the bundled English Tesseract model', async (context) => {
  context.after(terminateOCRWorker);
  const image = await sharp(Buffer.from(`
    <svg width="1600" height="500" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="white"/>
      <text x="100" y="190" font-family="sans-serif" font-size="100" fill="black">THE QUIET LIBRARY</text>
      <text x="100" y="330" font-family="sans-serif" font-size="64" fill="black">BY JANE DOE</text>
    </svg>
  `)).png().toBuffer();

  const text = await recognizeImage(`data:image/png;base64,${image.toString('base64')}`);

  assert.match(text, /THE QUIET LIBRARY/i);
  assert.match(text, /JANE DOE/i);
});

test('queues concurrent OCR jobs on the shared worker', async (context) => {
  context.after(terminateOCRWorker);
  const image = await sharp(Buffer.from(`
    <svg width="1200" height="300" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="white"/>
      <text x="80" y="190" font-family="sans-serif" font-size="90" fill="black">SECOND TEST BOOK</text>
    </svg>
  `)).png().toBuffer();
  const dataUrl = `data:image/png;base64,${image.toString('base64')}`;

  const results = await Promise.all([recognizeImage(dataUrl), recognizeImage(dataUrl)]);

  assert.equal(results.length, 2);
  assert.ok(results.every((text) => /SECOND TEST BOOK/i.test(text)));
});
