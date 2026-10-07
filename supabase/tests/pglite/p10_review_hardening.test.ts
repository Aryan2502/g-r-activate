// @vitest-environment node
/**
 * Migration 20261008120000_p10_review_hardening.sql (P10 review):
 *
 * 1. uploads per customer are capped (20 files per order folder, 40 new files
 *    per customer per 24 hours; a 21st document row per order is refused with
 *    a Dutch 54000), staff are not limited;
 * 2. has_role() answers a signed-in customer only about their own login;
 * 3. log_recovery_link() audits a password-reset link before it exists;
 * 4. internal_notes changes are in audit_log.
 *
 * The first three cases are the review's proofs turned around: before this
 * migration one order took 150 recorded + 150 unrecorded 10 MB files, a
 * customer learned which login is an admin, and a note was the only (editable)
 * trace of a reset link.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type AuthUser,
  type Db,
  type Transaction,
  asService,
  asUser,
  createAuthUser,
  createDb,
  expectSqlError,
  withSavepoint,
} from "./harness";

let db: Db;
let alice: AuthUser;
let bob: AuthUser;
let admin: AuthUser;
let staff: AuthUser;
let aliceCustomer: string;
let bobCustomer: string;

const TEN_MB = 10 * 1024 * 1024;

async function customerIdOf(userId: string): Promise<string> {
  const r = await db.query<{ id: string }>("select id from public.customers where user_id = $1", [
    userId,
  ]);
  if (!r.rows[0]) throw new Error("no customer");
  return r.rows[0].id;
}

/** What registerOrder() inserts (minimal personal order), as the customer. */
async function registerOrder(user: AuthUser, customerId: string): Promise<string> {
  return asUser(
    db,
    user.id,
    async (tx) =>
      (
        await tx.query<{ id: string }>(
          `insert into public.orders (customer_id, order_type, service_type, store_vendor, description, quantity)
           values ($1, 'personal', 'air', 'Amazon', 'Schoenen', 1) returning id`,
          [customerId],
        )
      ).rows[0]!.id,
    { commit: true },
  );
}

/** The Storage API's insert, as whoever the transaction is. */
async function uploadObject(tx: Transaction, customerId: string, orderId: string) {
  const path = `${customerId}/${orderId}/${randomUUID()}.pdf`;
  await tx.query(
    `insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
     values ('order-documents', $1, auth.uid(), auth.uid()::text,
             jsonb_build_object('mimetype', 'application/pdf', 'size', $2::bigint))`,
    [path, TEN_MB],
  );
  return path;
}

async function recordDocument(tx: Transaction, customerId: string, orderId: string, path: string) {
  await tx.query(
    `insert into public.order_documents
       (order_id, customer_id, kind, storage_path, original_filename, mime_type, size_bytes)
     values ($1, $2, 'other', $3, 'scan.pdf', 'application/pdf', $4)`,
    [orderId, customerId, path, TEN_MB],
  );
}

const count = async (sql: string, params: unknown[] = []) =>
  (await db.query<{ n: number }>(sql, params)).rows[0]!.n;

beforeAll(async () => {
  db = await createDb();
  alice = await createAuthUser(db, {
    email: "alice@example.com",
    meta: { full_name: "Alice Jansen", phone: "+597 8000001" },
  });
  bob = await createAuthUser(db, {
    email: "bob@example.com",
    meta: { full_name: "Bob Pinas", phone: "+597 8000002" },
  });
  admin = await createAuthUser(db, { email: "maria@example.com" });
  staff = await createAuthUser(db, { email: "kevin@example.com" });
  await db.query(
    "insert into public.user_roles (user_id, role) values ($1, 'admin'), ($2, 'staff')",
    [admin.id, staff.id],
  );
  aliceCustomer = await customerIdOf(alice.id);
  bobCustomer = await customerIdOf(bob.id);
});

afterAll(async () => {
  await db?.close();
});

