import { describe, it, expect } from "vitest";
import { MemoryStore } from "./memory-store.js";

describe("MemoryStore", () => {
  it("puts, gets, lists, deletes, and clears", async () => {
    const s = new MemoryStore();
    await s.put("t", "a", { v: 1 });
    await s.put("t", "b", { v: 2 });
    expect(await s.get("t", "a")).toEqual({ v: 1 });
    expect((await s.getAll<{ v: number }>("t")).map((x) => x.v).sort()).toEqual([1, 2]);
    await s.delete("t", "a");
    expect(await s.get("t", "a")).toBeUndefined();
    await s.clear("t");
    expect(await s.getAll("t")).toEqual([]);
  });

  it("isolates stored values from caller mutation (clone boundary)", async () => {
    const s = new MemoryStore();
    const obj = { nested: { n: 1 } };
    await s.put("t", "k", obj);
    obj.nested.n = 999; // mutate the caller's copy after storing
    expect((await s.get<typeof obj>("t", "k"))!.nested.n).toBe(1);

    const read = (await s.get<typeof obj>("t", "k"))!;
    read.nested.n = 42; // mutate a read copy
    expect((await s.get<typeof obj>("t", "k"))!.nested.n).toBe(1); // store still intact
  });
});
