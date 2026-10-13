export async function parseApiResponse(response) {
  const text = await response.text();
  let result = {};

  if (text) {
    try {
      result = JSON.parse(text);
    } catch {
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
