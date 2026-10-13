const API_BASE_URL = import.meta.env.DEV ? import.meta.env.VITE_API_URL || '' : '';

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const text = await response.text();
  const result = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(result.message || 'Request failed');
  }

  return result;
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
  extractText: (data) => apiRequest('/api/cataloguing/extract', { method: 'POST', body: JSON.stringify(data) }),
  suggestCataloguing: (data) => apiRequest('/api/cataloguing/suggest', { method: 'POST', body: JSON.stringify(data) }),
  approveRecord: (data) => apiRequest('/api/cataloguing/approve', { method: 'POST', body: JSON.stringify(data) }),
  getAccessionRegister: () => apiRequest('/api/accession-register'),
  exportCsv: () => `${API_BASE_URL}/api/accession-register/export.csv`,
  exportXlsx: () => `${API_BASE_URL}/api/accession-register/export.xlsx`,
};

export default api;
