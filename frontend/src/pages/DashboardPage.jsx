import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

export default function DashboardPage() {
  const [stats, setStats] = useState({ totalTitles: 0, totalCopies: 0, recentAdditions: [], incompleteMetadata: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getStats()
      .then((result) => {
        setStats(result.data || { totalTitles: 0, totalCopies: 0, recentAdditions: [], incompleteMetadata: 0 });
      })
      .catch(() => setStats({ totalTitles: 0, totalCopies: 0, recentAdditions: [], incompleteMetadata: 0 }))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-600">Track the library’s title records, physical copies, and recent additions.</p>
      </section>

      {loading ? (
        <div className="rounded-2xl border border-stone-200 bg-white p-6 text-sm text-slate-500">Loading dashboard data…</div>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-4">
            <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Total bibliographic titles</p>
              <p className="mt-3 text-3xl font-bold text-brand-700">{stats.totalTitles}</p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Total physical copies</p>
              <p className="mt-3 text-3xl font-bold text-brand-700">{stats.totalCopies}</p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Recent additions</p>
              <p className="mt-3 text-3xl font-bold text-brand-700">{stats.recentAdditions.length}</p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Incomplete metadata</p>
              <p className="mt-3 text-3xl font-bold text-brand-700">{stats.incompleteMetadata}</p>
            </div>
          </section>

          <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900">Recent additions</h2>
              <div className="flex gap-2">
                <Link to="/add-book" className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">Add Book</Link>
                <Link to="/catalogue" className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-stone-100">Catalogue</Link>
                <Link to="/accession-register" className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-stone-100">Accession Register</Link>
              </div>
            </div>

            {stats.recentAdditions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-stone-200 bg-stone-50 p-8 text-center text-sm text-slate-500">
                No records yet. Add a book and assign the manual accession number to get started.
              </div>
            ) : (
              <div className="space-y-3">
                {stats.recentAdditions.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between rounded-xl border border-stone-200 bg-stone-50 p-3">
                    <div>
                      <p className="font-medium text-slate-800">{entry.title}</p>
                      <p className="text-sm text-slate-500">{entry.author}</p>
                    </div>
                    <span className="rounded-full bg-brand-100 px-2 py-1 text-xs font-semibold text-brand-700">{entry.accession_number}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
