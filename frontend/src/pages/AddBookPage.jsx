import { useState } from 'react';
import api from '../services/api';
import { extractMetadataFromText } from '../services/cataloguing';

const MAX_OCR_IMAGE_BYTES = 7 * 1024 * 1024;
const MAX_OCR_REQUEST_IMAGE_BYTES = 3 * 1024 * 1024;
const MIN_OCR_CONFIDENCE = 45;
const MIN_OCR_WORD_COUNT = 4;
const inputClassName = 'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-100';

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
  const [lookupCandidates, setLookupCandidates] = useState([]);
  const [lookupMessage, setLookupMessage] = useState('');
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
    setLookupCandidates([]);
    setLookupMessage('');
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

  const applyBookMatch = (book, replaceableFields = lastOCRFields, summaryMessage = '') => {
    const detected = {
      title: book.title,
      author: book.author,
      subtitle: book.subtitle || '',
      publisher: book.publisher || '',
      publication_place: book.publication_place || '',
      publication_year: book.publication_year || '',
      edition: book.edition || '',
      isbn: book.isbn || '',
      pages: book.pages || '',
      language: book.language || '',
      physical_description: book.physical_description || '',
      subjects: book.subjects?.join(', ') || '',
      ddc_number: book.ddc_number || '',
      call_number: book.call_number || '',
      notes: book.notes || '',
    };
    setLastOCRFields(detected);
    setForm((current) => {
      const next = { ...current };
      Object.entries(detected).forEach(([field, value]) => {
        if (value && (!current[field] || current[field] === replaceableFields[field])) {
          next[field] = value;
        }
      });
      return next;
    });
    setLookupCandidates([]);
    setLookupMessage(
      `${book.source} match selected. Available bibliographic details have been filled in; review them before saving.`
      + (book.classification_source
        ? ` DDC ${book.ddc_number} is ${book.classification_source.toLowerCase()}; follow your library's shelf-number rules.`
        : '')
      + (summaryMessage ? ` ${summaryMessage}` : ''),
    );
  };

  const handleExtract = async () => {
    if (!imageFile && !form.rawText.trim()) {
      setError('Upload an image or enter OCR text before extracting metadata.');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');
    setLookupCandidates([]);
    setLookupMessage('');
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

      const fields = extractMetadataFromText(rawText);
      const detected = {
        title: fields.title || '',
        subtitle: fields.subtitle || '',
        author: fields.author || '',
        publisher: fields.publisher || '',
        publication_place: fields.publication_place || '',
        publication_year: fields.publication_year || '',
        edition: fields.edition || '',
        isbn: fields.isbn || '',
        pages: fields.pages || '',
        language: fields.language || '',
        physical_description: fields.physical_description || '',
        subjects: fields.subjects.join(', '),
        ddc_number: fields.ddc_number || '',
        call_number: fields.call_number || '',
        notes: fields.notes || '',
      };
      const hasLookupTerms = Boolean(detected.title || detected.author);
      const reliableOCR = Number(ocrConfidence) >= MIN_OCR_CONFIDENCE
        && Number(ocrWordCount) >= MIN_OCR_WORD_COUNT;
      const recognisedFields = imageFile && !manualText && !reliableOCR
        ? { ...detected, title: '', subjects: '', ddc_number: '', call_number: '' }
        : detected;
      setLastOCRFields(recognisedFields);
      setForm((current) => {
        const next = { ...current, rawText };
        Object.entries(recognisedFields).forEach(([field, value]) => {
          if (value && (!current[field] || current[field] === lastOCRFields[field])) {
            next[field] = value;
          }
        });
        return next;
      });
      if (hasLookupTerms) {
        setOcrProgress('Searching the public book catalogue for subjects and class details');
        try {
          const lookup = await api.lookupBook({
            title: fields.title,
            author: fields.author,
            isbn: fields.isbn,
          });
          setLookupCandidates(lookup.candidates || []);
          if (lookup.match) {
            applyBookMatch(lookup.match, recognisedFields, lookup.summaryMessage);
          } else {
            setLookupMessage([lookup.message, lookup.summaryMessage].filter(Boolean).join(' '));
          }
        } catch (lookupError) {
          setError(`Title and author were extracted, but catalogue lookup failed: ${lookupError.message}`);
        }
      } else if (imageFile && !reliableOCR) {
        setLookupMessage('OCR could not reliably read a title or author. Try a clear, straight photo or enter either field and extract again.');
      }
      setSuccess(
        imageFile
          ? 'Image processed. Detected and online catalogue details have been filled in where available. Review them before saving.'
          : 'Text processed. Detected and online catalogue details have been filled in where available. Review them before saving.',
      );
    } catch (err) {
      setError(err.message || 'Unable to extract text.');
    } finally {
      setOcrProgress(null);
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
      setLookupCandidates([]);
      setLookupMessage('');
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
      <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-brand-900 via-brand-700 to-brand-500 px-6 py-7 text-white shadow-lg shadow-brand-900/10 sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-100">Smart cataloguing</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Add a book</h1>
            <p className="mt-2 text-sm leading-6 text-emerald-50 sm:text-base">Upload a cover or title page. We’ll read the text, search Open Library, and fill in every available book detail for you to review.</p>
          </div>
          <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-white">OCR + Open Library</span>
        </div>
      </div>

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm" role="alert">{error}</div> : null}
      {success ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 shadow-sm" role="status">{success}</div> : null}

      <div className="grid items-start gap-6 xl:grid-cols-[0.78fr_1.55fr]">
        <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_12px_36px_-24px_rgba(15,23,42,0.25)] sm:p-6">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">Start with a book image</h2>
            <p className="mt-1 text-sm text-slate-500">A clear cover or title page gives the best results.</p>
          </div>
          <div className="mt-4">
            <label className="flex h-52 cursor-pointer items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/80 text-center text-sm text-slate-500 transition hover:border-brand-500 hover:bg-brand-50">
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleImageUpload} />
              {imagePreview ? <img src={imagePreview} alt="Book cover preview" className="h-full w-full object-contain" /> : <span className="px-6 leading-6"><span className="block text-base font-semibold text-slate-700">Choose an image to upload</span><span className="mt-1 block text-xs text-slate-500">PNG, JPG or WebP · up to 7 MB</span></span>}
            </label>
            {imagePreview ? (
              <button type="button" onClick={handleRemoveImage} className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                Remove image
              </button>
            ) : null}
          </div>
          <div className="mt-4">
            <label className="block text-sm font-semibold text-slate-700">Extracted text</label>
            <textarea value={form.rawText} onChange={updateField('rawText')} rows="7" className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-100" placeholder="Extracted text will appear here. You can also paste text manually." />
            <p className="mt-2 text-xs leading-5 text-slate-500">Images are processed with the built-in English OCR engine. The image is not stored or sent to Open Library. Online matches can fill in bibliographic details and a book summary when available; unavailable details can be entered manually.</p>
          </div>
          <div className="mt-5">
            <button onClick={handleExtract} className="w-full rounded-xl bg-brand-700 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-900 focus:outline-none focus:ring-4 focus:ring-brand-100 disabled:cursor-not-allowed disabled:opacity-60" disabled={loading}>{loading ? `${ocrProgress || 'Working'}…` : 'Extract book details'}</button>
          </div>
          {ocrProgress ? <p className="mt-3 text-sm text-slate-600" role="status">{ocrProgress}…</p> : null}
          {lookupMessage ? <p className="mt-3 rounded-xl border border-sky-100 bg-sky-50 px-3.5 py-3 text-sm leading-5 text-sky-900" role="status">{lookupMessage}</p> : null}
          {lookupCandidates.length ? (
            <div className="mt-4 rounded-2xl border border-sky-100 bg-sky-50/80 p-4">
              <p className="text-sm font-semibold text-sky-950">Choose the correct match</p>
              <p className="mt-1 text-xs text-sky-800">Selecting a result fills any additional details found online.</p>
              <ul className="mt-2 space-y-2">
                {lookupCandidates.map((candidate, index) => (
                  <li key={`${candidate.title}-${candidate.author}-${index}`}>
                    <button
                      type="button"
                      onClick={() => applyBookMatch(candidate)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-left text-sm text-slate-800 shadow-sm transition hover:border-brand-500 hover:bg-brand-50"
                    >
                      <span className="font-semibold">{candidate.title}</span>
                      {candidate.author ? <span className="mt-0.5 block text-xs text-slate-500">{candidate.author}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="book-form rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_12px_36px_-24px_rgba(15,23,42,0.25)] sm:p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-slate-900">Book record</h2>
              <p className="mt-1 text-sm text-slate-500">Review the detected and catalogue-sourced details.</p>
            </div>
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">Editable fields</span>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <p className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Bibliographic details</p>
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
              <span>Class / call number (suggested)</span>
              <input value={form.call_number} onChange={updateField('call_number')} className="w-full rounded-lg border border-stone-300 px-3 py-2" />
            </label>
            <p className="md:col-span-2 mt-2 border-t border-slate-100 pt-5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Physical copy details</p>
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
              <textarea value={form.notes} onChange={updateField('notes')} rows="4" className="w-full rounded-lg border border-stone-300 px-3 py-2" placeholder="A short book summary will be added here when available from Open Library." />
              <span className="block text-xs font-normal leading-5 text-slate-500">The summary is editable and is only filled when the online catalogue provides one.</span>
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700 md:col-span-2">
              <span>Remarks</span>
              <textarea value={form.remarks} onChange={updateField('remarks')} rows="3" className="w-full rounded-lg border border-stone-300 px-3 py-2" />
            </label>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button onClick={handleApprove} className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60" disabled={loading}>Approve</button>
            <button onClick={handleSave} className="rounded-xl bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-900 disabled:cursor-not-allowed disabled:opacity-60" disabled={loading}>Save record</button>
          </div>
        </div>
      </div>
    </div>
  );
}
