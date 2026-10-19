import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import api from './services/api';
import DashboardPage from './pages/DashboardPage';
import AddBookPage from './pages/AddBookPage';
import CataloguePage from './pages/CataloguePage';
import BookDetailPage from './pages/BookDetailPage';
import AccessionRegisterPage from './pages/AccessionRegisterPage';

function AppShell() {
  const [health, setHealth] = useState({ status: 'loading' });
  const location = useLocation();

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({ status: 'error' }));
  }, []);

  return (
    <div className="min-h-screen bg-stone-100 text-slate-800">
      <header className="border-b border-stone-200 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <img src="/book-logo.png" alt="" className="h-11 w-11 rounded-xl shadow-sm transition duration-300 hover:-rotate-3 hover:scale-105" />
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-500">smartLibrary Ai</p>
              <p className="text-xs text-stone-500">Smarter Cataloguing. Better Libraries.</p>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-3 text-sm font-medium">
            <NavLink to="/" className={({ isActive }) => `rounded-full px-3 py-2 transition duration-200 hover:-translate-y-0.5 ${isActive ? 'bg-brand-500 text-white shadow-md shadow-brand-500/20' : 'text-slate-700 hover:bg-stone-100'}`}>
              Dashboard
            </NavLink>
            <NavLink to="/add-book" className={({ isActive }) => `rounded-full px-3 py-2 transition duration-200 hover:-translate-y-0.5 ${isActive ? 'bg-brand-500 text-white shadow-md shadow-brand-500/20' : 'text-slate-700 hover:bg-stone-100'}`}>
              Add Book
            </NavLink>
            <NavLink to="/catalogue" className={({ isActive }) => `rounded-full px-3 py-2 transition duration-200 hover:-translate-y-0.5 ${isActive ? 'bg-brand-500 text-white shadow-md shadow-brand-500/20' : 'text-slate-700 hover:bg-stone-100'}`}>
              Catalogue
            </NavLink>
            <NavLink to="/accession-register" className={({ isActive }) => `rounded-full px-3 py-2 transition duration-200 hover:-translate-y-0.5 ${isActive ? 'bg-brand-500 text-white shadow-md shadow-brand-500/20' : 'text-slate-700 hover:bg-stone-100'}`}>
              Accession Register
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {health.status === 'error' ? (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Backend connection is unavailable. Start the Express server and ensure the backend environment is configured.
          </div>
        ) : null}
        <div key={location.pathname} className="route-enter">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/add-book" element={<AddBookPage />} />
            <Route path="/catalogue" element={<CataloguePage />} />
            <Route path="/books/:id" element={<BookDetailPage />} />
            <Route path="/accession-register" element={<AccessionRegisterPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return <AppShell />;
}
