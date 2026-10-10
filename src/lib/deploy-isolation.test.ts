import { describe, expect, it } from "vitest";
import { isolationProblems, shouldMigrateOnBuild } from "./deploy-isolation.mjs";

const REF = "prodref1234567890";
const production = {
  DATABASE_URL: `postgresql://postgres.${REF}:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres`,
  DATABASE_MIGRATION_URL: `postgresql://postgres.${REF}:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
  NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co`,
};
const preview = {
  DATABASE_URL: "postgresql://postgres.previewref0000000:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
  DATABASE_MIGRATION_URL: "postgresql://postgres:secret@db.previewref0000000.supabase.co:5432/postgres",
  NEXT_PUBLIC_SUPABASE_URL: "https://previewref0000000.supabase.co",
};

describe("isolationProblems", () => {
  it("leaves local development, tests and production alone", () => {
    expect(isolationProblems({ ...production })).toEqual([]);
    expect(isolationProblems({ ...production, VERCEL_ENV: "production" })).toEqual([]);
  });

  it("fails a preview closed when the production ref is not configured", () => {
    const problems = isolationProblems({ ...preview, VERCEL_ENV: "preview" });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("PRODUCTION_SUPABASE_PROJECT_REF is not set");
  });

  it("accepts a preview with its own project", () => {
    expect(
      isolationProblems({ ...preview, VERCEL_ENV: "preview", PRODUCTION_SUPABASE_PROJECT_REF: REF }),
    ).toEqual([]);
  });

  it("names every production URL a preview is using", () => {
    const problems = isolationProblems({
      ...production,
      VERCEL_ENV: "preview",
      PRODUCTION_SUPABASE_PROJECT_REF: ` ${REF.toUpperCase()} `,
    });
    expect(problems.map((p) => p.split(" ")[0])).toEqual([
      "DATABASE_URL",
      "DATABASE_MIGRATION_URL",
      "NEXT_PUBLIC_SUPABASE_URL",
    ]);
  });

  it("recognises the direct connection host and Vercel development builds", () => {
    const problems = isolationProblems({
      ...preview,
      DATABASE_MIGRATION_URL: `postgresql://postgres:secret@db.${REF}.supabase.co:5432/postgres`,
      VERCEL_ENV: "development",
      PRODUCTION_SUPABASE_PROJECT_REF: `other,${REF}`,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("DATABASE_MIGRATION_URL");
  });

  it("does not match a ref that only shares a prefix", () => {
    expect(
      isolationProblems({
        ...preview,
        DATABASE_URL: `postgresql://postgres.${REF}x:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres`,
        VERCEL_ENV: "preview",
        PRODUCTION_SUPABASE_PROJECT_REF: REF,
      }),
    ).toEqual([]);
  });
});

describe("shouldMigrateOnBuild", () => {
  it("migrates production, and previews only when opted in", () => {
    expect(shouldMigrateOnBuild({ VERCEL_ENV: "production" })).toBe(true);
    expect(shouldMigrateOnBuild({ VERCEL_ENV: "preview" })).toBe(false);
    expect(shouldMigrateOnBuild({ VERCEL_ENV: "preview", PREVIEW_DB_MIGRATE: "1" })).toBe(true);
    expect(shouldMigrateOnBuild({ VERCEL_ENV: "development", PREVIEW_DB_MIGRATE: "1" })).toBe(false);
    expect(shouldMigrateOnBuild({})).toBe(false);
  });
});
