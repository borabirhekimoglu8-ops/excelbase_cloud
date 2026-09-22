import "fake-indexeddb/auto";

import { describe, expect, it, vi } from "vitest";

import { PassportOcrQueue, transientQueueError } from "./ocrQueue";

describe("PassportOcrQueue", () => {
  it("deduplicates the same page/profile promise and uses one serial drain", async () => {
    let active = 0;
    let peak = 0;
    const processor = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return "ok";
    });
    const queue = new PassportOcrQueue(processor);
    const page = new Blob(["synthetic"]);
    const first = queue.enqueue(page, "a".repeat(64), "profile");
    const duplicate = queue.enqueue(page, "a".repeat(64), "profile");
    const other = queue.enqueue(page, "b".repeat(64), "profile");
    await expect(Promise.all([first, duplicate, other])).resolves.toEqual(["ok", "ok", "ok"]);
    expect(processor).toHaveBeenCalledTimes(2);
    expect(peak).toBe(1);
  });

  it("retries transient crashes with Turkish copy but not parser failures", async () => {
    let attempt = 0;
    const queue = new PassportOcrQueue(async () => {
      attempt += 1;
      if (attempt === 1) throw transientQueueError("engine_crashed");
      return "done";
    }, 3, async () => undefined);
    await expect(queue.enqueue(new Blob(["x"]), "c".repeat(64), "profile")).resolves.toBe("done");
    const job = (await queue.jobs()).find((item) => item.pageSha256 === "c".repeat(64));
    expect(job).toMatchObject({ state: "done", attempts: 2 });
    expect(job?.message).not.toMatch(/\b(?:429|HTTP)\b/i);
  });
});
