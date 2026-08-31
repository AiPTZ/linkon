export interface PersonalizeContext {
  name?: string | null;
  headline?: string | null;
  profileUrl?: string | null;
}

export function applyPlaceholders(text: string, lead: PersonalizeContext): string {
  return text
    .replaceAll("{nome}", lead.name ?? "")
    .replaceAll("{cargo}", lead.headline ?? "")
    .replaceAll("{link}", lead.profileUrl ?? "");
}
