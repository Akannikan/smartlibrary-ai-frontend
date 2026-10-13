import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../services/api';

const initialForm = {
  title: '',
  author: '',
  publisher: '',
  publication_year: '',
  edition: '',
  isbn: '',
  ddc_number: '',
  call_number: '',
  notes: '',
};

export default function BookDetailPage() {
  const { id } = useParams();
  const [book, setBook] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    api.getBook(id).then((result) => {
      const data = result.data || {};
      setBook(data);
      setForm({
        title: data.title || '',
        author: data.author || '',
        publisher: data.publisher || '',
        publication_year: data.publication_year || '',
        edition: data.edition || '',
        isbn: data.isbn || '',
        ddc_number: data.ddc_number || '',
        call_number: data.call_number || '',
        notes: data.notes || '',
      });
    });
  }, [id]);

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };

  const saveChanges = async () => {
    setSaving(true);
    try {
      const result = await api.updateBook(id, form);
      setMessage(result.message || 'Record updated successfully.');
      setBook(result.data || book);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  };

  if (!book) {
    return <div className="rounded-2xl border border-stone-200 bg-white p-8 text-sm text-slate-500">Loading book details…</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Book Details</h1>
        <p className="text-sm text-slate-600">Review the title record and update the metadata as needed.</p>
      </div>

      {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div> : null}

      <div className="grid gap-6 lg:grid-cols-[1.5fr_0.9fr]">
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
              <span>Publisher</span>
              <input value={form.publisher} onChange={updateField('publisher')} className="w-full rounded-lg border border-stone-300 px-3 py-2" />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Publication Year</span>
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
              <span>DDC Number</span>
              <input value={form.ddc_number} onChange={updateField('ddc_number')} className="w-full rounded-lg border border-stone-300 px-3 py-2" />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              <span>Call Number</span>
              <input value={form.call_number} onChange={updateField('call_number')} className="w-full rounded-lg border border-stone-300 px-3 py-2" />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700 md:col-span-2">
              <span>Notes</span>
              <textarea value={form.notes} onChange={updateField('notes')} rows="4" className="w-full rounded-lg border border-stone-300 px-3 py-2" />
            </label>
          </div>
          <div className="mt-5 flex justify-end">
            <button onClick={saveChanges} className="rounded-lg bg-brand-500 px-4 py-2 font-medium text-white hover:bg-brand-700" disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>

        <aside className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Physical copies</h2>
          <ul className="mt-4 space-y-3">
            {(book.copies || []).map((copy) => (
              <li key={copy.id} className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                <p className="font-medium text-slate-800">{copy.accession_number}</p>
                <p className="text-sm text-slate-500">{copy.status || 'available'}</p>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
