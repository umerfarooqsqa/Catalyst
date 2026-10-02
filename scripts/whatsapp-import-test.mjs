// Tests migrations 0046 (WhatsApp import) and 0047 (Grok inbox) against the live database through the Supabase
// Management API.
//
//   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/whatsapp-import-test.mjs
//
// 1. supabase/tests/0046_whatsapp_import.sql: every rule, in ONE transaction that always rolls back.
// 2. Two imports of the same new app at the same moment create ONE project. This needs separate
//    connections, so it commits throwaway rows (a QA user, the project, its bugs) and deletes
//    them at the end, also when a check fails. The portal audit log keeps its rows about them.
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
  if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
  return body;
}

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` ${detail}`}`);
}

console.log("\n# Rules (one rolled-back transaction)");
try {
  await sql(readFileSync(new URL("../supabase/tests/0046_whatsapp_import.sql", import.meta.url), "utf8"));
  check("test file ended with its results", false, "(it returned without raising them)");
} catch (e) {
  const m = /WHATSAPP TESTS: (\d+) passed, (\d+) failed/.exec(e.message);
  if (!m) check("test file ran", false, e.message);
  else {
    console.log(e.message.split("\n").filter((l) => /TESTS|FAIL/.test(l)).map((l) => `  ${l.replace(/^.*?WHATSAPP/, "WHATSAPP")}`).join("\n"));
    pass += Number(m[1]);
    fail += Number(m[2]);
  }
}

console.log("\n# Grok inbox (0047, one rolled-back transaction)");
try {
  await sql(readFileSync(new URL("../supabase/tests/0047_whatsapp_inbox.sql", import.meta.url), "utf8"));
  check("inbox test file ended with its results", false, "(it returned without raising them)");
} catch (e) {
  const m = /INBOX TESTS: (\d+) passed, (\d+) failed/.exec(e.message);
  if (!m) check("inbox test file ran", false, e.message);
  else {
    console.log(e.message.split("\n").filter((l) => /TESTS|FAIL/.test(l)).map((l) => `  ${l.replace(/^.*?INBOX/, "INBOX")}`).join("\n"));
    pass += Number(m[1]);
    fail += Number(m[2]);
  }
}

console.log("\n# Automatic import (0048, one rolled-back transaction)");
try {
  await sql(readFileSync(new URL("../supabase/tests/0048_whatsapp_auto_import.sql", import.meta.url), "utf8"));
  check("auto test file ended with its results", false, "(it returned without raising them)");
} catch (e) {
  const m = /AUTO TESTS: (\d+) passed, (\d+) failed/.exec(e.message);
  if (!m) check("auto test file ran", false, e.message);
  else {
    console.log(e.message.split("\n").filter((l) => /TESTS|FAIL/.test(l)).map((l) => `  ${l.replace(/^.*?AUTO/, "AUTO")}`).join("\n"));
    pass += Number(m[1]);
    fail += Number(m[2]);
  }
}

console.log("\n# Two imports of the same new app at once (committed throwaway rows, cleaned up)");
const qa = crypto.randomUUID();
const tag = qa.slice(0, 8);
const app = `WA concurrency ${tag}`;
const row = (item) =>
  JSON.stringify([{ item_id: item, type: "bug", house: "unknown", app_name: app, title: `Concurrency test ${item}` }]);
const importAs = (item, sleep) =>
  sql(`begin;
       select set_config('request.jwt.claims', '${JSON.stringify({ sub: qa, role: "authenticated" })}', true);
       select public.whatsapp_import('${row(item)}'::jsonb, true, false);
       ${sleep ? `select pg_sleep(${sleep});` : ""}
       commit;`);

try {
  await sql(`insert into auth.users (id, email, raw_user_meta_data)
             values ('${qa}', 'wa-conc-${tag}@login-test.invalid',
                     jsonb_build_object('full_name', 'WA concurrency test',
                       'role', (select key from public.roles where level = 'manager' order by key limit 1)));`);
  await Promise.all([importAs(`WAC-${tag}-1`, 2), new Promise((r) => setTimeout(r, 500)).then(() => importAs(`WAC-${tag}-2`, 0))]);
  const [res] = await sql(`select (select count(*) from public.projects where name_key = public.project_name_key('${app}'))::int projects,
                                  (select count(distinct project_id) from public.whatsapp_items where item_id like 'WAC-${tag}-%')::int used,
                                  (select count(*) from public.whatsapp_items where item_id like 'WAC-${tag}-%')::int items`);
  check("one project created", res.projects === 1, JSON.stringify(res));
  check("both items filed in it", res.items === 2 && res.used === 1, JSON.stringify(res));
} catch (e) {
  check("concurrency run", false, e.message);
} finally {
  try {
    await sql(`delete from public.whatsapp_items where item_id like 'WAC-${tag}-%';
               delete from public.projects where name_key = public.project_name_key('${app}');
               delete from auth.users where id = '${qa}';`);
    const [left] = await sql(`select (select count(*) from public.projects where name_key = public.project_name_key('${app}'))::int p,
                                     (select count(*) from public.profiles where id = '${qa}')::int u`);
    check("cleanup: nothing left", left.p === 0 && left.u === 0, JSON.stringify(left));
  } catch (e) {
    check("cleanup", false, `${e.message} — remove project "${app}" and user ${qa} by hand`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
