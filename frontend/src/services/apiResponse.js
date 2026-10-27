export async function parseApiResponse(response) {
  const text = await response.text();
  let result = {};

  if (text) {
    try {
      result = JSON.parse(text);
    } catch {
      const looksLikeHtml = response.headers.get('content-type')?.includes('text/html')
        || /^\s*<!doctype html|^\s*<html/i.test(text);
      if (looksLikeHtml && response.status < 500) {
        const error = new Error(
          'The API returned a web page instead of JSON. Check that Vercel VITE_API_URL points to your Render backend and that the backend is healthy.',
        );
        error.status = response.status;
        throw error;
      }
      const error = new Error(
        response.status >= 500
          ? `The API server is temporarily unavailable (HTTP ${response.status}). Please wait a moment and try again.`
          : 'The API returned an unexpected response. Please refresh the page and try again.',
      );
      error.status = response.status;
      throw error;
    }
  }

  if (!response.ok) {
    const error = new Error(result.message || `Request failed (HTTP ${response.status}).`);
    error.status = response.status;
    throw error;
  }

  return result;
}
