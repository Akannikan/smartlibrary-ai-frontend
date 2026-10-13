import { useState } from 'react';
import api from '../services/api';
import { extractMetadataFromText } from '../services/cataloguing';

const MAX_OCR_IMAGE_BYTES = 7 * 1024 * 1024;
const MAX_OCR_REQUEST_IMAGE_BYTES = 3 * 1024 * 1024;
const MIN_OCR_CONFIDENCE = 45;
const MIN_OCR_WORD_COUNT = 4;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('The selected image could not be opened.'));
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The selected image could not be prepared for OCR.'));
    }, 'image/jpeg', quality);
  });
}

async function prepareOCRImage(file) {
  const image = await loadImage(file);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot prepare the image for OCR.');

  let maxDimension = 2200;
  let quality = 0.86;
  let blob;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    blob = await canvasToBlob(canvas, quality);
    if (blob.size <= MAX_OCR_REQUEST_IMAGE_BYTES) break;
    maxDimension = Math.round(maxDimension * 0.8);
    quality = Math.max(0.62, quality - 0.08);
  }

  if (!blob || blob.size > MAX_OCR_REQUEST_IMAGE_BYTES) {
    throw new Error('The image could not be compressed enough to send for OCR. Try a smaller image.');
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Unable to read the selected image.'));
    reader.readAsDataURL(blob);
  });
}

const emptyForm = {
  title: '',
  subtitle: '',
  author: '',
  publisher: '',
  publication_place: '',
  publication_year: '',
  edition: '',
  isbn: '',
  pages: '',
  language: '',
  physical_description: '',
  subjects: '',
  ddc_number: '',
  call_number: '',
  notes: '',
  accession_number: '',
  accession_date: '',
  source_of_acquisition: '',
  price: '',
  condition: '',
  status: 'available',
  remarks: '',
  rawText: '',
};

