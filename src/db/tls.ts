// Database connections are always encrypted: postgres.js connects in plain
// text unless told otherwise, and Supabase's connection strings don't say.
// An explicit sslmode in the URL wins; a local database (tests, development)
// has no TLS and is left alone.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function withTls(databaseUrl: string) {
  const url = new URL(databaseUrl);
  if (url.searchParams.has("sslmode") || LOCAL_HOSTS.has(url.hostname)) return databaseUrl;
  url.searchParams.set("sslmode", "require");
  return url.toString();
}
