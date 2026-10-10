import * as Schema from "effect/Schema";
import * as SecureStore from "expo-secure-store";

const SERVICE_AUTH_STORAGE_KEY = "t3code.environment-service-auth.v1";

const FORBIDDEN_HEADER_NAMES = new Set([
  "authorization",
  "dpop",
  "connection",
  "content-length",
  "cookie",
  "host",
  "origin",
  "set-cookie",
  "upgrade",
]);

export class ServiceAuthHeader extends Schema.Class<ServiceAuthHeader>(
  "@t3tools/mobile/ServiceAuthHeader",
)({
  name: Schema.String,
  value: Schema.String,
}) {}

export class CustomHeadersServiceAuth extends Schema.TaggedClass<CustomHeadersServiceAuth>()(
  "CustomHeadersServiceAuth",
  {
    headers: Schema.Array(ServiceAuthHeader),
  },
) {}

export const EnvironmentServiceAuth = CustomHeadersServiceAuth;
export type EnvironmentServiceAuth = typeof EnvironmentServiceAuth.Type;

const StoredEnvironmentServiceAuth = Schema.Struct({
  origin: Schema.String,
  auth: EnvironmentServiceAuth,
});

const EnvironmentServiceAuthDocument = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  entries: Schema.Array(StoredEnvironmentServiceAuth),
});
type EnvironmentServiceAuthDocument = typeof EnvironmentServiceAuthDocument.Type;

const EMPTY_DOCUMENT: EnvironmentServiceAuthDocument = Object.freeze({
  schemaVersion: 1,
  entries: [],
});

const decodeDocument = Schema.decodeUnknownSync(EnvironmentServiceAuthDocument);

function readInitialDocument(): EnvironmentServiceAuthDocument {
  try {
    const raw = SecureStore.getItem(SERVICE_AUTH_STORAGE_KEY);
    return raw === null ? EMPTY_DOCUMENT : decodeDocument(JSON.parse(raw));
  } catch {
    return EMPTY_DOCUMENT;
  }
}

let document = readInitialDocument();
let pendingWrite: Promise<void> = Promise.resolve();

function normalizeHeaderName(name: string): string {
  const normalized = name.trim();
  if (!normalized || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(normalized)) {
    throw new Error(`Invalid service-auth header name: ${name || "(empty)"}.`);
  }
  const lower = normalized.toLowerCase();
  if (FORBIDDEN_HEADER_NAMES.has(lower) || lower.startsWith("sec-websocket-")) {
    throw new Error(`The ${normalized} header cannot be configured as service authentication.`);
  }
  return normalized;
}

export function makeCustomHeadersServiceAuth(
  headers: ReadonlyArray<{ readonly name: string; readonly value: string }>,
): CustomHeadersServiceAuth {
  if (headers.length === 0) {
    throw new Error("Add at least one service-auth header.");
  }

  const names = new Set<string>();
  const normalized = headers.map((header) => {
    const name = normalizeHeaderName(header.name);
    const lower = name.toLowerCase();
    if (names.has(lower)) {
      throw new Error(`The ${name} service-auth header is configured more than once.`);
    }
    names.add(lower);
    if (!header.value.trim()) {
      throw new Error(`Enter a value for the ${name} service-auth header.`);
    }
    if (/[^\t\x20-\x7e]/.test(header.value)) {
      throw new Error(
        `The ${name} service-auth header must contain only ASCII characters without line breaks.`,
      );
    }
    return new ServiceAuthHeader({ name, value: header.value });
  });

  return new CustomHeadersServiceAuth({ headers: normalized });
}

export function normalizeServiceAuthOrigin(input: string): string {
  const parsed = new URL(input.includes("://") ? input : `https://${input}`);
  if (parsed.protocol === "wss:") {
    parsed.protocol = "https:";
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Service authentication requires an HTTPS environment URL.");
  }
  return parsed.origin.toLowerCase();
}

function headersForAuth(auth: EnvironmentServiceAuth): Readonly<Record<string, string>> {
  return Object.fromEntries(
    auth.headers
      .filter((header) => !FORBIDDEN_HEADER_NAMES.has(header.name.toLowerCase()))
      .map((header) => [header.name, header.value]),
  );
}

export function serviceAuthForUrl(input: string): EnvironmentServiceAuth | null {
  let origin: string;
  try {
    origin = normalizeServiceAuthOrigin(input);
  } catch {
    return null;
  }
  return document.entries.find((entry) => entry.origin === origin)?.auth ?? null;
}

export function serviceAuthHeadersForUrl(input: string): Readonly<Record<string, string>> | null {
  const auth = serviceAuthForUrl(input);
  return auth === null ? null : headersForAuth(auth);
}

async function persist(
  update: (current: EnvironmentServiceAuthDocument) => EnvironmentServiceAuthDocument,
): Promise<void> {
  pendingWrite = pendingWrite
    .catch(() => undefined)
    .then(async () => {
      const next = update(document);
      await SecureStore.setItemAsync(SERVICE_AUTH_STORAGE_KEY, JSON.stringify(next), {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      });
      document = next;
    });
  await pendingWrite;
}

export async function setServiceAuthForUrl(
  input: string,
  auth: EnvironmentServiceAuth | null,
): Promise<void> {
  const origin = normalizeServiceAuthOrigin(input);
  await persist((current) => {
    const entries = current.entries.filter((entry) => entry.origin !== origin);
    return { schemaVersion: 1, entries: auth === null ? entries : [...entries, { origin, auth }] };
  });
}

export async function moveServiceAuth(
  previousUrl: string,
  nextUrl: string,
  auth: EnvironmentServiceAuth | null,
): Promise<void> {
  let previousOrigin: string | null;
  try {
    previousOrigin = normalizeServiceAuthOrigin(previousUrl);
  } catch {
    previousOrigin = null;
  }
  const nextOrigin = auth === null ? null : normalizeServiceAuthOrigin(nextUrl);
  await persist((current) => {
    const entries = current.entries.filter(
      (entry) => entry.origin !== previousOrigin && entry.origin !== nextOrigin,
    );
    return {
      schemaVersion: 1,
      entries:
        auth === null || nextOrigin === null ? entries : [...entries, { origin: nextOrigin, auth }],
    };
  });
}

export async function removeServiceAuthForUrl(input: string): Promise<void> {
  let origin: string;
  try {
    origin = normalizeServiceAuthOrigin(input);
  } catch {
    return;
  }
  await persist((current) => ({
    schemaVersion: 1,
    entries: current.entries.filter((entry) => entry.origin !== origin),
  }));
}

export function clearServiceAuthDocumentForTests(): void {
  document = EMPTY_DOCUMENT;
  pendingWrite = Promise.resolve();
}
