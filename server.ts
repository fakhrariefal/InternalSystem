import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateProcurementSummary, validateGeminiEnv } from './src/server/geminiHelper';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      app: 'Domestiq Hub System',
      gemini: validateGeminiEnv(),
    });
  });

  app.post('/api/gemini/summary', async (req, res) => {
    try {
      const check = validateGeminiEnv();
      if (!check.configured) {
        return res.status(503).json({ error: check.message });
      }
      const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
      if (!prompt || prompt.length > 2000) {
        return res.status(400).json({ error: 'Prompt tidak valid (1-2000 karakter).' });
      }
      const text = await generateProcurementSummary(prompt);
      return res.json({ text });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gagal memproses permintaan Gemini';
      return res.status(500).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Domestiq Hub System server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
