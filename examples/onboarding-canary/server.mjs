import { createServer } from 'node:http';
import { createPulse } from '@apostl-dev/pulse-sdk';

const pulse = createPulse({
  endpoint: process.env.APOSTL_PULSE_ENDPOINT ?? 'https://ingest.apostl.dev',
  apiKey: process.env.APOSTL_PULSE_API_KEY,
  environment: 'production',
  flushIntervalMs: 0,
});

const server = createServer((request, response) => {
  const startedAt = Date.now();
  const path = new URL(request.url ?? '/', 'https://canary.invalid').pathname;
  const isLlms = path === '/llms.txt';
  const statusCode = path === '/' || isLlms || path === '/health' ? 200 : 404;
  const verification = pulse.verificationResponse({ headers: request.headers, url: request.url });
  const headers = {
    'cache-control': 'no-store',
    'content-type': 'text/plain; charset=utf-8',
  };
  if (verification) {
    headers['x-apostl-pulse-page'] = verification.pageUrl;
    headers['x-apostl-pulse-proof'] = verification.proof;
  }
  response.writeHead(statusCode, headers);
  response.end(request.method === 'HEAD'
    ? undefined
    : isLlms
      ? '# Apostl Pulse onboarding canary\n\nThis public page exists only for production onboarding verification.\n'
      : statusCode === 200
        ? 'Apostl Pulse onboarding canary\n'
        : 'Not found\n');

  pulse.observeRequest({
    method: request.method,
    statusCode,
    headers: request.headers,
    ip: trustedClientIp(request),
    url: request.url,
    surface: isLlms ? 'llms' : 'html',
    surfaceName: isLlms ? 'llms.txt' : 'canary',
    durationMs: Date.now() - startedAt,
  });
  void pulse.flush();
});

server.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');

async function shutdown() {
  server.close();
  await pulse.close();
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

function trustedClientIp(request) {
  const forwarded = request.headers['cf-connecting-ip'] ?? request.headers['x-forwarded-for'];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;

  return value?.split(',')[0]?.trim() || request.socket.remoteAddress;
}
