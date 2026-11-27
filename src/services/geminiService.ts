export async function fetchServerHealth(): Promise<{
  status: string;
  gemini: { configured: boolean; message: string };
}> {
  const res = await fetch('/api/health');
  if (!res.ok) {
    throw new Error('Gagal memeriksa status server');
  }
  return res.json();
}

export async function requestServerGeminiSummary(prompt: string): Promise<string> {
  const res = await fetch('/api/gemini/summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Gagal memanggil API Gemini server');
  }
  return data.text || '';
}
