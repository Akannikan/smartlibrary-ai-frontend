const sharp = require('sharp');
const { createWorker, OEM } = require('tesseract.js');
const englishModel = require('@tesseract.js-data/eng');

const MAX_OCR_IMAGE_BYTES = 7 * 1024 * 1024;
const MAX_OCR_IMAGE_PIXELS = 40_000_000;
let workerPromise;
let recognitionQueue = Promise.resolve();

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

async function prepareImage(image) {
  try {
    const metadata = await sharp(image, { limitInputPixels: MAX_OCR_IMAGE_PIXELS }).metadata();
    if (!metadata.width || !metadata.height) {
      throw invalidImage('The uploaded image is invalid.');
    }
    if (metadata.width * metadata.height > MAX_OCR_IMAGE_PIXELS) {
      throw invalidImage('The image dimensions are too large for OCR.', 413);
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
    throw invalidImage('The uploaded image is invalid or could not be prepared for OCR.');
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

async function runRecognition(image) {
  const preparedImage = await prepareImage(image);
  const worker = await getOCRWorker();
  const result = await worker.recognize(preparedImage);
  return result.data.text.trim();
}

function recognizeImage(dataUrl) {
  const image = decodeImage(dataUrl);
  const recognition = recognitionQueue.then(() => runRecognition(image));
  recognitionQueue = recognition.catch(() => {});
  return recognition;
}

async function terminateOCRWorker() {
  const worker = await workerPromise?.catch(() => null);
  workerPromise = null;
  if (worker) await worker.terminate();
}

module.exports = { recognizeImage, terminateOCRWorker };