describe("upload limits", () => {
  it("a customer stores at most 20 files per order, recorded or not", async () => {
    const orderId = await registerOrder(alice, aliceCustomer);
    const result = await asUser(db, alice.id, async (tx) => {
      // 10 recorded and 10 unrecorded uploads: all fine.
      for (let i = 0; i < 10; i++) {
        await recordDocument(
          tx,
          aliceCustomer,
          orderId,
          await uploadObject(tx, aliceCustomer, orderId),
        );
        await uploadObject(tx, aliceCustomer, orderId);
      }
      // The 21st file in the folder is refused by the storage policy.
      const err = await expectSqlError(
        withSavepoint(tx, () => uploadObject(tx, aliceCustomer, orderId)),
        "42501",
      );
      const n = await tx.query<{ n: number }>(
        "select count(*)::int as n from storage.objects where name like $1",
        [`${aliceCustomer}/${orderId}/%`],
      );
      return { message: err.message, objects: n.rows[0]!.n };
    });
    expect(result.message).toMatch(/row-level security/);
    expect(result.objects).toBe(20);
  });

  it("a 21st document row for one order gets a Dutch 54000; staff are not limited", async () => {
    const orderId = await registerOrder(alice, aliceCustomer);
    // Staff upload and record 25 files for the customer: no limit for them.
    await asUser(
      db,
      staff.id,
      async (tx) => {
        for (let i = 0; i < 20; i++) {
          await recordDocument(
            tx,
            aliceCustomer,
            orderId,
            await uploadObject(tx, aliceCustomer, orderId),
          );
        }
        for (let i = 0; i < 5; i++) await uploadObject(tx, aliceCustomer, orderId);
      },
      { commit: true },
    );
    expect(
      await count("select count(*)::int as n from storage.objects where name like $1", [
        `${aliceCustomer}/${orderId}/%`,
      ]),
    ).toBe(25);

    const unrecorded = (
      await db.query<{ name: string }>(
        `select so.name from storage.objects so
          where so.name like $1
            and not exists (select 1 from public.order_documents d where d.storage_path = so.name)
          limit 1`,
        [`${aliceCustomer}/${orderId}/%`],
      )
    ).rows[0]!.name;
    await asUser(db, alice.id, async (tx) => {
      // The folder is full for the customer…
      await expectSqlError(
        withSavepoint(tx, () => uploadObject(tx, aliceCustomer, orderId)),
        "42501",
      );
      // …and a 21st row (for a file staff uploaded) is refused with a message.
      const err = await expectSqlError(
        withSavepoint(tx, () => recordDocument(tx, aliceCustomer, orderId, unrecorded)),
        "54000",
      );
      expect(err.message).toBe(
        "U kunt maximaal 20 documenten bij één order toevoegen. Neem contact op met G&R Solutions als u meer moet sturen.",
      );
    });
    // Staff still record it.
    await asUser(db, staff.id, (tx) => recordDocument(tx, aliceCustomer, orderId, unrecorded));
  });

  it("a customer uploads at most 40 new files per 24 hours over all orders", async () => {
    const orders = [
      await registerOrder(bob, bobCustomer),
      await registerOrder(bob, bobCustomer),
      await registerOrder(bob, bobCustomer),
    ];
    await asUser(
      db,
      bob.id,
      async (tx) => {
        for (let i = 0; i < 20; i++) await uploadObject(tx, bobCustomer, orders[0]!);
        for (let i = 0; i < 20; i++) await uploadObject(tx, bobCustomer, orders[1]!);
      },
      { commit: true },
    );
    // The third order's folder is empty, but the day's budget is used up.
    await asUser(db, bob.id, (tx) =>
      expectSqlError(
        withSavepoint(tx, () => uploadObject(tx, bobCustomer, orders[2]!)),
        "42501",
      ),
    );
    // A day later the budget is back (only uploads of the last 24 hours count).
    await db.query(
      "update storage.objects set created_at = now() - interval '25 hours' where name like $1",
      [`${bobCustomer}/%`],
    );
    await asUser(db, bob.id, (tx) => uploadObject(tx, bobCustomer, orders[2]!));
  });

  it("keeps the earlier rules: own open orders only", async () => {
    const bobOrder = await registerOrder(bob, bobCustomer);
    await asUser(db, alice.id, (tx) =>
      expectSqlError(
        withSavepoint(tx, () => uploadObject(tx, bobCustomer, bobOrder)),
        "42501",
      ),
    );
    await db.query("update public.orders set status = 'cancelled' where id = $1", [bobOrder]);
    await db.query(
      "update storage.objects set created_at = now() - interval '25 hours' where name like $1",
      [`${bobCustomer}/%`],
    );
    await asUser(db, bob.id, (tx) =>
      expectSqlError(
        withSavepoint(tx, () => uploadObject(tx, bobCustomer, bobOrder)),
        "42501",
      ),
    );
  });
});

describe("has_role()", () => {
  it("answers a customer only about their own login", async () => {
    const orderId = await registerOrder(alice, aliceCustomer);
    // The admin receives the package: received_by and changed_by hold the admin id.
    await asUser(
      db,
      admin.id,
      (tx) => tx.query("select public.receive_order($1, 2.5)", [orderId]),
      {
        commit: true,
      },
    );
    const seen = await asUser(db, alice.id, async (tx) => {
      const actor = (
        await tx.query<{ received_by: string }>(
          "select received_by from public.orders where id = $1",
          [orderId],
        )
      ).rows[0]!.received_by;
      const roles = await tx.query<{ admin: boolean; staff: boolean; own: boolean }>(
        `select public.has_role($1, 'admin') as admin, public.has_role($2, 'staff') as staff,
                public.has_role(auth.uid(), 'admin') as own`,
        [actor, staff.id],
      );
      return { actor, ...roles.rows[0] };
    });
    // The id is still readable (spec-sanctioned), but no longer tells who is admin.
    expect(seen).toEqual({ actor: admin.id, admin: false, staff: false, own: false });
  });

  it("still answers staff, the server and the database itself", async () => {
    expect(
      await asUser(
        db,
        staff.id,
        async (tx) =>
          (await tx.query<{ a: boolean }>("select public.has_role($1, 'admin') as a", [admin.id]))
            .rows[0]!.a,
      ),
    ).toBe(true);
    // is_admin() asks about the caller: unchanged.
    expect(
      await asUser(
        db,
        admin.id,
        async (tx) => (await tx.query<{ a: boolean }>("select public.is_admin() as a")).rows[0]!.a,
      ),
    ).toBe(true);
    // No login (service role, SQL editor, cron): the real answer, so
    // get_invitation / redeem_invitation keep checking the inviter's rights.
    const viaService = await asService(db, async (tx) => {
      await tx.query("reset role");
      return (
        await tx.query<{ a: boolean }>("select public.has_role($1, 'admin') as a", [admin.id])
      ).rows[0]!.a;
    });
    expect(viaService).toBe(true);
    expect(
      (await db.query<{ a: boolean }>("select public.has_role($1, 'admin') as a", [admin.id]))
        .rows[0]!.a,
    ).toBe(true);
  });
});

