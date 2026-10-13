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

  const result = await recognizeImage(`data:image/png;base64,${image.toString('base64')}`);

  assert.match(result.text, /THE QUIET LIBRARY/i);
  assert.match(result.text, /JANE DOE/i);
  assert.ok(result.confidence >= 45);
});

test('recognizes a decorative cover with separate title and author lines', async (context) => {
  context.after(terminateOCRWorker);
  const image = await sharp(Buffer.from(`
    <svg width="1200" height="1500" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#f00050"/>
      <text x="230" y="130" font-family="serif" font-size="48" fill="#fff">CONN IGGULDEN</text>
      <text x="100" y="460" font-family="serif" font-size="100" font-weight="bold" fill="#ffe08a">THE DANGEROUS</text>
      <text x="310" y="620" font-family="serif" font-size="100" font-weight="bold" fill="#ffe08a">BOOK FOR BOYS</text>
      <text x="400" y="1390" font-family="serif" font-size="48" fill="#fff">HAL IGGULDEN</text>
    </svg>
  `)).png().toBuffer();

  const result = await recognizeImage(`data:image/png;base64,${image.toString('base64')}`);

  assert.match(result.text, /DANGEROUS/i);
  assert.match(result.text, /CONN IGGULDEN/i);
  assert.match(result.text, /HAL IGGULDEN/i);
  assert.ok(result.confidence >= 45);
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
  assert.ok(results.every((result) => /SECOND TEST BOOK/i.test(result.text)));
});
