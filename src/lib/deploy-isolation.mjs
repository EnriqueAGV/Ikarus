// Keeps Vercel preview deployments off the production database (OPS-01).
// Plain JavaScript so the build script can run it before anything is compiled;
// the app imports it too and runs the same check when it starts.
//
// PRODUCTION_SUPABASE_PROJECT_REF names the production Supabase project (the
// "abcdefghijklmnop" in abcdefghijklmnop.supabase.co). It is not a secret: set
// it for every Vercel environment. Comma-separated values are all treated as
// production. Any deployment that is not production refuses database or
// Supabase URLs that point at one of them, and refuses to run without the
// variable, so a forgotten setting fails the deployment instead of reaching
// patient data.

/** URLs that reach the database or Supabase project. */
export const ISOLATED_URL_VARIABLES = [
  "DATABASE_URL",
  "DATABASE_MIGRATION_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
];

/** @param {string | undefined} value */
function productionRefs(value) {
  return (value ?? "")
    .split(",")
    .map((ref) => ref.trim().toLowerCase())
    .filter(Boolean);
}

// Supabase puts the project ref in the host (db.<ref>.supabase.co,
// <ref>.supabase.co) or, on the poolers, in the user name (postgres.<ref>).
/** @param {string} value @param {string[]} refs */
function pointsAtProduction(value, refs) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const labels = url.hostname.toLowerCase().split(".");
  const user = decodeURIComponent(url.username).toLowerCase();
  return refs.some((ref) => labels.includes(ref) || user.endsWith(`.${ref}`) || user === ref);
}

/**
 * Problems that must stop this deployment; empty when it may proceed.
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
export function isolationProblems(env) {
  const target = env.VERCEL_ENV;
  // Local development, tests and CI are not Vercel deployments.
  if (!target || target === "production") return [];

  const refs = productionRefs(env.PRODUCTION_SUPABASE_PROJECT_REF);
  if (refs.length === 0) {
    return [
      `PRODUCTION_SUPABASE_PROJECT_REF is not set, so this ${target} deployment cannot ` +
        "prove it is not using the production database. Set it in Vercel for every environment.",
    ];
  }
  return ISOLATED_URL_VARIABLES.filter((name) => {
    const value = env[name];
    return value && pointsAtProduction(value, refs);
  }).map(
    (name) =>
      `${name} points at the production Supabase project in a ${target} deployment. ` +
      `Give the ${target} environment its own database and Supabase credentials in Vercel.`,
  );
}

/** @param {Record<string, string | undefined>} env */
export function assertDeploymentIsolation(env) {
  const problems = isolationProblems(env);
  if (problems.length > 0) {
    throw new Error(`Refusing to use production data outside production:\n- ${problems.join("\n- ")}`);
  }
}

/**
 * Whether this build should apply migrations. Production always does; a preview
 * does only when PREVIEW_DB_MIGRATE=1 opts it in (its database having passed
 * the isolation check); everything else leaves the database alone.
 * @param {Record<string, string | undefined>} env
 */
export function shouldMigrateOnBuild(env) {
  if (env.VERCEL_ENV === "production") return true;
  return env.VERCEL_ENV === "preview" && env.PREVIEW_DB_MIGRATE === "1";
}