describe("log_recovery_link()", () => {
  const recoveryRows = (userId: string) =>
    db.query<{ actor_id: string; action: string; new_data: Record<string, unknown> }>(
      "select actor_id, action, new_data from public.audit_log where table_name = 'recovery_link' and record_id = $1 order by id",
      [userId],
    );

  it("staff log a link for a customer login; the row names who and for whom", async () => {
    await asUser(
      db,
      staff.id,
      (tx) => tx.query("select public.log_recovery_link($1)", [alice.id]),
      {
        commit: true,
      },
    );
    const { rows } = await recoveryRows(alice.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_id).toBe(staff.id);
    expect(rows[0]!.action).toBe("INSERT");
    const code = (
      await db.query<{ customer_code: string }>(
        "select customer_code from public.customers where id = $1",
        [aliceCustomer],
      )
    ).rows[0]!.customer_code;
    expect(rows[0]!.new_data).toEqual({
      user_id: alice.id,
      team: false,
      customer_id: aliceCustomer,
      customer_code: code,
      full_name: "Alice Jansen",
    });
  });

  it("a team login needs an admin; customers and anon never", async () => {
    await asUser(db, staff.id, (tx) =>
      expectSqlError(tx.query("select public.log_recovery_link($1)", [admin.id]), "42501"),
    );
    await asUser(db, alice.id, (tx) =>
      expectSqlError(tx.query("select public.log_recovery_link($1)", [bob.id]), "42501"),
    );
    await asUser(
      db,
      admin.id,
      (tx) => tx.query("select public.log_recovery_link($1)", [staff.id]),
      {
        commit: true,
      },
    );
    const { rows } = await recoveryRows(staff.id);
    expect(rows.map((r) => [r.actor_id, r.new_data["team"]])).toEqual([[admin.id, true]]);
    expect(
      await count(
        "select count(*)::int as n from public.audit_log where table_name = 'recovery_link' and record_id = $1",
        [bob.id],
      ),
    ).toBe(0);
  });

  it("checks its arguments", async () => {
    await asUser(db, staff.id, async (tx) => {
      await expectSqlError(
        withSavepoint(tx, () => tx.query("select public.log_recovery_link(null)")),
        "22023",
      );
      await expectSqlError(
        withSavepoint(tx, () => tx.query("select public.log_recovery_link($1)", [randomUUID()])),
        "P0002",
      );
    });
  });
});

describe("internal_notes in the audit log", () => {
  it("a rewritten or deleted note keeps its old text in audit_log", async () => {
    const noteId = await asUser(
      db,
      staff.id,
      async (tx) =>
        (
          await tx.query<{ id: string }>(
            "insert into public.internal_notes (customer_id, body) values ($1, $2) returning id",
            [aliceCustomer, "Wachtwoord-resetlink gemaakt"],
          )
        ).rows[0]!.id,
      { commit: true },
    );
    await asUser(
      db,
      staff.id,
      (tx) =>
        tx.query("update public.internal_notes set body = 'Klant gebeld' where id = $1", [noteId]),
      { commit: true },
    );
    await asUser(
      db,
      admin.id,
      (tx) => tx.query("delete from public.internal_notes where id = $1", [noteId]),
      {
        commit: true,
      },
    );
    const { rows } = await db.query<{
      actor_id: string;
      action: string;
      old_body: string | null;
      new_body: string | null;
      changed_columns: string[] | null;
    }>(
      `select actor_id, action, old_data ->> 'body' as old_body, new_data ->> 'body' as new_body, changed_columns
         from public.audit_log where table_name = 'internal_notes' and record_id = $1 order by id`,
      [noteId],
    );
    expect(rows).toEqual([
      {
        actor_id: staff.id,
        action: "INSERT",
        old_body: null,
        new_body: "Wachtwoord-resetlink gemaakt",
        changed_columns: null,
      },
      {
        actor_id: staff.id,
        action: "UPDATE",
        old_body: "Wachtwoord-resetlink gemaakt",
        new_body: "Klant gebeld",
        changed_columns: ["body"],
      },
      {
        actor_id: admin.id,
        action: "DELETE",
        old_body: "Klant gebeld",
        new_body: null,
        changed_columns: null,
      },
    ]);
  });
});
