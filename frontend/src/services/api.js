import { parseApiResponse } from './apiResponse';

const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const OCR_API_BASE_URL = (import.meta.env.VITE_OCR_API_URL || API_BASE_URL).replace(/\/$/, '');

async function apiRequest(path, options = {}) {
  const requestUrl = /^https?:\/\//i.test(path) ? path : `${API_BASE_URL}${path}`;
  const response = await fetch(requestUrl, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  return parseApiResponse(response);
}

export const api = {
  health: () => apiRequest('/api/health'),
  getStats: () => apiRequest('/api/dashboard/stats'),
  getBooks: (q = '') => apiRequest(`/api/books${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  createBook: (data) => apiRequest('/api/books', { method: 'POST', body: JSON.stringify(data) }),
  getBook: (id) => apiRequest(`/api/books/${id}`),
  updateBook: (id, data) => apiRequest(`/api/books/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  getCopies: () => apiRequest('/api/copies'),
  addCopy: (bookId, data) => apiRequest(`/api/books/${bookId}/copies`, { method: 'POST', body: JSON.stringify(data) }),
  updateCopy: (copyId, data) => apiRequest(`/api/copies/${copyId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  extractText: (data) => apiRequest(
    `${OCR_API_BASE_URL}/api/cataloguing/extract`,
    { method: 'POST', body: JSON.stringify(data) },
  ),
  lookupBook: (data) => apiRequest(
    `${OCR_API_BASE_URL}/api/cataloguing/lookup`,
    { method: 'POST', body: JSON.stringify(data) },
  ),
  suggestCataloguing: (data) => apiRequest('/api/cataloguing/suggest', { method: 'POST', body: JSON.stringify(data) }),
  suggestDdc: (data) => apiRequest('/api/cataloguing/suggest-ddc', { method: 'POST', body: JSON.stringify(data) }),
  approveRecord: (data) => apiRequest('/api/cataloguing/approve', { method: 'POST', body: JSON.stringify(data) }),
  searchBooks: (params) => apiRequest(`/api/search/books?${new URLSearchParams(params).toString()}`),
  getAccessionRegister: () => apiRequest('/api/accession-register'),
  exportCsv: () => `${API_BASE_URL}/api/accession-register/export.csv`,
  exportXlsx: () => `${API_BASE_URL}/api/accession-register/export.xlsx`,
};

export default api;