export default function AddBookPage() {
  const [form, setForm] = useState(emptyForm);
  const [imagePreview, setImagePreview] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [ocrProgress, setOcrProgress] = useState(null);
  const [suggestions, setSuggestions] = useState(null);
  const [lastOCRText, setLastOCRText] = useState('');
  const [lastOCRFields, setLastOCRFields] = useState({});

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };

  const handleImageUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setError('');
    setSuccess('');
    setLastOCRText('');
    setForm((current) => {
      const next = { ...current, rawText: '' };
      Object.entries(lastOCRFields).forEach(([field, detectedValue]) => {
        const currentValue = current[field];
        const previousDetectedValue = Array.isArray(detectedValue)
          ? detectedValue.join(', ')
          : detectedValue;
        if (currentValue === previousDetectedValue) next[field] = emptyForm[field];
      });
      return next;
    });
    setLastOCRFields({});
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result);
    reader.readAsDataURL(file);
  };

  const handleRemoveImage = () => {
    setImagePreview('');
    setImageFile(null);
  };

  const handleExtract = async () => {
    if (!imageFile && !form.rawText.trim()) {
      setError('Upload an image or enter OCR text before extracting metadata.');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');
    setOcrProgress(null);

    try {
      const rawTextBeforeExtraction = form.rawText.trim();
      const manualText = imageFile && rawTextBeforeExtraction === lastOCRText.trim()
        ? ''
        : rawTextBeforeExtraction;
      let rawText = rawTextBeforeExtraction;
      let ocrConfidence;
      let ocrWordCount;

      if (imageFile) {
        if (imageFile.size > MAX_OCR_IMAGE_BYTES) {
          throw new Error('The image must be 7 MB or smaller for OCR.');
        }

        setOcrProgress('Sending image to the library server');
        const image = await prepareOCRImage(imageFile);
        setOcrProgress('Reading text with the built-in OCR engine');
        const result = await api.extractText({ image, rawText: manualText });
        rawText = result.extractedText || '';
        ocrConfidence = result.ocrConfidence;
        ocrWordCount = result.ocrWordCount;
        setLastOCRText(rawText);
      }

      if (!rawText) {
        throw new Error('No text was detected. Try a clearer image or enter the details manually.');
      }

      const reliableOCR = Number(ocrConfidence) >= MIN_OCR_CONFIDENCE
        && Number(ocrWordCount) >= MIN_OCR_WORD_COUNT;
      const fields = imageFile && !manualText && !reliableOCR
        ? {}
        : extractMetadataFromText(rawText);
      const recognizedFields = imageFile && !manualText
        && reliableOCR
        ? fields
        : {};
      setLastOCRFields(recognizedFields);
      setForm((current) => {
        const extracted = Object.fromEntries(
          Object.entries(fields).filter(([, value]) => (
            Array.isArray(value) ? value.length > 0 : Boolean(value)
          )),
        );
        return {
          ...current,
          ...extracted,
          rawText,
          subjects: fields.subjects?.length ? fields.subjects.join(', ') : current.subjects,
        };
      });
      setSuccess(
        imageFile && !manualText && !reliableOCR
          ? 'Text was detected, but it was not clear enough to fill the fields reliably. Try a straight, well-lit photo of the inside title page. SmartLibrary does not store uploaded images.'
          : imageFile
            ? 'Image processed by the built-in English OCR engine. SmartLibrary does not store uploaded images. Review the detected details before saving.'
          : 'Text extracted. Review the detected details before saving.',
      );
    } catch (err) {
      setError(err.message || 'Unable to extract text.');
    } finally {
      setOcrProgress(null);
      setLoading(false);
    }
  };

  const handleSuggest = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.suggestCataloguing({
        title: form.title,
        author: form.author,
        publisher: form.publisher,
        publication_place: form.publication_place,
        publication_year: form.publication_year,
        edition: form.edition,
        isbn: form.isbn,
        pages: form.pages,
        physical_description: form.physical_description,
        subjects: form.subjects ? form.subjects.split(',').map((item) => item.trim()) : [],
      });
      setSuggestions(result.suggestions || null);
      if (result.message) setSuccess(result.message);
    } catch (err) {
      setError(err.message || 'Unable to generate suggestions.');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.approveRecord({ title: form.title, author: form.author, accession_number: form.accession_number });
      setSuccess(result.message || 'Approved for save.');
    } catch (err) {
      setError(err.message || 'Approval failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const payload = {
        ...form,
        subjects: form.subjects ? form.subjects.split(',').map((item) => item.trim()).filter(Boolean) : [],
      };
      const result = await api.createBook(payload);
      setSuccess(`Record saved successfully with accession number ${form.accession_number}.`);
      setForm(emptyForm);
      setSuggestions(null);
      setImagePreview('');
      setLastOCRText('');
      setLastOCRFields({});
    } catch (err) {
      setError(err.message || 'Unable to save the record.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Add Book</h1>
        <p className="text-sm text-slate-600">Upload a title page to fill in the details that can be read from it. The accession number and library-specific details must be entered separately.</p>
      </div>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {success ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{success}</div> : null}

      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.5fr]">
        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-900">Book image</h2>
          <div className="mt-4">
            <label className="flex h-48 cursor-pointer items-center justify-center rounded-xl border border-dashed border-stone-300 bg-stone-50 text-center text-sm text-slate-500">
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleImageUpload} />
              {imagePreview ? <img src={imagePreview} alt="Book cover preview" className="h-full w-full rounded-xl object-contain" /> : 'Upload front cover or title page image'}
            </label>
            {imagePreview ? (
              <button type="button" onClick={handleRemoveImage} className="mt-3 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-stone-100">
                Remove image
              </button>
            ) : null}
          </div>
          <div className="mt-4">
            <label className="block text-sm font-medium text-slate-700">OCR text</label>
            <textarea value={form.rawText} onChange={updateField('rawText')} rows="8" className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-2" placeholder="Extracted text will appear here. You can also enter text manually." />
            <p className="mt-2 text-xs text-slate-500">For best results, upload a straight, well-lit photo of the inside title page; decorative front covers are harder to read and may not show publisher, year, or ISBN. Images up to 7 MB are compressed in your browser and processed by the built-in English OCR engine on the library server. No external OCR account or API key is needed; images are not stored.</p>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={handleExtract} className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-900" disabled={loading}>{ocrProgress ? `${ocrProgress}…` : 'Extract metadata'}</button>
            <button onClick={handleSuggest} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-stone-100" disabled={loading}>Suggest</button>
          </div>
          {ocrProgress ? <p className="mt-2 text-sm text-slate-500" role="status">{ocrProgress}…</p> : null}
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Title</span>
              <input value={form.title} onChange={updateField('title')} className="w-full rounded-lg border border-stone-300 px-3 py-2" />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Author</span>
              <input value={form.author} onChange={updateField('author')} className="w-full rounded-lg border border-stone-300 px-3 py-2" />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Subtitle</span>
              <input value={form.subtitle} onChange={updateField('subtitle')} className="w-full rounded-lg border border-stone-300 px-3 py-2" />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Publisher</span>
              <input value={form.publisher} onChange={updateField('publisher')} className="w-full rounded-lg border border-stone-300 px-3 py-2" />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Publication place</span>
              <input value={form.publication_place} onChange={updateField('publication_place')} className="w-full rounded-lg border border-stone-300 px-3 py-2" />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Publication year</span>
              <input value={form.publication_year} onChange={updateField('publication_year')} className="w-full rounded-lg border border-stone-300 px-3 py-2" />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Edition</span>
              <input value={form.edition} onChange={updateField('edition')} className="w-full rounded-lg border border-stone-300 px-3 py-2" />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>ISBN</span>
              <input value={form.isbn} onChange={updateField('isbn')} className="w-full rounded-lg border border-stone-300 px-3 py-2" />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Pages</span>
              <input value={form.pages} onChange={updateField('pages')} className="w-full rounded-lg border border-stone-300 px-3 py-2" />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Language</span>
              <input value={form.language} onChange={updateField('language')} className="w-full rounded-lg border border-stone-300 px-3 py-2" />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Physical description</span>
              <input value={form.physical_description} onChange={updateField('physical_description')} className="w-full rounded-lg border border-stone-300 px-3 py-2" />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Subjects</span>
              <input value={form.subjects} onChange={updateField('subjects')} className="w-full rounded-lg border border-stone-300 px-3 py-2" />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>DDC number</span>
              <input value={form.ddc_number} onChange={updateField('ddc_number')} className="w-full rounded-lg border border-stone-300 px-3 py-2" />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Call number</span>
              <input value={form.call_number} onChange={updateField('call_number')} className="w-full rounded-lg border border-stone-300 px-3 py-2" />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Accession number</span>
              <input value={form.accession_number} onChange={updateField('accession_number')} className="w-full rounded-lg border border-stone-300 px-3 py-2" />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Accession date</span>
              <input type="date" value={form.accession_date} onChange={updateField('accession_date')} className="w-full rounded-lg border border-stone-300 px-3 py-2" />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Source of acquisition</span>
              <input value={form.source_of_acquisition} onChange={updateField('source_of_acquisition')} className="w-full rounded-lg border border-stone-300 px-3 py-2" />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Price</span>
              <input value={form.price} onChange={updateField('price')} className="w-full rounded-lg border border-stone-300 px-3 py-2" />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Condition</span>
              <select value={form.condition} onChange={updateField('condition')} className="w-full rounded-lg border border-stone-300 px-3 py-2">
                <option value="">Select</option>
                <option value="new">New</option>
                <option value="good">Good</option>
                <option value="fair">Fair</option>
                <option value="damaged">Damaged</option>
              </select>
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Status</span>
              <select value={form.status} onChange={updateField('status')} className="w-full rounded-lg border border-stone-300 px-3 py-2">
                <option value="available">Available</option>
                <option value="processing">Processing</option>
                <option value="missing">Missing</option>
              </select>
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700 md:col-span-2">
              <span>Notes</span>
              <textarea value={form.notes} onChange={updateField('notes')} rows="4" className="w-full rounded-lg border border-stone-300 px-3 py-2" />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700 md:col-span-2">
              <span>Remarks</span>
              <textarea value={form.remarks} onChange={updateField('remarks')} rows="3" className="w-full rounded-lg border border-stone-300 px-3 py-2" />
            </label>
          </div>

          {suggestions ? (
            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <h3 className="text-lg font-semibold text-amber-900">AI suggestions (review required)</h3>
              <ul className="mt-3 space-y-2 text-sm text-amber-900">
                <li><strong>Title:</strong> {suggestions.title}</li>
                <li><strong>Author:</strong> {suggestions.author}</li>
                <li><strong>Publisher:</strong> {suggestions.publisher}</li>
                <li><strong>Edition:</strong> {suggestions.edition}</li>
                <li><strong>DDC:</strong> {suggestions.ddc_number}</li>
                <li><strong>Call Number:</strong> {suggestions.call_number}</li>
              </ul>
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-3">
            <button onClick={handleApprove} className="rounded-lg border border-emerald-300 bg-emerald-100 px-4 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-200" disabled={loading}>Approve</button>
            <button onClick={handleSave} className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700" disabled={loading}>Save record</button>
          </div>
        </div>
      </div>
    </div>
  );
}
