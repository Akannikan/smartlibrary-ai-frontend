const sharp = require('sharp');
const { createWorker, OEM } = require('tesseract.js');
const englishModel = require('@tesseract.js-data/eng');

const MAX_OCR_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_OCR_IMAGE_PIXELS = 40_000_000;
let workerPromise;

function decodeImage(dataUrl) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(dataUrl);
  if (!match) {
    throw Object.assign(new Error('Upload a valid PNG, JPEG, or WebP image.'), { status: 400 });
  }

  const image = Buffer.from(match[2], 'base64');
  if (!image.length || image.length > MAX_OCR_IMAGE_BYTES) {
    throw Object.assign(new Error('The image must be larger than 0 bytes and no more than 8 MB.'), { status: 413 });
  }

  const mimeType = match[1].toLowerCase();
  const hasValidSignature = mimeType === 'image/png'
    ? image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mimeType === 'image/jpeg'
      ? image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff
      : image.subarray(0, 4).toString() === 'RIFF' && image.subarray(8, 12).toString() === 'WEBP';

  if (!hasValidSignature) {
    throw Object.assign(new Error('The uploaded image format does not match its file type.'), { status: 400 });
  }

  return image;
}

async function prepareImage(image) {
  try {
    const metadata = await sharp(image, { limitInputPixels: MAX_OCR_IMAGE_PIXELS }).metadata();
    if (!metadata.width || !metadata.height) {
      throw Object.assign(new Error('The uploaded image is invalid.'), { status: 400 });
    }
    if (metadata.width * metadata.height > MAX_OCR_IMAGE_PIXELS) {
      throw Object.assign(new Error('The image dimensions are too large for OCR.'), { status: 413 });
    }

    return await sharp(image, { limitInputPixels: MAX_OCR_IMAGE_PIXELS })
      .rotate()
      .resize({ width: 2500, height: 2500, fit: 'inside', withoutEnlargement: true })
      .greyscale()
      .normalize()
      .sharpen()
      .png()
      .toBuffer();
  } catch (error) {
    if (error.status) throw error;
    throw Object.assign(new Error('The uploaded image is invalid or could not be prepared for OCR.'), { status: 400 });
  }
}

function getOCRWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng', OEM.LSTM_ONLY, {
      langPath: englishModel.langPath,
      gzip: englishModel.gzip,
    }).catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

async function recognizeImage(dataUrl) {
  const image = decodeImage(dataUrl);
  const preparedImage = await prepareImage(image);
  const worker = await getOCRWorker();
  const result = await worker.recognize(preparedImage);
  return result.data.text.trim();
}

async function terminateOCRWorker() {
  const worker = await workerPromise?.catch(() => null);
  workerPromise = null;
  if (worker) await worker.terminate();
}

module.exports = { recognizeImage, terminateOCRWorker };
