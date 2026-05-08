import { describe, it } from "node:test";
import assert from "node:assert";
import React from "react";
import { Box, Text } from "ink";
import {
  renderToString,
  lineCount,
  assertMaxLineWidth,
  assertLineCount,
  SmokeComponent,
} from "../scripts/tdd-harness.js";
import { ThemeProvider } from "../src/ui/theme-context.js";
import { resolveTheme } from "../src/ui/theme.js";
import { Welcome } from "../src/ui/welcome.js";
import { ChatView } from "../src/ui/chat.js";
import { StatusBar } from "../src/ui/status.js";
import { PermissionModal } from "../src/ui/permission.js";
import { assertRoundedBorders } from "../src/ui/frame.js";
import type { ToolSpec } from "../src/tools/registry.js";

const testTheme = resolveTheme("everforest-dark");

function withTheme(node: React.ReactElement): React.ReactElement {
  return <ThemeProvider theme={testTheme}>{node}</ThemeProvider>;
}

describe("U1: TDD harness smoke", () => {
  it("renders a simple component to plain text", () => {
    const text = renderToString(<SmokeComponent />);
    assert.ok(text.includes("hello"));
    assert.ok(text.includes("world"));
    assert.strictEqual(lineCount(text), 2);
  });

  it("respects custom column width", () => {
    const text = renderToString(
      <Box width={60}>
        <Text>{"x".repeat(100)}</Text>
      </Box>,
      { columns: 60 },
    );
    assertMaxLineWidth(text, 60);
  });
});

describe("R1: rounded borders only", () => {
  it("permission modal uses rounded corners exclusively", () => {
    const tool: ToolSpec = { name: "read_file", description: "", parameters: {} };
    const text = renderToString(
      withTheme(<PermissionModal tool={tool} args={{}} onDecide={() => {}} />),
    );
    assertRoundedBorders(text);
  });
});

describe("R2: status bar is exactly one line", () => {
  it("renders in 1 line at 80 cols", () => {
    const text = renderToString(
      withTheme(
        <StatusBar
          usage={null}
          thinking={false}
          turnStartedAt={null}
          mode="edit"
          contextLimit={128000}
        />,
      ),
      { columns: 80 },
    );
    assertLineCount(text, 1, `status bar should be 1 line, got ${lineCount(text)}:\n${text}`);
  });

  it("renders in 1 line at 60 cols", () => {
    const text = renderToString(
      withTheme(
        <StatusBar
          usage={null}
          thinking={false}
          turnStartedAt={null}
          mode="edit"
          contextLimit={128000}
        />,
      ),
      { columns: 60 },
    );
    assertLineCount(text, 1, `status bar should be 1 line at 60 cols, got ${lineCount(text)}:\n${text}`);
  });
});

describe("R3: overlays are centered, not full-screen", () => {
  it.todo("help overlay is centered and does not fill the terminal");
  it.todo("command palette is centered and does not fill the terminal");
});

describe("R4: welcome screen is minimal", () => {
  it("has no ASCII art characters", () => {
    const text = renderToString(withTheme(<Welcome />));
    const asciiArtChars = ["█", "▄", "▀", "▌", "▐", "░", "▒", "▓"];
    for (const ch of asciiArtChars) {
      assert.ok(!text.includes(ch), `welcome contained ASCII art char "${ch}"`);
    }
  });

  it("has no box-drawing borders", () => {
    const text = renderToString(withTheme(<Welcome />));
    const borderChars = ["┌", "┐", "└", "┘", "╭", "╮", "╰", "╯", "─", "│"];
    for (const ch of borderChars) {
      assert.ok(!text.includes(ch), `welcome contained border char "${ch}"`);
    }
  });
});

describe("R5: chat messages breathe, no borders", () => {
  it("chat view has no box-drawing borders around messages", () => {
    const events = [
      { kind: "user" as const, text: "hello" },
      { kind: "assistant" as const, text: "world" },
    ];
    const text = renderToString(
      withTheme(<ChatView events={events} showReasoning={false} verbose={false} />),
    );
    assert.ok(text.includes("hello"));
    assert.ok(text.includes("world"));
  });
});

describe("R6: graceful widths 60–120", () => {
  for (const cols of [60, 80, 120]) {
    it(`welcome fits at ${cols} cols`, () => {
      const text = renderToString(
        withTheme(<Welcome />),
        { columns: cols },
      );
      assertMaxLineWidth(text, cols);
    });

    it(`status bar fits at ${cols} cols`, () => {
      const text = renderToString(
        withTheme(
          <StatusBar
            usage={null}
            thinking={false}
            turnStartedAt={null}
            mode="edit"
            contextLimit={128000}
          />,
        ),
        { columns: cols },
      );
      assertMaxLineWidth(text, cols);
    });
  }
});
