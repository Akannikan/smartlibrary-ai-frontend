import { useState } from 'react';
import api from '../services/api';

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
  const [searchForm, setSearchForm] = useState({ title: '', author: '', isbn: '' });
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [lookupCandidates, setLookupCandidates] = useState([]);
  const [lookupMessage, setLookupMessage] = useState('');
  const [existingBookId, setExistingBookId] = useState(null);

  const updateField = (field) => (event) => {
    const value = field === 'accession_number'
      ? event.target.value.replace(/\D/g, '').slice(0, 7)
      : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
    if (field === 'title' && existingBookId) setExistingBookId(null);
  };

  const applyBookMatch = (book, summaryMessage = '') => {
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
    setForm((current) => {
      const next = { ...current };
      Object.entries(detected).forEach(([field, value]) => {
        if (value && !current[field]) {
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

  const handleSelectCandidate = async (candidate) => {
    if (candidate.localRecordId) {
      applyExistingBook(candidate);
      return;
    }

    setSearching(true);
    try {
      const details = await api.searchBooks({
        title: candidate.title,
        author: candidate.author || '',
        isbn: candidate.isbn || '',
      });
      applyBookMatch({ ...candidate, notes: details.match?.notes || candidate.notes }, details.summaryMessage);
    } catch {
      applyBookMatch(candidate, 'The fuller description could not be loaded. Review the source record and enter notes manually.');
    } finally {
      setSearching(false);
    }
  };

  const updateSearchField = (field) => (event) => {
    setSearchForm((current) => ({ ...current, [field]: event.target.value }));
  };

  const handleCatalogueSearch = async () => {
    const search = {
      title: searchForm.title.trim(),
      author: searchForm.author.trim(),
      isbn: searchForm.isbn.trim(),
    };
    if (!search.title && !search.author && !search.isbn) {
      setError('Enter a title, author, or ISBN to search the catalogue.');
      return;
    }

    setSearching(true);
    setError('');
    setLookupCandidates([]);
    setLookupMessage('');
    try {
      try {
        const savedRecords = await api.getBooks(search.title || search.author || search.isbn);
        const normalizeIsbn = (value) => String(value || '').replace(/[^0-9Xx]/g, '').toUpperCase();
        const matchingRecords = (savedRecords.data || []).filter((book) => (
          (!search.title || String(book.title || '').toLowerCase().includes(search.title.toLowerCase()))
          && (!search.author || String(book.author || '').toLowerCase().includes(search.author.toLowerCase()))
          && (!search.isbn || normalizeIsbn(book.isbn) === normalizeIsbn(search.isbn))
        ));

        if (matchingRecords.length === 1) {
          applyExistingBook(matchingRecords[0]);
          return;
        }
        if (matchingRecords.length > 1) {
          setLookupCandidates(matchingRecords.map((book) => ({ ...book, localRecordId: book.id })));
          setLookupMessage('Select the saved edition to add another copy, or refine your search.');
          return;
        }
      } catch {
        // Continue with the public catalogue if the saved-record search is unavailable.
      }

      const result = await api.searchBooks(search);
      const candidates = result.candidates || [];
      if (result.match) {
        const matchIndex = candidates.findIndex((candidate) => (
          candidate.title === result.match.title
          && candidate.author === result.match.author
          && candidate.isbn === result.match.isbn
        ));
        if (matchIndex >= 0 && result.match.notes) {
          candidates[matchIndex] = { ...candidates[matchIndex], notes: result.match.notes };
        }
      }
      setLookupCandidates(candidates);
      setLookupMessage(candidates.length
        ? 'Review the title, author, publisher, ISBN, and source before selecting the matching edition.'
        : [result.message, result.summaryMessage].filter(Boolean).join(' '));
    } catch (searchError) {
      setError(`Book search failed: ${searchError.message}`);
      setLookupMessage('You can continue by entering the bibliographic details manually.');
    } finally {
      setSearching(false);
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
      setSearchForm({ title: '', author: '', isbn: '' });
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
            <p className="mt-2 text-sm leading-6 text-emerald-50 sm:text-base">Search online by title, author, or ISBN, then review and edit the edition details before saving.</p>
          </div>
          <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-white">Public catalogue search</span>
        </div>
      </div>

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm" role="alert">{error}</div> : null}
      {success ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 shadow-sm" role="status">{success}</div> : null}

      <div className="space-y-6">
        <section className="animate-fade-up rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_12px_36px_-24px_rgba(15,23,42,0.25)] sm:p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">Search public catalogue</h2>
            <p className="mt-1 text-sm text-slate-500">Use any one field or combine them to narrow the results.</p>
          </div>
          <form
            className="grid items-end gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              handleCatalogueSearch();
            }}
          >
            <label className="space-y-1.5 text-sm font-medium text-slate-700">
              <span>Title</span>
              <input value={searchForm.title} onChange={updateSearchField('title')} className="w-full rounded-lg border border-stone-300 px-3 py-2" placeholder="Optional" />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-slate-700">
              <span>Author</span>
              <input value={searchForm.author} onChange={updateSearchField('author')} className="w-full rounded-lg border border-stone-300 px-3 py-2" placeholder="Search without a title" />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-slate-700">
              <span>ISBN</span>
              <input inputMode="numeric" value={searchForm.isbn} onChange={updateSearchField('isbn')} className="w-full rounded-lg border border-stone-300 px-3 py-2" placeholder="10 or 13 digits" />
            </label>
            <button
              type="submit"
              disabled={searching || loading || (!searchForm.title.trim() && !searchForm.author.trim() && !searchForm.isbn.trim())}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {searching ? <span className="loading-spinner h-4 w-4 border-2 border-white/40 border-t-white" aria-hidden="true" /> : null}
              {searching ? 'Searching…' : 'Search'}
            </button>
          </form>
          {lookupMessage ? <p className="mt-4 rounded-xl border border-sky-100 bg-sky-50 px-3.5 py-3 text-sm leading-5 text-sky-900" role="status">{lookupMessage}</p> : null}
          {lookupCandidates.length ? (
            <div className="mt-4">
              <p className="text-sm font-semibold text-slate-900">Choose the matching edition</p>
              <ul className="mt-2 space-y-2">
                {lookupCandidates.map((candidate, index) => (
                  <li key={`${candidate.title}-${candidate.author}-${candidate.isbn || index}`}>
                    <button
                      type="button"
                      onClick={() => handleSelectCandidate(candidate)}
                      disabled={searching}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-left text-sm text-slate-800 shadow-sm transition hover:border-brand-500 hover:bg-brand-50 disabled:cursor-wait disabled:opacity-70"
                    >
                      <span className="font-semibold">{candidate.title}</span>
                      {candidate.author ? <span className="mt-0.5 block text-xs text-slate-600">{candidate.author}</span> : null}
                      <span className="mt-1 block text-xs text-slate-500">
                        {[candidate.publisher, candidate.publication_place, candidate.publication_year,
                          candidate.edition, candidate.pages ? `${candidate.pages} pages` : '',
                          candidate.language, candidate.isbn || (candidate.isbn_options?.length
                            ? `ISBN options: ${candidate.isbn_options.join(', ')}`
                            : '')]
                          .filter(Boolean).join(' · ') || candidate.source || 'Saved catalogue record'}
                      </span>
                    </button>
                    {candidate.source_url ? <a href={candidate.source_url} target="_blank" rel="noreferrer" className="ml-4 mt-1 inline-block text-xs font-medium text-brand-700 underline">View source record</a> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

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
              <textarea value={form.notes} onChange={updateField('notes')} rows="5" className="w-full rounded-lg border border-stone-300 px-3 py-2" placeholder="A book description will be added when the catalogue provides one." />
              <span className="block text-xs font-normal leading-5 text-slate-500">The source description is editable. Review it and add detail when the catalogue record is brief.</span>
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

    </div>
  );
}
