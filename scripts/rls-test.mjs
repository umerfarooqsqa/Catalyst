import { createClient } from "@supabase/supabase-js";

const URL = "https://axlvyftdvwpxmlnglsvs.supabase.co";
const ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF4bHZ5ZnRkdndweG1sbmdsc3ZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5MzgwNzgsImV4cCI6MjEwNDUxNDA3OH0.BHQrPyT8MauUc4lXIGiPC9EW-EYV4TuUOILKYRe2VzM";

const PW = "Passw0rd!";
const users = {
  admin: "admin@catalyst.test",
  qa: "qa@catalyst.test",
  deva: "deva@catalyst.test",
  devw: "devw@catalyst.test",
  viewer: "viewer@catalyst.test",
};

let pass = 0,
  fail = 0;
function check(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
}

async function clientFor(email) {
  const c = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return c;
}

const C = {};
for (const [k, v] of Object.entries(users)) C[k] = await clientFor(v);

console.log("\n# Auth / persistent login");
for (const k of Object.keys(users)) {
  const { data } = await C[k].auth.getUser();
  check(`${k} authenticated`, !!data.user);
}

console.log("\n# SELECT visibility (everyone can read core tables)");
for (const k of Object.keys(users)) {
  const { data, error } = await C[k].from("bugs").select("id").limit(1);
  check(`${k} can read bugs`, !error && Array.isArray(data), error?.message);
  const { data: m } = await C[k].from("base_page").select("id").limit(1);
  check(`${k} can read base_page`, Array.isArray(m));
}

console.log("\n# Notifications are recipient-scoped");
{
  const { data: adminN } = await C.admin.from("notifications").select("user_id");
  const { data: adminMe } = await C.admin.auth.getUser();
  check(
    "admin only sees own notifications",
    (adminN ?? []).every((n) => n.user_id === adminMe.user.id),
  );
}

console.log("\n# INSERT bug: qa/admin yes, dev/viewer no");
async function tryInsertBug(c, label) {
  // grab a project id
  const { data: proj } = await c.from("projects").select("id").limit(1).single();
  const { error } = await c.from("bugs").insert({
    project_id: proj.id,
    title: `RLS test insert by ${label} ${Date.now()}`,
  });
  return error;
}
check("qa can insert bug", !(await tryInsertBug(C.qa, "qa")));
check("admin can insert bug", !(await tryInsertBug(C.admin, "admin")));
check("dev_app CANNOT insert bug", !!(await tryInsertBug(C.deva, "deva")));
check("viewer CANNOT insert bug", !!(await tryInsertBug(C.viewer, "viewer")));

console.log("\n# UPDATE bug: dev only if assignee");
{
  // find a bug assigned to deva
  const { data: devaMe } = await C.deva.auth.getUser();
  const { data: assigned } = await C.deva
    .from("bugs")
    .select("id, title")
    .eq("assignee_id", devaMe.user.id)
    .limit(1);
  if (assigned?.length) {
    const { error } = await C.deva
      .from("bugs")
      .update({ status: "in_progress" })
      .eq("id", assigned[0].id);
    check("dev_app can update a bug assigned to them", !error, error?.message);
  } else {
    check("dev_app has an assigned bug to test", false, "(no seed match)");
  }
  // deva tries to update a bug NOT assigned to them
  const { data: others } = await C.deva
    .from("bugs")
    .select("id")
    .neq("assignee_id", devaMe.user.id)
    .limit(1);
  if (others?.length) {
    const { data: upd } = await C.deva
      .from("bugs")
      .update({ status: "closed" })
      .eq("id", others[0].id)
      .select("id");
    check(
      "dev_app CANNOT update a bug not assigned to them",
      (upd ?? []).length === 0,
    );
  }
}

console.log("\n# viewer cannot update anything");
{
  const { data: b } = await C.viewer.from("bugs").select("id").limit(1).single();
  const { data: upd } = await C.viewer
    .from("bugs")
    .update({ status: "closed" })
    .eq("id", b.id)
    .select("id");
  check("viewer update no-ops (RLS)", (upd ?? []).length === 0);
}

console.log("\n# requirements: qa/admin write, dev/viewer no");
async function tryInsertReq(c) {
  const { data: proj } = await c.from("projects").select("id").limit(1).single();
  const { error } = await c
    .from("requirements")
    .insert({ project_id: proj.id, title: `RLS req ${Date.now()}` });
  return error;
}
check("qa can insert requirement", !(await tryInsertReq(C.qa)));
check("dev_web CANNOT insert requirement", !!(await tryInsertReq(C.devw)));

console.log("\n# projects: admin + qa can create; dev/viewer cannot");
async function tryInsertProject(c) {
  const { error } = await c
    .from("projects")
    .insert({ name: `RLS proj ${Date.now()}` });
  return error;
}
check("admin can insert project", !(await tryInsertProject(C.admin)));
check("qa can insert project", !(await tryInsertProject(C.qa)));
check("dev_app CANNOT insert project", !!(await tryInsertProject(C.deva)));
check("viewer CANNOT insert project", !!(await tryInsertProject(C.viewer)));

console.log("\n# base_page (library): qa/admin insert, dev no");
check(
  "qa can insert base_page master_bug",
  !(
    await C.qa
      .from("base_page")
      .insert({ title: `RLS master ${Date.now()}`, source_type: "master_bug" })
  ).error,
);
check(
  "dev_app CANNOT insert base_page",
  !!(
    await C.deva
      .from("base_page")
      .insert({ title: `RLS master ${Date.now()}`, source_type: "master_bug" })
  ).error,
);

console.log("\n# retest-ready notification to reporter");
{
  // qa creates a bug, assigns to deva; deva marks ready_for_retest; qa gets a notif
  const { data: proj } = await C.qa
    .from("projects")
    .select("id")
    .limit(1)
    .single();
  const { data: qaMe } = await C.qa.auth.getUser();
  const { data: devaMe } = await C.deva.auth.getUser();
  const { data: bug } = await C.qa
    .from("bugs")
    .insert({
      project_id: proj.id,
      title: `retest flow ${Date.now()}`,
      assignee_id: devaMe.user.id,
      created_by: qaMe.user.id,
    })
    .select("id")
    .single();
  await C.deva.from("bugs").update({ status: "ready_for_retest" }).eq("id", bug.id);
  await new Promise((r) => setTimeout(r, 500));
  const { data: notifs } = await C.qa
    .from("notifications")
    .select("type, related_bug_id")
    .eq("related_bug_id", bug.id);
  check(
    "reporter got retest_ready notification",
    (notifs ?? []).some((n) => n.type === "retest_ready"),
    JSON.stringify(notifs),
  );
}

console.log("\n# roles table: everyone reads, only admin writes");
{
  const { data: rolesRead } = await C.viewer.from("roles").select("key").limit(1);
  check("viewer can read roles", Array.isArray(rolesRead) && rolesRead.length > 0);
  const { error: qaWrite } = await C.qa
    .from("roles")
    .insert({ key: `rls_test_${Date.now()}`, label: "x", level: "viewer" });
  check("qa CANNOT create a role", !!qaWrite);
  const { data: adminWrite } = await C.admin
    .from("roles")
    .insert({ key: `rls_test_${Date.now()}`, label: "RLS Test", level: "viewer" })
    .select("id");
  check("admin can create a role", (adminWrite ?? []).length === 1);
  if (adminWrite?.length)
    await C.admin.from("roles").delete().eq("id", adminWrite[0].id);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
