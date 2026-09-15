import { describe, expect, it } from "vitest";

import { albumGridColumns } from "./album-grid-columns";

describe("albumGridColumns", () => {
  it.each([
    [0, 1],
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 2],
    [5, 3],
    [6, 3],
    [7, 2],
    [8, 2],
    [9, 3],
    [10, 2],
    [11, 3],
    [12, 3],
    [13, 2],
    [14, 2],
  ])("%i 枚のとき %i 列", (count, expected) => {
    expect(albumGridColumns(count)).toBe(expected);
  });
});
