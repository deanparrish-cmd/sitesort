import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const users = await db.select({ id: usersTable.id, email: usersTable.email, name: usersTable.name, role: usersTable.role }).from(usersTable).where(eq(usersTable.email, "dean.parrish@me.com"));
  console.log(JSON.stringify(users, null, 2));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
