const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { recognizeImage, terminateOCRWorker } = require('./ocr');

test('rejects invalid image data URLs', async () => {
  await assert.rejects(
    recognizeImage('data:text/plain;base64,SGVsbG8='),
    { status: 400 },
  );
});

test('preprocesses and recognizes a clear title-page image on the hosted OCR engine', async (context) => {
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
