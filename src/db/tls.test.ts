import { describe, expect, it } from "vitest";
import { withTls } from "./tls";

describe("withTls", () => {
  it("requires TLS for remote databases", () => {
    expect(withTls("postgresql://u:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres")).toBe(
      "postgresql://u:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require",
    );
  });

  it("keeps an explicit sslmode and leaves local databases alone", () => {
    expect(withTls("postgres://u:p@db.example.com/x?sslmode=verify-full")).toBe("postgres://u:p@db.example.com/x?sslmode=verify-full");
    expect(withTls("postgres://ikarus:ikarus@localhost:5432/ikarus_test")).toBe("postgres://ikarus:ikarus@localhost:5432/ikarus_test");
  });
});
