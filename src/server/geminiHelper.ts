import { GoogleGenAI } from '@google/genai';

export function validateGeminiEnv(): { configured: boolean; message: string } {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || key === 'MY_GEMINI_API_KEY') {
    return {
      configured: false,
      message: 'GEMINI_API_KEY belum dikonfigurasi pada environment variable server.',
    };
  }
  return {
    configured: true,
    message: 'GEMINI_API_KEY terkonfigurasi.',
  };
}

export function createGeminiClient(): GoogleGenAI {
  const check = validateGeminiEnv();
  if (!check.configured) {
    throw new Error(check.message);
  }
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export async function generateProcurementSummary(prompt: string): Promise<string> {
  const ai = createGeminiClient();
  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'Anda adalah analis procurement & akuntansi untuk PT Domestiq Hub Indonesia. Berikan ringkasan operasional singkat, faktual, dalam Bahasa Indonesia.',
    },
  });
  return response.text ?? '';
}
