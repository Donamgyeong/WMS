import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
// Atomic, shared between app instances. Client-controlled proxy headers are ignored.
export async function consumeLoginAttempt(email: string) {
  const key = `login:${createHash("sha256").update(email.trim().toLowerCase()).digest("hex")}`;
  const now = Date.now();
  const result = await getDb().execute(sql`
    INSERT INTO auth_rate_limits (id, key, count, last_request)
    VALUES (${key}, ${key}, 1, ${now})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN auth_rate_limits.last_request <= ${now - 60000} THEN 1 ELSE auth_rate_limits.count + 1 END,
      last_request = CASE WHEN auth_rate_limits.last_request <= ${now - 60000} THEN ${now} ELSE auth_rate_limits.last_request END
    RETURNING count
  `);
  return Number(result.rows[0].count) <= 5;
}
