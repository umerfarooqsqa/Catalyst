import { SKILL_LABELS, isBugArea, skillsOf } from "@/lib/bug-area";
import type { MemberOption } from "@/lib/types/models";

/**
 * <option>s for a bug's assignee picker: people with the bug's area as a skill
 * (profiles.skills, migration 0042) first, then everyone else. With no area, or
 * nobody with that skill, a plain list.
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
  const option = (m: MemberOption) => (
    <option key={m.id} value={m.id}>
      {m.full_name}
      {withRole && m.roles?.label ? ` · ${m.roles.label}` : ""}
    </option>
  );
  const skilled = isBugArea(area) ? people.filter((m) => skillsOf(m.skills).includes(area)) : [];
  if (!isBugArea(area) || !skilled.length) return <>{people.map(option)}</>;
  const rest = people.filter((m) => !skilled.includes(m));
  return (
    <>
      <optgroup label={`${SKILL_LABELS[area]} skill`}>{skilled.map(option)}</optgroup>
      {rest.length > 0 && <optgroup label="Everyone else">{rest.map(option)}</optgroup>}
    </>
  );
}
