import assert from "node:assert/strict";
import test from "node:test";
import { channelFromSearch } from "../channel.ts";

test("only ?channel=preview selects preview", () => {
  for (const s of ["", "?channel=program", "?channel=Preview", "?role=preview"]) assert.equal(channelFromSearch(s), "program");
  assert.equal(channelFromSearch("?channel=preview&role=preview"), "preview");
});
