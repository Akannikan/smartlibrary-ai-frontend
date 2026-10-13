import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

export default function CataloguePage() {
  const [books, setBooks] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBooks();
  }, []);

  const fetchBooks = () => {
    setLoading(true);
    api
      .getBooks(query)
      .then((result) => setBooks(result.data || []))
      .finally(() => setLoading(false));
  };

  const handleSearch = (event) => {
    event.preventDefault();
    fetchBooks();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Book Catalogue</h1>
          <p className="text-sm text-slate-600">Search by title, author, ISBN, DDC or accession number.</p>
        </div>
        <Link to="/add-book" className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">Add New Record</Link>
      </div>

      <form onSubmit={handleSearch} className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm md:flex-row">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search title, author, ISBN, accession, subject, DDC..."
          className="w-full rounded-lg border border-stone-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
        <button type="submit" className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900">Search</button>
      </form>

      {loading ? (
        <div className="rounded-2xl border border-stone-200 bg-white p-8 text-sm text-slate-500">Loading catalogue…</div>
      ) : books.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-200 bg-white p-8 text-center text-sm text-slate-500">
          No bibliographic records match your search.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-stone-100 text-slate-600">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Author</th>
                <th className="px-4 py-3">ISBN</th>
                <th className="px-4 py-3">DDC</th>
                <th className="px-4 py-3">Call No.</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {books.map((book) => (
                <tr key={book.id} className="border-t border-stone-200">
                  <td className="px-4 py-3 font-medium text-slate-800">{book.title}</td>
                  <td className="px-4 py-3">{book.author || '-'}</td>
                  <td className="px-4 py-3">{book.isbn || '-'}</td>
                  <td className="px-4 py-3">{book.ddc_number || '-'}</td>
                  <td className="px-4 py-3">{book.call_number || '-'}</td>
                  <td className="px-4 py-3">
                    <Link to={`/books/${book.id}`} className="text-brand-700 hover:underline">View</Link>
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
