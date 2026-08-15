import express from 'express';
import cors from 'cors';
import { chatRouter } from './controllers/chatController';
import { feedbackRouter } from './controllers/feedbackController';
import { installRequestIdLogging } from './common/logger';

installRequestIdLogging();

const app = express();
const PORT = process.env.PORT;

app.use(cors());
app.use(express.json());

app.use('/api', chatRouter);
app.use('/api', feedbackRouter);

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'radiance-ai' });
});

app.listen(PORT, () => {
  console.log(`[server] Radiance AI API running on http://localhost:${PORT}`);
});
