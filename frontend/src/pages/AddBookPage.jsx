import { useState } from 'react';
import { createWorker, OEM } from 'tesseract.js';
import workerPath from 'tesseract.js/dist/worker.min.js?url';
import corePath from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';
import englishModelPath from '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url';
import api from '../services/api';
import { extractMetadataFromText } from '../services/cataloguing';

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

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };

  const handleImageUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setError('');
    setSuccess('');
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
    let worker;

    try {
      let rawText = form.rawText.trim();

      if (imageFile) {
        worker = await createWorker('eng', OEM.LSTM_ONLY, {
          workerPath,
          corePath,
          langPath: englishModelPath.slice(0, englishModelPath.lastIndexOf('/')),
          gzip: true,
          logger: ({ status, progress }) => {
            setOcrProgress({ status, progress: Math.round(progress * 100) });
          },
        });
        const { data } = await worker.recognize(imageFile);
        rawText = [rawText, data.text.trim()].filter(Boolean).join('\n');
      }

      if (!rawText) {
        throw new Error('No text was detected. Try a clearer image or enter the details manually.');
      }

      const fields = extractMetadataFromText(rawText);
      setForm((current) => ({
        ...current,
        ...fields,
        rawText,
        subjects: fields.subjects.length ? fields.subjects.join(', ') : current.subjects,
      }));
      setSuccess('Text extracted in your browser. Review the detected details before saving.');
    } catch (err) {
      setError(err.message || 'Unable to extract text.');
    } finally {
      if (worker) await worker.terminate();
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
        <p className="text-sm text-slate-600">Upload a title page, review OCR or AI suggestions, and save the record with a manually assigned accession number.</p>
      </div>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {success ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{success}</div> : null}

      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.5fr]">
        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-900">Book image</h2>
          <div className="mt-4">
            <label className="flex h-48 cursor-pointer items-center justify-center rounded-xl border border-dashed border-stone-300 bg-stone-50 text-center text-sm text-slate-500">
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleImageUpload} />
              {imagePreview ? <img src={imagePreview} alt="Book cover preview" className="h-full w-full rounded-xl object-cover" /> : 'Upload front cover or title page image'}
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
            <p className="mt-2 text-xs text-slate-500">Image OCR runs locally in your browser using the English language model.</p>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={handleExtract} className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-900" disabled={loading}>{ocrProgress ? `Reading image… ${ocrProgress.progress}%` : 'Extract metadata'}</button>
            <button onClick={handleSuggest} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-stone-100" disabled={loading}>Suggest</button>
          </div>
          {ocrProgress ? <p className="mt-2 text-sm text-slate-500" role="status">{ocrProgress.status}</p> : null}
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
