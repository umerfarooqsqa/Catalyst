"use client";

import { useRoleCategories } from "@/components/RoleCategories";
import { categoryOf, skillsOf } from "@/lib/bug-area";
import type { MemberOption } from "@/lib/types/models";

/**
 * <option>s for an assignee picker: people with the item's role category as a skill
 * (profiles.skills) first, then everyone else. With no category, or nobody in it, a
 * plain list.
 */
export default function AssigneeOptions({
  people,
  area,
  withRole = false,
}: {
  people: MemberOption[];
  area: string | null | undefined;
  withRole?: boolean;
}) {
  const cat = categoryOf(useRoleCategories(), area);
  const option = (m: MemberOption) => (
    <option key={m.id} value={m.id}>
      {m.full_name}
      {withRole && m.roles?.label ? ` · ${m.roles.label}` : ""}
    </option>
  );
  const skilled = cat ? people.filter((m) => skillsOf(m.skills).includes(cat.key)) : [];
  if (!cat || !skilled.length) return <>{people.map(option)}</>;
  const rest = people.filter((m) => !skilled.includes(m));
  return (
    <>
      <optgroup label={`${cat.short_label}`}>{skilled.map(option)}</optgroup>
      {rest.length > 0 && <optgroup label="Everyone else">{rest.map(option)}</optgroup>}
    </>
  );
}
