import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelSource = path.join(
  frontendDirectory,
  'node_modules',
  '@tesseract.js-data',
  'eng',
  '4.0.0_best_int',
  'eng.traineddata.gz'
);
const modelDirectory = path.join(frontendDirectory, 'public', 'tesseract-data');

await mkdir(modelDirectory, { recursive: true });
await copyFile(modelSource, path.join(modelDirectory, 'eng.traineddata.gz'));
