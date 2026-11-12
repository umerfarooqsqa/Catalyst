"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Badge, Button, cx } from "@/components/ui";
import GrokScanButton from "@/components/GrokScanButton";

/**
 * "WhatsApp from Grok" on the Bug Library (migration 0050). Lists Grok's messages that are
 * still waiting, by WhatsApp group. QA gives each group its house (remembered: Grok's later
 * rows from that group are filed there automatically), or marks it mixed, and can choose
 * per message. Import files them as bugs/tasks in the house's project through
 * whatsapp_import, the same function as /import/whatsapp. The preview is its dry run, so it
 * shows exactly what Import does. Grok pushes rows to catalyst; nothing is fetched from Grok.
 */
type Row = Record<string, string>;
type Planned = {
  item_id: string | null;
  action: "bug" | "task" | "skip";
  reason: string | null;
  project_name: string | null;
  how: "house" | "name" | "group" | "chosen" | "new" | "ambiguous" | "none" | null;
};
type Result = { rows: Planned[] };
type Proj = { id: string; name: string; platform: string | null; house_slug: string | null; house_group: string | null };
type Group = { group_key: string; group_name: string; project_id: string | null; mixed: boolean };

// Same normalisation as public.project_name_key(), which keys whatsapp_groups.
const groupKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "") || s.trim().toLowerCase();
const HOW: Record<string, string> = { house: "by house", name: "by name", group: "group's house", chosen: "chosen" };
const NO_GROUP = "(no group)";

const needsHouse = (p: Planned | undefined) =>
  !!p && p.action === "skip" &&
  (p.how === "ambiguous" || p.reason === "no house or app name" || !!p.reason?.startsWith("no project"));

