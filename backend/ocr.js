const MAX_OCR_IMAGE_BYTES = 7 * 1024 * 1024;
const VISION_API_URL = 'https://vision.googleapis.com/v1/images:annotate';

function invalidImage(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function decodeImage(dataUrl) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(dataUrl);
  if (!match) {
    throw invalidImage('Upload a valid PNG, JPEG, or WebP image.');
  }

  const image = Buffer.from(match[2], 'base64');
  if (!image.length || image.length > MAX_OCR_IMAGE_BYTES) {
    throw invalidImage('The image must be larger than 0 bytes and no more than 7 MB.', 413);
  }

  const mimeType = match[1].toLowerCase();
  const hasValidSignature = mimeType === 'image/png'
    ? image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mimeType === 'image/jpeg'
      ? image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff
      : image.subarray(0, 4).toString() === 'RIFF' && image.subarray(8, 12).toString() === 'WEBP';

  if (!hasValidSignature) {
    throw invalidImage('The uploaded image format does not match its file type.');
  }

  return image;
}

async function recognizeImage(dataUrl) {
  const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;
  if (!apiKey) {
    throw Object.assign(
      new Error('Google Cloud Vision is not configured. Add GOOGLE_CLOUD_VISION_API_KEY to the backend environment.'),
      { status: 503 },
    );
  }

  const image = decodeImage(dataUrl);
  let response;
  try {
    response = await fetch(VISION_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
      },
      body: JSON.stringify({
        requests: [{
          image: { content: image.toString('base64') },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw Object.assign(new Error('Google Cloud Vision timed out. Please try again.'), { status: 504 });
    }
    throw Object.assign(new Error('Could not connect to Google Cloud Vision. Please try again.'), { status: 503 });
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw Object.assign(
        new Error('Google Cloud Vision rejected the request. Check the API key, enabled Vision API, and billing settings.'),
        { status: 502 },
      );
    }
    if (response.status === 429) {
      throw Object.assign(new Error('Google Cloud Vision quota exceeded. Check the project quota and billing settings.'), { status: 503 });
    }
    throw Object.assign(new Error('Google Cloud Vision could not process this image. Please try again.'), { status: 502 });
  }

  const result = await response.json();
  const annotation = result.responses?.[0];
  if (annotation?.error) {
    if (annotation.error.code === 8) {
      throw Object.assign(new Error('Google Cloud Vision quota exceeded. Check the project quota and billing settings.'), { status: 503 });
    }
    throw Object.assign(new Error('Google Cloud Vision could not read this image. Try a clearer image.'), { status: 422 });
  }

  return annotation?.fullTextAnnotation?.text?.trim()
    || annotation?.textAnnotations?.[0]?.description?.trim()
    || '';
}

module.exports = { recognizeImage };
