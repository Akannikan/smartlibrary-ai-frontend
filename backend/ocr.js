const sharp = require('sharp');
const { createWorker, OEM, PSM } = require('tesseract.js');
const englishModel = require('@tesseract.js-data/eng');

const MAX_OCR_IMAGE_BYTES = 7 * 1024 * 1024;
const MAX_OCR_IMAGE_PIXELS = 40_000_000;
const MIN_OCR_CONFIDENCE = 45;
const MIN_OCR_WORD_COUNT = 4;
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

async function prepareImage(image, channel = 'grey') {
  try {
    let pipeline = sharp(image, { limitInputPixels: MAX_OCR_IMAGE_PIXELS })
      .rotate()
      .resize({ width: 2500, height: 2500, fit: 'inside', withoutEnlargement: true });
    const metadata = await pipeline.metadata();
    if (!metadata.width || !metadata.height) {
      throw invalidImage('The uploaded image is invalid.');
    }
    if (metadata.width * metadata.height > MAX_OCR_IMAGE_PIXELS) {
      throw invalidImage('The image dimensions are too large for OCR.', 413);
    }

    pipeline = (channel === 'green' ? pipeline.extractChannel('green') : pipeline.greyscale())
      .normalize()
      .sharpen()
      .png();
    return await pipeline.toBuffer();
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
  const greyImage = await prepareImage(image, 'red');
  const worker = await getOCRWorker();
  const candidates = [];
  const recognize = async (source, mode) => {
    await worker.setParameters({ tessedit_pageseg_mode: mode });
    const result = await worker.recognize(source);
    const text = result.data.text.trim();
    const words = text.match(/[a-z]+(?:['’-][a-z]+)*/gi) || [];
    const readableWordRatio = words.length
      ? words.filter((word) => /^[a-z][a-z'’-]+$/i.test(word)).length / words.length
      : 0;
    const shortWordRatio = words.length
      ? words.filter((word) => word.length <= 2).length / words.length
      : 1;
    const confidence = Number.isFinite(result.data.confidence) ? result.data.confidence : 0;

    const candidate = {
      text,
      confidence,
      wordCount: words.length,
      score: confidence * 0.5
        + readableWordRatio * 20
        + Math.min(words.length, 12) * 4
        - shortWordRatio * 15,
    };
    candidates.push(candidate);
    return candidate;
  };

  const isReadable = (candidate) => candidate.confidence >= MIN_OCR_CONFIDENCE
    && candidate.wordCount >= MIN_OCR_WORD_COUNT;
  const primary = await recognize(greyImage, PSM.AUTO);
  if (isReadable(primary)) {
    return {
      text: primary.text,
      confidence: Math.round(primary.confidence),
      wordCount: primary.wordCount,
    };
  }

  const block = await recognize(greyImage, PSM.SINGLE_BLOCK);
  if (!isReadable(block)) {
    const sparse = await recognize(greyImage, PSM.SPARSE_TEXT);
    if (!isReadable(sparse)) {
      const greenImage = await prepareImage(image, 'green');
      await recognize(greenImage, PSM.SPARSE_TEXT);
    }
  }

  const best = candidates.reduce((selected, candidate) => (
    candidate.score > selected.score ? candidate : selected
  ));
  return {
    text: best.text,
    confidence: Math.round(best.confidence),
    wordCount: best.wordCount,
  };
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
