import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../services/api';
import { extractMetadataFromText } from '../services/cataloguing';

const MAX_OCR_IMAGE_BYTES = 7 * 1024 * 1024;
const MAX_OCR_REQUEST_IMAGE_BYTES = 3 * 1024 * 1024;
const MIN_OCR_CONFIDENCE = 45;
const MIN_OCR_WORD_COUNT = 4;

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

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
  source_of_acquisition: '',
  price: '',
  condition: '',
  status: 'available',
  remarks: '',
};

export default function AddBookPage() {
  const [form, setForm] = useState(emptyForm);
  const [imagePreview, setImagePreview] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [ocrProgress, setOcrProgress] = useState(null);
  const [lookupCandidates, setLookupCandidates] = useState([]);
  const [lookupMessage, setLookupMessage] = useState('');
  const [lastOCRFields, setLastOCRFields] = useState({});
  const [existingBookId, setExistingBookId] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const cameraStreamRef = useRef(null);
  const videoRef = useRef(null);
  const uploadInputRef = useRef(null);
  const cameraButtonRef = useRef(null);
  const closeCameraButtonRef = useRef(null);
  const previewUrlRef = useRef('');

  const updateField = (field) => (event) => {
    const value = field === 'accession_number'
      ? event.target.value.replace(/\D/g, '').slice(0, 7)
      : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
    if (field === 'title' && existingBookId) setExistingBookId(null);
  };

  const stopCamera = () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    setCameraOpen(false);
    setCameraReady(false);
    setCameraLoading(false);
    cameraButtonRef.current?.focus();
  };

  useEffect(() => {
    if (!cameraOpen || !cameraStreamRef.current || !videoRef.current) return undefined;

    const video = videoRef.current;
    video.srcObject = cameraStreamRef.current;
    closeCameraButtonRef.current?.focus();
    video.play().then(() => setCameraReady(true)).catch(() => {
      setError('The camera preview could not start. Check camera access and try again.');
      stopCamera();
    });
    return () => {
      video.pause();
      video.srcObject = null;
    };
  }, [cameraOpen]);

  useEffect(() => () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const handleImageFile = (file) => {
    if (!file) return;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const previewUrl = URL.createObjectURL(file);
    previewUrlRef.current = previewUrl;
    setImageFile(file);
    setImagePreview(previewUrl);
    setError('');
    setSuccess('');
    setLookupCandidates([]);
    setLookupMessage('');
    setForm((current) => {
      const next = { ...current };
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
  };

  const handleImageUpload = (event) => {
    handleImageFile(event.target.files?.[0]);
    event.target.value = '';
  };

  const handleOpenCamera = async () => {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera capture is not available in this browser. Choose an image file instead.');
      return;
    }

    setCameraLoading(true);
    try {
      cameraStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' } },
      });
      setCameraOpen(true);
    } catch (cameraError) {
      const cameraMessage = cameraError.name === 'NotAllowedError' || cameraError.name === 'SecurityError'
        ? 'Camera access was blocked. Allow camera permission in your browser settings or choose an image file.'
        : cameraError.name === 'NotFoundError'
          ? 'No camera was found on this device. Choose an image file instead.'
          : 'The camera could not be opened. Check that it is connected and not being used by another app.';
      setError(cameraMessage);
    } finally {
      setCameraLoading(false);
    }
  };

  const handleCapturePhoto = async () => {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight) {
      setError('The camera is not ready yet. Wait for the preview, then take the photo.');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      setError('This browser could not capture the camera image. Choose an image file instead.');
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    try {
      const photo = await canvasToBlob(canvas, 0.9);
      handleImageFile(new File([photo], `book-photo-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      stopCamera();
    } catch (captureError) {
      setError(captureError.message || 'The photo could not be captured.');
    }
  };

  const handleRemoveImage = () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = '';
    setImagePreview('');
    setImageFile(null);
  };

  const applyBookMatch = (book, replaceableFields = lastOCRFields, summaryMessage = '') => {
    setExistingBookId(null);
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

  const applyExistingBook = (book) => {
    setExistingBookId(book.id);
    setForm((current) => ({
      ...current,
      title: book.title || '',
      subtitle: book.subtitle || '',
      author: book.author || '',
      publisher: book.publisher || '',
      publication_place: book.publication_place || '',
      publication_year: book.publication_year || '',
      edition: book.edition || '',
      isbn: book.isbn || '',
      pages: book.pages || '',
      language: book.language || '',
      physical_description: book.physical_description || '',
      subjects: Array.isArray(book.subjects) ? book.subjects.join(', ') : '',
      ddc_number: book.ddc_number || '',
      call_number: book.call_number || '',
      notes: book.notes || '',
    }));
    setLookupCandidates([]);
    setLookupMessage('Saved title loaded. Enter the new copy’s manually assigned accession number; bibliographic details will be reused.');
  };

  const handleTitleSearch = async () => {
    const title = form.title.trim();
    const isbn = form.isbn.trim();
    if (!title && !isbn) {
      setError('Enter a title or ISBN before searching the catalogue.');
      return;
    }

    setSearching(true);
    setError('');
    setLookupCandidates([]);
    setLookupMessage('');
    try {
      if (title) {
        try {
          const saved = await api.getBooks(title);
          const exactTitle = (saved.data || []).filter((book) => (
            String(book.title || '').trim().toLowerCase() === title.toLowerCase()
          ));
          const author = form.author.trim().toLowerCase();
          const matchingRecords = author
            ? exactTitle.filter((book) => String(book.author || '').trim().toLowerCase() === author)
            : exactTitle;

          if (matchingRecords.length === 1) {
            applyExistingBook(matchingRecords[0]);
            return;
          }
          if (matchingRecords.length > 1) {
            setLookupCandidates(matchingRecords.map((book) => ({ ...book, localRecordId: book.id })));
            setLookupMessage('More than one saved edition has this title. Select the correct saved record to add a copy.');
            return;
          }
        } catch {
          // Continue with the external search if database search is unavailable.
        }
      }

      const result = await api.searchBooks({
        title,
        author: form.author.trim(),
        isbn,
      });
      const candidates = result.candidates || [];
      if (result.match) {
        const matchIndex = candidates.findIndex((candidate) => (
          candidate.title === result.match.title
          && candidate.author === result.match.author
        ));
        if (matchIndex >= 0 && result.match.notes) {
          candidates[matchIndex] = { ...candidates[matchIndex], notes: result.match.notes };
        }
      }
      setLookupCandidates(candidates);
      setLookupMessage(candidates.length
        ? 'Review the possible matches and select the correct edition before applying its details.'
        : [result.message, result.summaryMessage].filter(Boolean).join(' '));
    } catch (searchError) {
      setError(`Book search failed: ${searchError.message}`);
      setLookupMessage('You can continue by entering the bibliographic details manually.');
    } finally {
      setSearching(false);
    }
  };

  const handleExtract = async () => {
    if (!imageFile) {
      setError('Choose an image or take a photo of the book before extracting details.');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');
    setLookupCandidates([]);
    setLookupMessage('');
    setOcrProgress(null);

    try {
      if (imageFile.size > MAX_OCR_IMAGE_BYTES) {
        throw new Error('The image must be 7 MB or smaller for OCR.');
      }

      setOcrProgress('Preparing your image');
      await nextPaint();
      const image = await prepareOCRImage(imageFile);
      setOcrProgress('Reading the book cover');
      await nextPaint();
      const result = await api.extractText({ image });
      const rawText = result.extractedText || '';
      const ocrConfidence = result.ocrConfidence;
      const ocrWordCount = result.ocrWordCount;
      if (!rawText) {
        throw new Error('No text was detected. Try a sharper, well-lit photo of the title page.');
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
      const recognisedFields = !reliableOCR
        ? { ...detected, title: '', subjects: '', ddc_number: '', call_number: '' }
        : detected;
      setLastOCRFields(recognisedFields);
      setForm((current) => {
        const next = { ...current };
        Object.entries(recognisedFields).forEach(([field, value]) => {
          if (value && (!current[field] || current[field] === lastOCRFields[field])) {
            next[field] = value;
          }
        });
        return next;
      });
      if (hasLookupTerms) {
        setOcrProgress('Looking for this book online');
        await nextPaint();
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
      } else if (!reliableOCR) {
        setLookupMessage('The cover text was difficult to read. Try a clearer, straight-on photo of the title page.');
      }
      setSuccess(
        'Book image processed. Detected and online catalogue details have been filled in where available. Review them before saving.',
      );
    } catch (err) {
      setError(err.message || 'Unable to extract text.');
    } finally {
      setOcrProgress(null);
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!/^\d{7}$/.test(form.accession_number)) {
      setError('Accession number must be exactly 7 digits.');
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const payload = {
        ...form,
        subjects: form.subjects ? form.subjects.split(',').map((item) => item.trim()).filter(Boolean) : [],
      };
      if (existingBookId) {
        await api.addCopy(existingBookId, payload);
      } else {
        await api.createBook(payload);
      }
      setSuccess(`Record saved successfully with accession number ${form.accession_number}.`);
      setForm(emptyForm);
      setExistingBookId(null);
      setLookupCandidates([]);
      setLookupMessage('');
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = '';
      setImagePreview('');
      setImageFile(null);
      setLastOCRFields({});
    } catch (err) {
      setError(err.message || 'Unable to save the record.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="animate-fade-up overflow-hidden rounded-3xl bg-gradient-to-br from-brand-900 via-brand-700 to-brand-500 px-6 py-7 text-white shadow-lg shadow-brand-900/10 sm:px-8">
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
        <div className="animate-fade-up rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_12px_36px_-24px_rgba(15,23,42,0.25)] sm:p-6">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">Start with a book image</h2>
            <p className="mt-1 text-sm text-slate-500">A clear cover or title page gives the best results.</p>
          </div>
          <div className="mt-4">
            <input
              ref={uploadInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={handleImageUpload}
              aria-label="Choose a book image"
            />
            <button
              type="button"
              onClick={() => uploadInputRef.current?.click()}
              className="group flex h-52 w-full items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/80 text-center text-sm text-slate-500 transition duration-300 hover:-translate-y-0.5 hover:border-brand-500 hover:bg-brand-50 hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-brand-100"
            >
              {imagePreview
                ? <img src={imagePreview} alt="Book cover preview" className="h-full w-full object-contain transition duration-500 group-hover:scale-[1.02]" />
                : <span className="px-6 leading-6">
                  <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 transition duration-300 group-hover:scale-110 group-hover:bg-brand-100" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" stroke="currentColor" strokeWidth="1.7">
                      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13Z" />
                      <circle cx="9" cy="9" r="1.5" />
                      <path d="m5 17 4-4 3 3 2-2 5 5" />
                    </svg>
                  </span>
                  <span className="block text-base font-semibold text-slate-700">Choose an image to upload</span>
                  <span className="mt-1 block text-xs text-slate-500">PNG, JPG or WebP · up to 7 MB</span>
                </span>}
            </button>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => uploadInputRef.current?.click()}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 transition duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus:outline-none focus:ring-4 focus:ring-brand-100"
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M4 16.5v2A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-2M12 4v11m0-11 4 4m-4-4L8 8" />
                </svg>
                Upload image
              </button>
              <button
                ref={cameraButtonRef}
                type="button"
                onClick={handleOpenCamera}
                disabled={cameraLoading}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-700 px-3 py-2.5 text-sm font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:bg-brand-900 hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-brand-100 disabled:cursor-wait disabled:opacity-70"
              >
                {cameraLoading
                  ? <span className="loading-spinner h-4 w-4 border-2 border-white/40 border-t-white" aria-hidden="true" />
                  : <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.2-2h6.6l1.2 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9Z" />
                    <circle cx="12" cy="13" r="3.5" />
                  </svg>}
                {cameraLoading ? 'Opening camera…' : 'Take a photo'}
              </button>
            </div>
            {imagePreview ? (
              <button type="button" onClick={handleRemoveImage} className="mt-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-500 transition hover:bg-red-50 hover:text-red-700">
                Remove image
              </button>
            ) : null}
          </div>
          <div className="mt-4 rounded-xl bg-slate-50 px-3.5 py-3">
            <p className="text-xs leading-5 text-slate-600">We’ll read the cover or title page automatically, then look up available details online. Your image is not stored in the public catalogue.</p>
          </div>
          <div className="mt-5">
            <button onClick={handleExtract} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-700 px-4 py-3 text-sm font-semibold text-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:bg-brand-900 hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-brand-100 disabled:cursor-not-allowed disabled:opacity-60" disabled={loading || !imageFile}>
              {loading ? <span className="loading-spinner h-4 w-4 border-2 border-white/40 border-t-white" aria-hidden="true" /> : null}
              {loading ? ocrProgress || 'Working…' : 'Extract book details'}
            </button>
          </div>
          {ocrProgress ? (
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-brand-100 bg-brand-50/70 px-3.5 py-3 animate-fade-up" role="status" aria-live="polite">
              <span className="loading-spinner h-5 w-5 shrink-0 border-2 border-brand-200 border-t-brand-700" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-brand-900">{ocrProgress}</p>
                <p className="mt-0.5 text-xs text-brand-700">This usually takes a few moments.</p>
                <div className="loading-track mt-2 h-1 overflow-hidden rounded-full bg-brand-100">
                  <div className="loading-bar h-full rounded-full bg-brand-600" />
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="book-form animate-fade-up rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_12px_36px_-24px_rgba(15,23,42,0.25)] sm:p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-slate-900">Book record</h2>
              <p className="mt-1 text-sm text-slate-500">Review the detected and catalogue-sourced details.</p>
            </div>
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">Editable fields</span>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <p className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Bibliographic details</p>
            <div className="space-y-2 md:col-span-2">
              <label htmlFor="book-title" className="block text-sm font-medium text-slate-700">Title</label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input id="book-title" value={form.title} onChange={updateField('title')} className="min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-2" />
                <button
                  type="button"
                  onClick={handleTitleSearch}
                  disabled={searching || loading || (!form.title.trim() && !form.isbn.trim())}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {searching ? <span className="loading-spinner h-4 w-4 border-2 border-white/40 border-t-white" aria-hidden="true" /> : null}
                  {searching ? 'Searching…' : 'Search catalogue'}
                </button>
              </div>
              <p className="text-xs text-slate-500">Search by title or ISBN; author is optional. No image required.</p>
            </div>
            {lookupMessage ? <p className="md:col-span-2 rounded-xl border border-sky-100 bg-sky-50 px-3.5 py-3 text-sm leading-5 text-sky-900" role="status">{lookupMessage}</p> : null}
            {lookupCandidates.length ? (
              <div className="md:col-span-2 rounded-2xl border border-sky-100 bg-sky-50/80 p-4">
                <p className="text-sm font-semibold text-sky-950">Choose the correct match</p>
                <p className="mt-1 text-xs text-sky-800">Selecting a result fills in available bibliographic details for your review.</p>
                <ul className="mt-2 space-y-2">
                  {lookupCandidates.map((candidate, index) => (
                    <li key={`${candidate.title}-${candidate.author}-${index}`}>
                      <button
                        type="button"
                        onClick={() => (candidate.localRecordId ? applyExistingBook(candidate) : applyBookMatch(candidate))}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-left text-sm text-slate-800 shadow-sm transition hover:border-brand-500 hover:bg-brand-50"
                      >
                        <span className="font-semibold">{candidate.title}</span>
                        {candidate.author ? <span className="mt-0.5 block text-xs text-slate-500">{candidate.author}</span> : null}
                        <span className="mt-1 block text-xs text-slate-500">
                          {[candidate.publisher, candidate.publication_year, candidate.edition,
                            candidate.isbn || (candidate.isbn_options?.length
                              ? `ISBN options: ${candidate.isbn_options.join(', ')}`
                              : '')]
                            .filter(Boolean).join(' · ') || candidate.source || 'Saved catalogue record'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
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
              <input inputMode="numeric" maxLength={7} value={form.accession_number} onChange={updateField('accession_number')} className="w-full rounded-lg border border-stone-300 px-3 py-2" placeholder="7 digits" />
              <span className="block text-xs font-normal text-slate-500">Enter the 7-digit number stamped on this copy.</span>
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Source of acquisition</span>
              <select value={form.source_of_acquisition} onChange={updateField('source_of_acquisition')} className="w-full rounded-lg border border-stone-300 px-3 py-2">
                <option value="">Select a source</option>
                <option value="Purchase">Purchase</option>
                <option value="Donation">Donation</option>
                <option value="Gift">Gift</option>
                <option value="Government allocation">Government allocation</option>
                <option value="Institutional transfer">Institutional transfer</option>
                <option value="Exchange">Exchange</option>
                <option value="Other">Other</option>
              </select>
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Purchase price (NGN)</span>
              <div className="flex overflow-hidden rounded-lg border border-stone-300 focus-within:ring-2 focus-within:ring-brand-200">
                <span className="flex items-center border-r border-stone-300 bg-stone-50 px-3 text-slate-600" aria-hidden="true">₦</span>
                <input type="number" min="0" step="0.01" value={form.price} onChange={updateField('price')} className="min-w-0 flex-1 px-3 py-2 outline-none" />
              </div>
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
            <button onClick={handleSave} className="rounded-xl bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-900 disabled:cursor-not-allowed disabled:opacity-60" disabled={loading}>Save record</button>
          </div>
        </div>
      </div>

      {cameraOpen ? createPortal(
        <div
          className="camera-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-2 backdrop-blur-sm sm:p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) stopCamera();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') stopCamera();
          }}
        >
          <section className="camera-dialog flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/20 bg-slate-950 shadow-2xl sm:rounded-3xl" role="dialog" aria-modal="true" aria-labelledby="camera-title">
            <div className="camera-header flex shrink-0 items-start justify-between gap-3 px-4 py-3 text-white sm:gap-4 sm:px-6 sm:py-4">
              <div>
                <h2 id="camera-title" className="text-lg font-semibold">Take a book photo</h2>
                <p className="mt-1 text-sm text-slate-300">Frame the cover or title page, then capture.</p>
              </div>
              <button ref={closeCameraButtonRef} type="button" onClick={stopCamera} className="rounded-full p-2 text-slate-300 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/60" aria-label="Close camera">
                <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <div className="camera-preview relative mx-2 min-h-0 overflow-hidden rounded-2xl bg-black sm:mx-5">
              <video ref={videoRef} className="aspect-[4/3] w-full object-cover" playsInline muted aria-label="Live camera preview" />
              {!cameraReady ? <div className="absolute inset-0 flex items-center justify-center text-sm text-white"><span className="loading-spinner mr-3 h-5 w-5 border-2 border-white/40 border-t-white" />Starting camera…</div> : null}
            </div>
            <div className="camera-footer flex shrink-0 flex-col items-stretch gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6 sm:py-4">
              <p className="text-center text-xs leading-5 text-slate-400 sm:text-left">For best results, use good lighting and keep the text in focus.</p>
              <button type="button" onClick={handleCapturePhoto} disabled={!cameraReady} className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:scale-[1.03] hover:bg-brand-50 focus:outline-none focus:ring-4 focus:ring-white/30 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:py-2.5">
                <span className="h-3 w-3 rounded-full bg-red-500 ring-4 ring-red-500/20" aria-hidden="true" />
                Capture photo
              </button>
            </div>
          </section>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
