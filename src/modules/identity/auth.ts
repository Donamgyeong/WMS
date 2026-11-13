import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
function createAuth() {
  const secret = process.env.BETTER_AUTH_SECRET;
  const baseURL = process.env.BETTER_AUTH_URL;
  if (!secret || secret.length < 32 || !baseURL)
    throw new Error(
      "BETTER_AUTH_SECRET (32+ characters) and BETTER_AUTH_URL are required",
    );
  return betterAuth({
    secret,
    baseURL,
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    session: {
      expiresIn: 8 * 60 * 60,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: { "/sign-in/email": { window: 60, max: 100 } },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const [employee] = await getDb()
              .select()
              .from(schema.employees)
              .where(eq(schema.employees.userId, session.userId));
            if (!employee?.active)
              throw new APIError("UNAUTHORIZED", {
                message: "Invalid email or password",
              });
            return {
              data: {
                ...session,
                expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
              },
            };
          },
        },
      },
    },
    advanced: { ipAddress: { ipAddressHeaders: [] } },
  });
}
let instance: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  return (instance ??= createAuth());
}
