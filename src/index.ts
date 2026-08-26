import { createHmac, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';

export type PulseCategory = 'interactive_agent' | 'developer_tool' | 'crawler' | 'human_browser' | 'unknown_automation';
export type PulseConfidence = 'high' | 'medium' | 'low';
export type PulseSurface = 'html' | 'markdown' | 'llms' | 'mcp' | 'skill' | 'api' | 'other';
export type PulseAcceptFamily = 'html' | 'markdown' | 'json' | 'other';

export type PulseHeaderValues = Record<string, string | string[] | undefined> | Headers | { get(name: string): string | null };

export interface ObserveRequestInput {
  method?: string | undefined;
  statusCode?: number | undefined;
  headers?: PulseHeaderValues | undefined;
  userAgent?: string | undefined;
  accept?: string | undefined;
  ip?: string | undefined;
  url?: string | undefined;
  surface?: PulseSurface | undefined;
  surfaceName?: string | undefined;
  durationMs?: number | undefined;
  /** @deprecated Eligibility is fixed to public GET/HEAD pages and this value is ignored. */
  eligible?: boolean | undefined;
}

export interface PulseDiagnostics {
  enabled: boolean;
  configured: boolean;
  queued: number;
  accepted: number;
  sent: number;
  droppedOverflow: number;
  droppedInvalid: number;
  droppedDelivery: number;
  lastError: string | null;
}

export interface PulseClient {
  observeRequest(input: ObserveRequestInput): void;
  verificationResponse(input: { headers?: PulseHeaderValues | undefined; url?: string | undefined }): { pageUrl: string; proof: string } | null;
  flush(): Promise<void>;
  diagnostics(): PulseDiagnostics;
  close(): Promise<void>;
}

export interface CreatePulseOptions {
  endpoint?: string;
  apiKey?: string;
  /** @deprecated Use apiKey or APOSTL_PULSE_API_KEY. */
  writeKey?: string;
  /** @deprecated Anonymous identity is now derived with the API key. */
  identitySecret?: string;
  environment?: string;
  enabled?: boolean;
  queueLimit?: number;
  timeoutMs?: number;
  flushIntervalMs?: number;
  /** Explicitly public API route prefixes. Unknown /api routes fail closed by default. */
  publicApiPrefixes?: string[];
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  random?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface PulseEvent {
  event_id: string;
  occurred_at: string;
  session_id: string;
  ip: string;
  user_agent: string;
  page_url: string;
  page_path: string;
  category: PulseCategory;
  confidence: PulseConfidence;
  agent_family: string;
  accept_family: PulseAcceptFamily;
  surface: PulseSurface;
  surface_name: string;
  method: string;
  status_code: number;
  duration_ms: number | null;
  eligible: boolean;
  public_api_route: boolean;
  classification_reason: string;
}

const MAX_EVENTS = 50;
const SCHEMA_VERSION = 2;
const MAX_BATCH_BYTES = 256 * 1024;
const MAX_EVENT_BYTES = 16 * 1024;
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const ALLOWED_SURFACES = new Set<PulseSurface>(['html', 'markdown', 'llms', 'mcp', 'skill', 'api', 'other']);
const PRIVATE_PAGE_PREFIXES = ['/auth', '/oauth', '/agent', '/email', '/admin', '/dashboard', '/account', '/accounts', '/profile', '/me', '/password', '/settings', '/project', '/projects', '/users', '/sessions', '/tokens', '/billing'];
const PRIVATE_PAGE_PATHS = new Set(['/login', '/logout', '/register', '/forgot-password', '/reset-password']);
const PRIVATE_API_PATH = /^\/api\/(?:v\d+\/)?(?:[^/]+\/)*(?:auth|oauth|logins?|logouts?|register|forgot-password|reset-password|passwords?|profiles?|me|emails?|agents?|admins?|accounts?|settings?|projects?|users?|sessions?|tokens?|billings?)(?:\/|$)/i;
const SAFE_PUBLIC_API_PATHS = new Set(['/api/mcp', '/api/turnstile-config']);
const ASSET_EXTENSION = /\.(?:avif|bmp|bz2|cjs|css|eot|gif|gz|ico|jpe?g|js|map|mjs|mp3|mp4|ogg|pdf|png|svg|tar|tiff?|ttf|wasm|wav|webm|webp|woff2?|zip|7z)$/i;
export const PULSE_VERIFICATION_CHALLENGE_HEADER = 'x-apostl-pulse-challenge';
export const PULSE_VERIFICATION_PROOF_HEADER = 'x-apostl-pulse-proof';
export const PULSE_VERIFICATION_PAGE_HEADER = 'x-apostl-pulse-page';

export function createPulse(options: CreatePulseOptions = {}): PulseClient {
  const endpoint = String(options.endpoint ?? process.env.APOSTL_PULSE_ENDPOINT ?? '').replace(/\/+$/, '');
  const apiKey = String(options.apiKey ?? process.env.APOSTL_PULSE_API_KEY ?? options.writeKey ?? process.env.APOSTL_PULSE_WRITE_KEY ?? '');
  const environment = safeLabel(options.environment ?? process.env.APOSTL_PULSE_ENVIRONMENT ?? process.env.NODE_ENV ?? 'production', 'production');
  const configured = Boolean(endpoint && isApiKey(apiKey));
  const enabled = options.enabled !== false && configured;
  const queueLimit = clamp(options.queueLimit ?? 500, 1, 500);
  const timeoutMs = clamp(options.timeoutMs ?? 1000, 1, 1000);
  const now = options.now ?? (() => new Date());
  const fetcher = options.fetch ?? globalThis.fetch;
  const random = options.random ?? Math.random;
  const publicApiPrefixes = normalizePublicApiPrefixes(options.publicApiPrefixes);
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const queue: PulseEvent[] = [];
  let flushing: Promise<void> | null = null;
  let closed = false;
  const counters = {
    accepted: 0,
    sent: 0,
    droppedOverflow: 0,
    droppedInvalid: 0,
    droppedDelivery: 0,
    lastError: null as string | null,
  };

  const interval = enabled && (options.flushIntervalMs ?? 1000) > 0
    ? setInterval(() => { void flush(); }, options.flushIntervalMs ?? 1000)
    : null;
  interval?.unref?.();

  function observeRequest(input: ObserveRequestInput): void {
    if (!enabled || closed) return;
    try {
      const timestamp = now();
      const userAgent = input.userAgent ?? header(input.headers, 'user-agent');
      const accept = input.accept ?? header(input.headers, 'accept');
      const classification = classify(userAgent, accept);
      const acceptFamily = classifyAccept(accept);
      const method = ALLOWED_METHODS.has(String(input.method).toUpperCase()) ? String(input.method).toUpperCase() : 'GET';
      const statusCode = clamp(Number(input.statusCode ?? 200), 100, 599);
      const surface = input.surface && ALLOWED_SURFACES.has(input.surface) ? input.surface : inferSurface(acceptFamily);
      const surfaceName = safeLabel(input.surfaceName ?? 'other', 'other');
      const epoch = Math.floor(timestamp.getTime() / 3_600_000) - (timestamp.getUTCMinutes() < 5 ? 1 : 0);
      const ip = canonicalIp(input.ip ?? header(input.headers, 'cf-connecting-ip'));
      const normalizedUserAgent = canonicalUserAgent(userAgent);
      const page = canonicalPage(input.url, input.headers);
      if (!ip || !normalizedUserAgent || !page) {
        counters.droppedInvalid += 1;
        return;
      }
      const publicApiRoute = isPublicApiRoute(page.path, publicApiPrefixes);
      const eligible = isPublicPage(method, statusCode, page.path, publicApiRoute);
      if (!eligible) return;
      const identity = JSON.stringify([environment, ip, normalizedUserAgent, epoch]);
      const sessionId = createHmac('sha256', apiKey).update(identity).digest('hex');
      const event: PulseEvent = {
        event_id: randomUUID(),
        occurred_at: timestamp.toISOString(),
        session_id: sessionId,
        ip,
        user_agent: normalizedUserAgent,
        page_url: page.url,
        page_path: page.path,
        category: classification.category,
        confidence: classification.confidence,
        agent_family: classification.agentFamily,
        accept_family: acceptFamily,
        surface,
        surface_name: surfaceName,
        method,
        status_code: statusCode,
        duration_ms: Number.isFinite(input.durationMs) ? clamp(Number(input.durationMs), 0, 300_000) : null,
        eligible: true,
        public_api_route: publicApiRoute,
        classification_reason: classification.reason,
      };
      if (byteLength(event) > MAX_EVENT_BYTES) {
        counters.droppedInvalid += 1;
        return;
      }
      if (queue.length >= queueLimit) {
        queue.shift();
        counters.droppedOverflow += 1;
      }
      queue.push(event);
      counters.accepted += 1;
    } catch (error) {
      counters.droppedInvalid += 1;
      counters.lastError = safeError(error);
    }
  }

  function verificationResponse(input: { headers?: PulseHeaderValues | undefined; url?: string | undefined }): { pageUrl: string; proof: string } | null {
    if (!enabled || closed) return null;
    const challenge = header(input.headers, PULSE_VERIFICATION_CHALLENGE_HEADER).trim();
    if (!/^verify-[A-Za-z0-9_-]{16,128}$/.test(challenge)) return null;
    const page = canonicalPage(input.url, input.headers);
    if (!page) return null;
    const message = `pulse-verify-v1\n${challenge}\n${page.url}`;
    const signature = createHmac('sha256', apiKey).update(message).digest('hex');

    return { pageUrl: page.url, proof: `v1:${signature}` };
  }

  async function flush(): Promise<void> {
    if (!enabled) return;
    if (flushing) {
      await flushing;
      if (queue.length > 0) await flush();
      return;
    }
    if (queue.length === 0) return;
    flushing = (async () => {
      while (queue.length > 0) {
        const pending = queue.splice(0, queue.length);
        for (const batch of batches(pending, now)) {
          const delivered = await deliver(batch);
          if (delivered) counters.sent += batch.length;
          else counters.droppedDelivery += batch.length;
        }
      }
    })().finally(() => { flushing = null; });
    await flushing;
  }

  async function deliver(events: PulseEvent[]): Promise<boolean> {
    const body = JSON.stringify({ schema_version: SCHEMA_VERSION, sent_at: now().toISOString(), events });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetcher(`${endpoint}/api/v1/pulse/events/batch`, {
          method: 'POST',
          headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        });
        if (response.status === 202) {
          counters.lastError = null;
          return true;
        }
        const retryable = response.status === 429 || response.status >= 500;
        counters.lastError = `http_${response.status}`;
        if (!retryable || attempt === 3) return false;
      } catch (error) {
        counters.lastError = safeError(error);
        return false;
      } finally {
        clearTimeout(timer);
      }
      await sleep(Math.floor((50 * (2 ** (attempt - 1))) + random() * 100));
    }
    return false;
  }

  function diagnostics(): PulseDiagnostics {
    return { enabled, configured, queued: queue.length, ...counters };
  }

  async function close(): Promise<void> {
    closed = true;
    if (interval) clearInterval(interval);
    await flush();
  }

  return { observeRequest, verificationResponse, flush, diagnostics, close };
}

