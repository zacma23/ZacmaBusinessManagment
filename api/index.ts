import { createApiApp } from '../server.ts';

// Vercel Serverless Function entry point handling all /api/* routes
const app = createApiApp();

export default app;
