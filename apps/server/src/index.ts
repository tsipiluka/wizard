import { buildServer } from './app';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';

const { app } = await buildServer();
await app.listen({ port: PORT, host: HOST });
