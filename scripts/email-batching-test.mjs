// Tests migrations 0044 (email batching) and 0045 (notification addresses) against the live database through the Supabase
// Management API, the same way earlier migrations were tested.
//
//   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/email-batching-test.mjs
//
// 1. supabase/tests/0044_email_batching.sql: every rule, in ONE transaction that always
//    rolls back (it ends by raising its own results).
// 2. Concurrency, which needs real separate connections and so commits throwaway rows:
//    one test user (@email-test.invalid, which the dispatcher never sends to), one project,
//    bugs. Everything is deleted again at the end, also when a check fails. The portal
//    audit log keeps its rows about them (it outlives what it describes, by design).
import { readFileSync } from "node:fs";

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF =
  process.env.SUPABASE_PROJECT_REF ??
  (() => {
    try {
      const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
      return new URL(env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m)[1].trim()).hostname.split(".")[0];
    } catch {
      return null;
    }
  })();
if (!TOKEN || !REF) {
  console.error("Set SUPABASE_ACCESS_TOKEN (and SUPABASE_PROJECT_REF if .env.local has no NEXT_PUBLIC_SUPABASE_URL).");
  process.exit(2);
}

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.message ?? `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` ${detail}`}`);
}

// 1. The rolled-back rule tests --------------------------------------------------------
console.log("\n# Rules (one rolled-back transaction)");
try {
  await sql(readFileSync(new URL("../supabase/tests/0044_email_batching.sql", import.meta.url), "utf8"));
  check("test file ended with its results", false, "(it returned without raising them)");
} catch (e) {
  const m = /EMAIL TESTS: (\d+) passed, (\d+) failed/.exec(e.message);
  if (!m) check("test file ran", false, e.message);
  else {
    console.log(e.message.split("\n").map((l) => `  ${l}`).join("\n"));
    pass += Number(m[1]);
    fail += Number(m[2]);
  }
}

// 2. Concurrency -------------------------------------------------------------------------
console.log("\n# Concurrency (committed throwaway rows, cleaned up)");
const user = crypto.randomUUID();
const project = crypto.randomUUID();
const email = `concurrency-${user.slice(0, 8)}@email-test.invalid`;
const bugs = Array.from({ length: 12 }, () => crypto.randomUUID());

const items = async () =>
  (
    await sql(`select coalesce(jsonb_agg(i->>'id'), '[]') ids, count(distinct o.id)::int emails
                 from public.email_outbox o, jsonb_array_elements(o.items) i where o.recipient_email = '${email}'`)
  )[0];
const pending = async () =>
  (await sql(`select coalesce(jsonb_agg(bug_id), '[]') ids from public.email_pending where recipient_email = '${email}'`))[0]
    .ids;
const enqueue = (bug, sleep = 0) =>
  sql(`begin;
       select public.email_enqueue('${user}', '${bug}', 'status_change');
       ${sleep ? `select pg_sleep(${sleep});` : ""}
       commit;`);
const reset = () =>
  sql(`delete from public.email_outbox where recipient_email = '${email}';
       delete from public.email_pending where recipient_email = '${email}';`);

try {
  await sql(`
    insert into auth.users (id, email, raw_user_meta_data)
    values ('${user}', '${email}', '{"full_name": "Email concurrency test"}');
    insert into public.notification_emails (user_id, email) values ('${user}', '${email}');
    insert into public.projects (id, name) values ('${project}', 'Email concurrency test ${user.slice(0, 8)}');
    insert into public.project_email_settings (project_id, mode, batch_size) values ('${project}', 'auto_batch', 5);
    insert into public.bugs (id, project_id, title, severity)
    select b, '${project}', 'Email concurrency test bug', 'minor'
      from unnest(array['${bugs.join("','")}']::uuid[]) b;`);

  // a) 10 events for 10 different bugs at the same moment
  await Promise.all(bugs.slice(0, 10).map((b) => enqueue(b)));
  await sql("select public.email_sweep()");
  {
    const out = await items();
    const pend = await pending();
    const all = [...out.ids, ...pend];
    check("10 at once: every bug once, in an email or still pending",
      all.length === 10 && new Set(all).size === 10, JSON.stringify({ emails: out.emails, inEmails: out.ids.length, pending: pend.length }));
    check("10 at once: no email below 5 bugs",
      (await sql(`select coalesce(min(jsonb_array_length(items)), 5) n from public.email_outbox where recipient_email = '${email}'`))[0].n >= 5);
  }
  await reset();

  // b) the 5th bug's flush is still open when a 6th event arrives
  await Promise.all(bugs.slice(0, 4).map((b) => enqueue(b)));
  await Promise.all([enqueue(bugs[4], 3), new Promise((r) => setTimeout(r, 1000)).then(() => enqueue(bugs[5]))]);
  {
    const out = await items();
    const pend = await pending();
    check("overlap: exactly one email with the first 5", out.emails === 1 && out.ids.length === 5, JSON.stringify(out));
    check("overlap: the 6th waits, not sent twice", pend.length === 1 && pend[0] === bugs[5] && !out.ids.includes(bugs[5]),
      JSON.stringify(pend));
  }
  await reset();

  // c) two events for the same bug at once
  await Promise.all([enqueue(bugs[6], 2), enqueue(bugs[6]), enqueue(bugs[6])]);
  check("same bug at once: one pending row", (await pending()).length === 1);
} catch (e) {
  check("concurrency run", false, e.message);
} finally {
  try {
    await sql(`
      delete from public.email_outbox where recipient_email = '${email}';
      delete from public.email_pending where recipient_email = '${email}';
      delete from public.projects where id = '${project}';
      delete from auth.users where id = '${user}';`);
    const left = (await sql(`select (select count(*) from public.bugs where project_id = '${project}')::int b,
                                    (select count(*) from public.profiles where id = '${user}')::int p`))[0];
    check("cleanup: nothing left", left.b === 0 && left.p === 0, JSON.stringify(left));
  } catch (e) {
    check("cleanup", false, `${e.message} — remove user ${user} / project ${project} by hand`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
