/// mtcute uses Bot-API style "marked" ids: channels/supergroups are
/// -100xxxxxxxxxx, legacy groups are small negatives, users positive.
export function isChannelId(id: number): boolean {
  return id < -1_000_000_000_000;
}