export default function WhatsAppGroupsDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [projects, setProjects] = useState<Proj[]>([]);
  const [groups, setGroups] = useState<Record<string, Group> | null>(null); // null = 0050 not applied
  const [plan, setPlan] = useState<Planned[]>([]);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const preview = useCallback(
    async (src: Row[], pick: Record<string, string>, skip: Record<string, boolean>, dry = true) => {
      setBusy(true);
      setErr(null);
      const { data, error } = await createClient().rpc("whatsapp_import", {
        p_rows: src.map((r) => ({
          ...r,
          ...(pick[r.item_id] ? { project_id: pick[r.item_id] } : {}),
          ...(skip[r.item_id] ? { skip: true } : {}),
        })),
        p_create_projects: false, // assign to existing houses only; new projects are made on /import/whatsapp
        p_dry_run: dry,
      });
      setBusy(false);
      if (error) {
        setErr(error.message);
        return null;
      }
      const res = data as unknown as Result;
      if (dry) setPlan(res.rows);
      return res;
    },
    [],
  );

  const load = useCallback(async () => {
    const sb = createClient();
    const [w, g, p] = await Promise.all([
      sb.rpc("whatsapp_inbox_waiting"),
      sb.from("whatsapp_groups").select("group_key, group_name, project_id, mixed"),
      sb.from("projects").select("id, name, platform, house_slug, house_group").order("name"),
    ]);
    if (w.error) {
      setRows([]);
      return setErr(`Grok's inbox can't be read: ${w.error.message}`);
    }
    setProjects((p.data ?? []) as Proj[]);
    setGroups(g.error ? null : Object.fromEntries(((g.data ?? []) as Group[]).map((x) => [x.group_key, x])));
    const src = (w.data ?? []).map((x) => {
      const r: Row = {};
      for (const [k, v] of Object.entries((x.row ?? {}) as Record<string, unknown>)) {
        if (!["project_id", "skip", "via_group"].includes(k)) r[k] = String(v ?? "");
      }
      r.item_id = x.item_id;
      return r;
    });
    setRows(src);
    if (src.length) await preview(src, {}, {});
    else setPlan([]);
  }, [preview]);

  useEffect(() => {
    load();
  }, [load]);

  const planOf = useMemo(() => new Map(plan.map((p) => [p.item_id, p])), [plan]);
  const byGroup = useMemo(() => {
    const m = new Map<string, { name: string; rows: Row[] }>();
    for (const r of rows ?? []) {
      const name = r.whatsapp_group?.trim() || NO_GROUP;
      const k = name === NO_GROUP ? "" : groupKey(name);
      if (!m.has(k)) m.set(k, { name, rows: [] });
      m.get(k)!.rows.push(r);
    }
    return [...m.entries()];
  }, [rows]);
  const houses = projects.filter((p) => p.house_slug || p.house_group);
  const others = projects.filter((p) => !p.house_slug && !p.house_group);
  const counts = useMemo(() => {
    const live = (rows ?? []).filter((r) => !skipped[r.item_id]).map((r) => planOf.get(r.item_id));
    return {
      file: live.filter((p) => p && p.action !== "skip").length,
      need: live.filter(needsHouse).length,
      skip: (rows ?? []).length - live.length,
    };
  }, [rows, skipped, planOf]);

  async function setGroup(name: string, value: string) {
    setBusy(true);
    setErr(null);
    const { error } = await createClient().rpc("whatsapp_set_group", {
      p_group: name,
      p_project: value && value !== "mixed" ? value : null,
      p_mixed: value === "mixed",
    });
    setBusy(false);
    if (error) return setErr(error.message);
    const k = groupKey(name);
    const next = { ...(groups ?? {}) };
    if (!value) delete next[k];
    else next[k] = { group_key: k, group_name: name, project_id: value === "mixed" ? null : value, mixed: value === "mixed" };
    setGroups(next);
    if (rows?.length) await preview(rows, chosen, skipped);
  }

  async function pick(item: string, value: string) {
    const next = { ...chosen };
    if (value) next[item] = value;
    else delete next[item];
    setChosen(next);
    if (rows) await preview(rows, next, skipped);
  }

  async function toggleSkip(item: string) {
    const next = { ...skipped, [item]: !skipped[item] };
    setSkipped(next);
    if (rows) await preview(rows, chosen, next);
  }

  async function doImport() {
    if (!rows?.length) return;
    const res = await preview(rows, chosen, skipped, false);
    if (!res) return;
    const dismissed = rows.filter((r) => skipped[r.item_id]).map((r) => r.item_id);
    if (dismissed.length) {
      const { error } = await createClient().rpc("whatsapp_inbox_dismiss", { p_item_ids: dismissed });
      if (error) setErr(`Imported, but the skipped messages could not be dismissed: ${error.message}`);
    }
    const bugs = res.rows.filter((x) => x.action === "bug").length;
    const tasks = res.rows.filter((x) => x.action === "task").length;
    setMsg(`Filed ${bugs} bug${bugs === 1 ? "" : "s"} and ${tasks} task${tasks === 1 ? "" : "s"} in their houses' projects.`);
    setChosen({});
    setSkipped({});
    onDone();
    await load();
  }

  const projectOptions = (
    <>
      <optgroup label="Houses">
        {houses.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
            {o.platform ? ` · ${o.platform}` : ""}
          </option>
        ))}
      </optgroup>
      {others.length > 0 && (
        <optgroup label="Other projects">
          {others.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.platform ? ` · ${o.platform}` : ""}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <div className="w-full max-w-5xl rounded-sm border border-grid-line bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-grid-line px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">WhatsApp messages from Grok</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="space-y-4 p-4 text-[13px]">
          <p className="text-slate-600">
            Messages for known houses are filed as soon as Grok sends them. These are the ones still waiting. Give each
            WhatsApp group its house: it is remembered, so Grok&apos;s later messages from that group are filed there
            automatically (iOS messages go to the house&apos;s iOS project). Mark a group <b>mixed</b> when it covers
            several houses, and choose per message.
          </p>
          <GrokScanButton onDone={load} />
          {groups === null && rows !== null && (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-800">
              Group houses need migration 0050. Until it is applied you can still choose a house per message.
            </p>
          )}
          {err && <p className="rounded-md border border-red-200 bg-red-50 p-2 text-red-800">{err}</p>}
          {msg && <p className="rounded-md border border-brand-line bg-brand-soft p-2 text-brand-fg">{msg}</p>}

          {rows === null ? (
            <p className="text-slate-500">Loading Grok&apos;s messages…</p>
          ) : rows.length === 0 ? (
            <p className="text-slate-500">
              Nothing is waiting: every message Grok sent is filed or dismissed.{" "}
              <Link href="/import/whatsapp" className="text-blue-700 underline">
                Import from WhatsApp
              </Link>{" "}
              also takes Grok&apos;s sheet as a file.
            </p>
          ) : (
            byGroup.map(([k, g]) => {
              const set = k ? groups?.[k] : undefined;
              return (
                <section key={k || "none"} className="rounded-md border border-grid-line">
                  <div className="flex flex-wrap items-center gap-2 border-b border-grid-line bg-grid-head px-3 py-2">
                    <span className="font-medium text-slate-800">{g.name}</span>
                    <Badge>
                      {g.rows.length} message{g.rows.length === 1 ? "" : "s"}
                    </Badge>
                    {k && groups !== null && (
                      <label className="ml-auto flex items-center gap-2 text-[12px] text-slate-600">
                        House for this group
                        <select
                          value={set ? (set.mixed ? "mixed" : (set.project_id ?? "")) : ""}
                          disabled={busy}
                          onChange={(e) => setGroup(g.name, e.target.value)}
                          className={cx("cell-input min-w-[14rem]", !set && "text-amber-700")}
                        >
                          <option value="">Not set</option>
                          <option value="mixed">Mixed: choose per message</option>
                          {projectOptions}
                        </select>
                      </label>
                    )}
                  </div>
                  <table className="w-full text-left">
                    <tbody>
                      {g.rows.map((r) => {
                        const p = planOf.get(r.item_id);
                        const skip = !!skipped[r.item_id];
                        const canPick = !skip && p && (p.action !== "skip" || needsHouse(p) || p.how === "chosen");
                        return (
                          <tr key={r.item_id} className={cx("border-t border-grid-line align-top", skip && "text-slate-400")}>
                            <td className="w-16 px-3 py-2">
                              <Badge tone={r.type === "bug" ? "red" : "blue"}>{r.type || "—"}</Badge>
                            </td>
                            <td className="px-3 py-2">
                              <div className="font-medium text-slate-800">{r.title || "—"}</div>
                              <div className="text-[11px] text-slate-500">
                                {[r.app_name, r.house && r.house !== "unknown" ? `house ${r.house}` : null, r.platform, r.reporter, r.first_seen]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </div>
                            </td>
                            <td className="w-[19rem] px-3 py-2">
                              {canPick ? (
                                <select
                                  value={chosen[r.item_id] ?? ""}
                                  disabled={busy}
                                  onChange={(e) => pick(r.item_id, e.target.value)}
                                  className={cx("cell-input w-full", needsHouse(p) && "text-amber-700")}
                                >
                                  <option value="">
                                    {p?.project_name && p.action !== "skip"
                                      ? `${p.project_name} (${HOW[p.how ?? ""] ?? p.how})`
                                      : `Choose a house… (${p?.reason ?? "unclear"})`}
                                  </option>
                                  {projectOptions}
                                </select>
                              ) : (
                                <span className="text-[12px] text-slate-500">{skip ? "skipped" : (p?.reason ?? "…")}</span>
                              )}
                            </td>
                            <td className="w-20 px-3 py-2 text-right">
                              <label className="inline-flex items-center gap-1 text-[12px] text-slate-500">
                                <input type="checkbox" checked={skip} disabled={busy} onChange={() => toggleSkip(r.item_id)} />
                                Skip
                              </label>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>
              );
            })
          )}
        </div>

        {!!rows?.length && (
          <div className="flex flex-wrap items-center gap-3 border-t border-grid-line px-4 py-3 text-[13px]">
            <span className="text-slate-700">
              {counts.file} will be filed
              {counts.need > 0 && <span className="text-amber-700"> · {counts.need} still need a house (they keep waiting)</span>}
              {counts.skip > 0 && <span className="text-slate-500"> · {counts.skip} skipped (not offered again)</span>}
            </span>
            <span className="ml-auto flex gap-2">
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
              <Button onClick={doImport} disabled={busy || (counts.file === 0 && counts.skip === 0)}>
                {busy ? "Working…" : `Import ${counts.file}`}
              </Button>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
