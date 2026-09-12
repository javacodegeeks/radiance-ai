import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import { clerkMiddleware } from '@clerk/express';
import { productRouter } from './controllers/productController';
import { tenantRouter } from './controllers/tenantController';
import { safetyDataRouter } from './controllers/safetyDataController';
import { isDevBypassAuth } from './middleware/auth';

const app = express();
const PORT = process.env.PORT;

app.use(cors());
app.use(express.json());

app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[http] --> ${req.method} ${req.originalUrl}`);
  next();
});

if (isDevBypassAuth()) {
  // See middleware/auth.ts — every request is treated as an authenticated
  // staff member locally. Clerk's own middleware is skipped entirely since
  // it has nothing to verify without real keys.
  console.warn('[server] DEV_BYPASS_AUTH=true — Clerk auth is disabled. Local dev only, never set this in production.');
} else {
  app.use(clerkMiddleware());
}

app.use('/api', productRouter);
app.use('/api', tenantRouter);
app.use('/api', safetyDataRouter);

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'radiance-ai-admin-server' });
});

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  console.error(`[http] unhandled error on ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`[server] Radiance AI Admin Server running on http://localhost:${PORT} (devBypassAuth=${isDevBypassAuth()})`);
});
