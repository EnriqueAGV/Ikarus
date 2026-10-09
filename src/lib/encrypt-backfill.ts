import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { currentKeyVersion, decrypt, keyVersion } from "@/lib/crypto";

// Rewrites rows stored before encryption (or under an older key) with the
// current key. Safe to run any number of times. Signed notes and addenda are
// left alone: they were encrypted from the start, and the database refuses
// to change them, so rotating their key needs its own migration.
const BATCH = 500;

const stale = (value: string | null) => value !== null && keyVersion(value) !== currentKeyVersion();

export async function encryptExistingRows() {
  let clients = 0;
  let messages = 0;

  for (let after = ""; ; ) {
    const rows = await db.execute<{ id: string; data: string; dui: string | null; allergies: string | null; chronic_conditions: string | null }>(
      sql`select id, data, dui, allergies, chronic_conditions from clients where id::text > ${after} order by id::text limit ${BATCH}`,
    );
    if (rows.length === 0) break;
    for (const r of rows) {
      if (![r.data, r.dui, r.allergies, r.chronic_conditions].some(stale)) continue;
      const plain = (v: string | null, column: string) => (v === null ? null : decrypt(v, `clients.${column}`));
      await db
        .update(schema.clients)
        .set({
          data: JSON.parse(plain(r.data, "data")!),
          dui: plain(r.dui, "dui"),
          allergies: plain(r.allergies, "allergies"),
          chronicConditions: plain(r.chronic_conditions, "chronic_conditions"),
        })
        .where(eq(schema.clients.id, r.id));
      clients++;
    }
    after = rows.at(-1)!.id;
  }

  for (let after = ""; ; ) {
    const rows = await db.execute<{ id: string; body: string | null; payload: string | null }>(
      sql`select id, body, payload from messages where id::text > ${after} order by id::text limit ${BATCH}`,
    );
    if (rows.length === 0) break;
    for (const r of rows) {
      if (![r.body, r.payload].some(stale)) continue;
      await db
        .update(schema.messages)
        .set({
          body: r.body === null ? null : decrypt(r.body, "messages.body"),
          payload: r.payload === null ? null : JSON.parse(decrypt(r.payload, "messages.payload")),
        })
        .where(eq(schema.messages.id, r.id));
      messages++;
    }
    after = rows.at(-1)!.id;
  }

  return { clients, messages };
}