function isPublicPage(method: string, statusCode: number, pagePath: string, publicApiRoute: boolean): boolean {
  if (!['GET', 'HEAD'].includes(method) || statusCode < 200 || statusCode >= 500) return false;
  const normalizedPath = pagePath.toLowerCase();
  if (PRIVATE_PAGE_PATHS.has(normalizedPath) || PRIVATE_API_PATH.test(normalizedPath) || ASSET_EXTENSION.test(normalizedPath)) return false;

  if (PRIVATE_PAGE_PREFIXES.some((prefix) => normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`))) return false;

  return !normalizedPath.startsWith('/api/') || publicApiRoute;
}

function isPublicApiRoute(pagePath: string, publicApiPrefixes: string[]): boolean {
  const normalizedPath = pagePath.toLowerCase();
  if (!normalizedPath.startsWith('/api/') || PRIVATE_API_PATH.test(normalizedPath)) return false;
  if (SAFE_PUBLIC_API_PATHS.has(normalizedPath)) return true;

  return publicApiPrefixes.some((prefix) => normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`));
}

function normalizePublicApiPrefixes(prefixes: string[] | undefined): string[] {
  if (!Array.isArray(prefixes)) return [];

  return [...new Set(prefixes
    .map((prefix) => String(prefix).trim().toLowerCase().replace(/\/+$/, ''))
    .filter((prefix) => /^\/api\/[a-z0-9._~!$&'()*+,;=:@%/-]+$/.test(prefix) && !PRIVATE_API_PATH.test(prefix)))]
    .slice(0, 50);
}

function batches(events: PulseEvent[], now: () => Date): PulseEvent[][] {
  const result: PulseEvent[][] = [];
  let current: PulseEvent[] = [];
  for (const event of events) {
    const candidate = [...current, event];
    const size = byteLength({ schema_version: SCHEMA_VERSION, sent_at: now().toISOString(), events: candidate });
    if (current.length >= MAX_EVENTS || size > MAX_BATCH_BYTES) {
      if (current.length) result.push(current);
      current = [event];
    } else {
      current = candidate;
    }
  }
  if (current.length) result.push(current);
  return result;
}

function classify(userAgent: string, accept: string): { category: PulseCategory; confidence: PulseConfidence; agentFamily: string; reason: string } {
  const ua = userAgent.toLowerCase();
  const patterns: Array<[string, PulseCategory, PulseConfidence, string, string]> = [
    ['chatgpt-user', 'interactive_agent', 'high', 'chatgpt', 'known_chatgpt_user_agent'],
    ['openai-operator', 'interactive_agent', 'high', 'openai-operator', 'known_openai_operator'],
    ['claude-code', 'developer_tool', 'high', 'claude-code', 'known_claude_code'],
    ['codex', 'developer_tool', 'high', 'codex', 'known_codex'],
    ['cursor', 'developer_tool', 'high', 'cursor', 'known_cursor'],
    ['github-copilot', 'developer_tool', 'high', 'github-copilot', 'known_copilot'],
    ['googlebot', 'crawler', 'high', 'googlebot', 'known_googlebot'],
    ['gptbot', 'crawler', 'high', 'gptbot', 'known_gptbot'],
    ['claudebot', 'crawler', 'high', 'claudebot', 'known_claudebot'],
    ['perplexitybot', 'crawler', 'high', 'perplexitybot', 'known_perplexitybot'],
  ];
  for (const [needle, category, confidence, agentFamily, reason] of patterns) {
    if (ua.includes(needle)) return { category, confidence, agentFamily, reason };
  }
  if (/mozilla\/5\.0.*(?:chrome|safari|firefox|edg)/i.test(userAgent)) {
    return { category: 'human_browser', confidence: 'high', agentFamily: 'browser', reason: 'browser_signature' };
  }
  if (classifyAccept(accept) === 'markdown') {
    return { category: 'unknown_automation', confidence: 'medium', agentFamily: 'unknown', reason: 'markdown_accept' };
  }
  return { category: 'unknown_automation', confidence: 'low', agentFamily: 'unknown', reason: 'unrecognized_client' };
}

function classifyAccept(accept: string): PulseAcceptFamily {
  const value = accept.toLowerCase();
  if (value.includes('text/markdown') || value.includes('text/x-markdown')) return 'markdown';
  if (value.includes('application/json')) return 'json';
  if (value.includes('text/html')) return 'html';
  return 'other';
}

function inferSurface(accept: PulseAcceptFamily): PulseSurface {
  if (accept === 'html' || accept === 'markdown') return accept;
  if (accept === 'json') return 'api';
  return 'other';
}

function header(headers: PulseHeaderValues | undefined, name: string): string {
  if (!headers) return '';
  if ('get' in headers && typeof headers.get === 'function') return headers.get(name) ?? '';
  const record = headers as Record<string, string | string[] | undefined>;
  const key = Object.keys(record).find((candidate) => candidate.toLowerCase() === name);
  const value = key ? record[key] : undefined;
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function canonicalPage(input: string | undefined, headers: PulseHeaderValues | undefined): { url: string; path: string } | null {
  const raw = String(input ?? '').trim();
  if (!raw || raw.length > 4096) return null;
  try {
    const forwardedProto = header(headers, 'x-forwarded-proto').split(',')[0]?.trim().toLowerCase();
    const protocol = forwardedProto === 'http' || forwardedProto === 'https' ? forwardedProto : 'https';
    const forwardedHost = header(headers, 'x-forwarded-host').split(',')[0]?.trim();
    const host = forwardedHost || header(headers, 'host').trim();
    const parsed = /^[a-z][a-z0-9+.-]*:/i.test(raw)
      ? new URL(raw)
      : host && raw.startsWith('/')
        ? new URL(raw, `${protocol}://${host}`)
        : null;
    if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) return null;
    parsed.search = '';
    parsed.hash = '';
    const path = parsed.pathname !== '/' ? parsed.pathname.replace(/\/+$/, '') || '/' : '/';
    const url = `${parsed.protocol}//${parsed.host.toLowerCase()}${path}`;
    if (url.length > 2048 || path.length > 1024) return null;

    return { url, path };
  } catch {
    return null;
  }
}

function canonicalIp(input: string): string {
  const ip = String(input).split(',')[0]?.trim() ?? '';
  return isIP(ip) ? ip.toLowerCase() : '';
}

function canonicalUserAgent(input: string): string {
  return String(input).trim().slice(0, 1024);
}

function isApiKey(input: string): boolean {
  return (input.startsWith('pulse_api_') || input.startsWith('pulse_wk_')) && input.length >= 32;
}

function safeLabel(input: string, fallback: string): string {
  const label = String(input).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return label || fallback;
}

function byteLength(input: unknown): number {
  return Buffer.byteLength(typeof input === 'string' ? input : JSON.stringify(input));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function safeError(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'timeout';
  return error instanceof Error ? safeLabel(error.name, 'delivery_error') : 'delivery_error';
}
