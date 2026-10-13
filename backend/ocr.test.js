const test = require('node:test');
const assert = require('node:assert/strict');
const { recognizeImage } = require('./ocr');

const validPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/TioAAAAASUVORK5CYII=';

function setTestApiKey(context, value) {
  const previousKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;
  if (value === undefined) delete process.env.GOOGLE_CLOUD_VISION_API_KEY;
  else process.env.GOOGLE_CLOUD_VISION_API_KEY = value;
  context.after(() => {
    if (previousKey === undefined) delete process.env.GOOGLE_CLOUD_VISION_API_KEY;
    else process.env.GOOGLE_CLOUD_VISION_API_KEY = previousKey;
  });
}

test('requires Google Cloud Vision to be configured', async (context) => {
  setTestApiKey(context, undefined);

  await assert.rejects(
    recognizeImage(validPng),
    { status: 503, message: /GOOGLE_CLOUD_VISION_API_KEY/ },
  );
});

test('rejects unsupported and malformed image data URLs', async (context) => {
  context.mock.method(global, 'fetch', async () => {
    throw new Error('fetch must not be called for an invalid image');
  });
  setTestApiKey(context, 'test-key');

  await assert.rejects(
    recognizeImage('data:text/plain;base64,SGVsbG8='),
    { status: 400 },
  );
  await assert.rejects(
    recognizeImage('data:image/jpeg;base64,SGVsbG8='),
    { status: 400, message: /does not match/ },
  );
});

test('rejects images larger than the provider request limit', async (context) => {
  context.mock.method(global, 'fetch', async () => {
    throw new Error('fetch must not be called for an oversized image');
  });
  setTestApiKey(context, 'test-key');
  const oversizedPng = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.alloc(7 * 1024 * 1024),
  ]);

  await assert.rejects(
    recognizeImage(`data:image/png;base64,${oversizedPng.toString('base64')}`),
    { status: 413, message: /no more than 7 MB/ },
  );
});

test('sends the image to document-text detection and returns recognized text', async (context) => {
  setTestApiKey(context, 'test-key');
  let requestUrl;
  let requestBody;
  let requestHeaders;
  context.mock.method(global, 'fetch', async (url, options) => {
    requestUrl = url;
    requestHeaders = options.headers;
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      responses: [{ fullTextAnnotation: { text: 'THE QUIET LIBRARY\nBY JANE DOE' } }],
    }), { status: 200 });
  });

  const text = await recognizeImage(validPng);

  assert.equal(text, 'THE QUIET LIBRARY\nBY JANE DOE');
  assert.equal(requestUrl, 'https://vision.googleapis.com/v1/images:annotate');
  assert.equal(requestHeaders['X-Goog-Api-Key'], 'test-key');
  assert.equal(requestBody.requests[0].features[0].type, 'DOCUMENT_TEXT_DETECTION');
  assert.equal(requestBody.requests[0].image.content, Buffer.from(validPng.split(',')[1], 'base64').toString('base64'));
});

test('reports invalid Google Cloud Vision credentials without exposing provider errors', async (context) => {
  setTestApiKey(context, 'test-key');
  context.mock.method(global, 'fetch', async () => new Response('forbidden', { status: 403 }));

  await assert.rejects(
    recognizeImage(validPng),
    { status: 502, message: /Check the API key/ },
  );
});

test('returns an empty string when the provider finds no text', async (context) => {
  setTestApiKey(context, 'test-key');
  context.mock.method(global, 'fetch', async () => new Response(
    JSON.stringify({ responses: [{}] }),
    { status: 200 },
  ));

  assert.equal(await recognizeImage(validPng), '');
});

test('reports provider quota exhaustion as a service-unavailable error', async (context) => {
  setTestApiKey(context, 'test-key');
  context.mock.method(global, 'fetch', async () => new Response(
    JSON.stringify({ responses: [{ error: { code: 8, message: 'quota exceeded' } }] }),
    { status: 200 },
  ));

  await assert.rejects(
    recognizeImage(validPng),
    { status: 503, message: /quota exceeded/i },
  );
});
