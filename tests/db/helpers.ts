import { Client } from "pg";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/moka_test";

export async function connect(): Promise<Client> {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  return client;
}

/** Crée un utilisateur Supabase Auth simulé (comme le ferait l'inscription). */
export async function createUser(db: Client, email: string, fullName?: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
    [email, JSON.stringify(fullName ? { full_name: fullName } : {})],
  );
  return rows[0].id;
}

/**
 * Exécute fn exactement comme une requête de l'API Supabase :
 * rôle `authenticated` (ou `anon`), JWT dont le `sub` est l'utilisateur.
 * Aucune clé service_role : les politiques RLS s'appliquent.
 * Tout est annulé à la fin (ROLLBACK) sauf si commit = true.
 */
export async function as<T>(
  db: Client,
  userId: string | null,
  fn: () => Promise<T>,
  { commit = false } = {},
): Promise<T> {
  await db.query("begin");
  try {
    await db.query(`set local role ${userId ? "authenticated" : "anon"}`);
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(userId ? { sub: userId, role: "authenticated" } : { role: "anon" }),
    ]);
    const result = await fn();
    await db.query(commit ? "commit" : "rollback");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}
