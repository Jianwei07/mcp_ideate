import { describe, expect, test } from "bun:test";
import { isTrivialGreetingQuery } from "@secure-research/contracts";
import { validateCitations } from "../src/retrieval/citations.ts";
import { chunkPages, rankChunks } from "../src/retrieval/index.ts";

describe("secure retrieval", () => {
  const chunks = chunkPages([
    {
      pageId: "root",
      title: "Stanford CS230",
      url: "https://notion.example/root",
      blocks: [
        {
          blockId: "heading",
          blockType: "heading_2",
          text: "Monitoring signals",
          headingLevel: 2,
        },
        {
          blockId: "body",
          blockType: "paragraph",
          text: "Monitor data quality, loss, and model performance.",
          headingLevel: null,
        },
      ],
    },
  ]);

  test("ranks allowlisted evidence and assigns stable source ids", () => {
    const selected = rankChunks("What signals should teams monitor?", chunks);
    expect(selected).toHaveLength(1);
    expect(selected[0].sourceId).toBe("S1");
    expect(selected[0].headingPath).toEqual(["Monitoring signals"]);
  });

  test("prioritizes highest numbered lecture for latest lecture queries", () => {
    const selected = rankChunks(
      "tell me more about latest lecture",
      chunkPages([
        {
          pageId: "l06",
          title: "L06: AI Project Strategy",
          url: "https://notion.example/l06",
          blocks: [
            {
              blockId: "l06-body",
              blockType: "paragraph",
              text: "This lecture covers project strategy and data collection.",
              headingLevel: null,
            },
          ],
        },
        {
          pageId: "l10",
          title: "Lecture 10: What’s Going On Inside My Model?",
          url: "https://notion.example/l10",
          blocks: [
            {
              blockId: "l10-body",
              blockType: "paragraph",
              text: "Saliency maps and occlusion sensitivity explain model behavior.",
              headingLevel: null,
            },
          ],
        },
      ]),
    );

    expect(selected[0].pageTitle).toBe("Lecture 10: What’s Going On Inside My Model?");
  });

  test("requires claim-level citations from the selected evidence", () => {
    expect(
      validateCitations("Teams should monitor loss [S1].", [
        { ...chunks[0], sourceId: "S1" },
      ]).valid,
    ).toBeTrue();
    expect(
      validateCitations("Teams should monitor loss.", [
        { ...chunks[0], sourceId: "S1" },
      ]).valid,
    ).toBeFalse();
  });

  test("identifies trivial greetings without rejecting research questions", () => {
    expect(isTrivialGreetingQuery("hello")).toBeTrue();
    expect(isTrivialGreetingQuery("Thanks!")).toBeTrue();
    expect(
      isTrivialGreetingQuery("What is the disciplined process for ML projects?"),
    ).toBeFalse();
  });
});
