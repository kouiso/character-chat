import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const gateMarkdown = readFileSync("doc/adult-ready-gate.md", "utf8");

const requiredPhrases = [
  "30-second BLUF",
  "Zero User Burden Rule",
  "Character selection works",
  "New chat starts correctly",
  "Chat history resume works",
  "Image display is correct, no black image",
  "10-turn conversation quality passes",
  "No refusal or regulatory boilerplate",
  "No repetitive phrasing",
  "Persona adherence remains stable",
  "Multi-Angle Gate",
  "Security/privacy",
  "Performance",
  "UX",
  "Maintainability",
  "Backward compatibility",
  "Operations",
  "Rollback",
  "Monitoring",
  "Premortem",
  "API compatibility",
  "Environment drift",
  "Race condition",
  "Security hole",
  "#306",
  "#307",
  "#265",
  "#276",
];

describe("adult ready gate", () => {
  it("documents all daily-use, review, and evidence requirements", () => {
    for (const phrase of requiredPhrases) {
      expect(gateMarkdown).toContain(phrase);
    }
  });

  it("requires every daily-use checklist item and every multi-angle review axis", () => {
    const checklistCount = (gateMarkdown.match(/^- \[ ] /gm) ?? []).length;
    expect(checklistCount).toBeGreaterThanOrEqual(9);

    const multiAngleRows = (
      gateMarkdown.match(
        /^\| (Implementation|Security\/privacy|Performance|UX|Maintainability|Backward compatibility|Test|Operations|Rollback|Monitoring) \|/gm,
      ) ?? []
    ).length;
    expect(multiAngleRows).toBe(10);
  });
});
