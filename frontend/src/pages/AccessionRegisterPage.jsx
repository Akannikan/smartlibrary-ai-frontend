import { useEffect, useMemo, useState } from 'react';
import api from '../services/api';

function formatAccessionDate(value) {
  if (!value) return '-';
  const dateOnly = String(value).match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return dateOnly || value;
}

export default function AccessionRegisterPage() {
  const [entries, setEntries] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getAccessionRegister()
      .then((result) => setEntries(result.data || []))
      .finally(() => setLoading(false));
  }, []);

  const filteredEntries = useMemo(() => {
    if (!search.trim()) return entries;
    return entries.filter((entry) => {
      const text = `${entry.accession_number} ${entry.title} ${entry.author} ${entry.publisher}`.toLowerCase();
      return text.includes(search.toLowerCase());
    });
  }, [entries, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Accessions Register</h1>
          <p className="text-sm text-slate-600">Each physical copy is represented as its own manual accession entry.</p>
        </div>
        <div className="flex gap-2">
          <a href={api.exportCsv()} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-stone-100">Export CSV</a>
          <a href={api.exportXlsx()} className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">Export XLSX</a>
        </div>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search accession number, title, author..."
          className="w-full rounded-lg border border-stone-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
      </div>

      {loading ? (
        <div className="rounded-2xl border border-stone-200 bg-white p-8 text-sm text-slate-500">Loading accession register…</div>
      ) : filteredEntries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-200 bg-white p-8 text-center text-sm text-slate-500">
          No accession entries found.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-stone-100 text-slate-600">
              <tr>
                <th className="px-4 py-3">Accession No.</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Author</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Condition</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map((entry) => (
                <tr key={entry.id} className="border-t border-stone-200">
                  <td className="px-4 py-3 font-medium text-slate-800">{entry.accession_number}</td>
                  <td className="px-4 py-3">{formatAccessionDate(entry.accession_date)}</td>
                  <td className="px-4 py-3">{entry.author || '-'}</td>
                  <td className="px-4 py-3">{entry.title || '-'}</td>
                  <td className="px-4 py-3">{entry.source_of_acquisition || '-'}</td>
                  <td className="px-4 py-3">{entry.price ? `£${entry.price}` : '-'}</td>
                  <td className="px-4 py-3">{entry.condition || '-'}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-800">{entry.status || 'available'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
