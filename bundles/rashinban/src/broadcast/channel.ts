export type Channel = "program" | "preview";

/** Pages render program unless opened with ?channel=preview (switcher monitors). */
export function channelFromSearch(search: string): Channel {
  return new URLSearchParams(search).get("channel") === "preview" ? "preview" : "program";
}
