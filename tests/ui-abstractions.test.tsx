import { describe, it } from "node:test";
import assert from "node:assert";
import React from "react";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { renderToString } from "../scripts/tdd-harness.js";
import { ThemeProvider } from "../src/ui/theme-context.js";
import { resolveTheme } from "../src/ui/theme.js";
import { toThemeView } from "../src/ui/theme-view.js";
import { Frame, assertRoundedBorders } from "../src/ui/frame.js";
import { FilledItem } from "../src/ui/select-item.js";

const testTheme = resolveTheme("everforest-dark");

function withTheme(node: React.ReactElement): React.ReactElement {
	return <ThemeProvider theme={testTheme}>{node}</ThemeProvider>;
}

describe("Frame", () => {
	it("renders with rounded borders", () => {
		const text = renderToString(
			withTheme(
				<Frame title="Test">
					<Text>content</Text>
				</Frame>,
			),
		);
		assertRoundedBorders(text);
	});

	it("rejects sharp corners", () => {
		assert.throws(() => assertRoundedBorders("┌─┐\n│x│\n└─┘"), /expected top-left corner|sharp corner/);
	});
});

describe("ThemeView", () => {
	it("maps semantic tokens from palette", () => {
		const view = toThemeView(testTheme);
		assert.strictEqual(view.selectedBg, testTheme.accent ?? testTheme.palette.primary);
		assert.strictEqual(view.onSelected, testTheme.palette.background ?? testTheme.palette.foreground);
		assert.strictEqual(view.surface, testTheme.palette.foreground);
	});

	it("fills missing tokens with defaults", () => {
		const minimal = resolveTheme("catppuccin-mocha");
		const view = toThemeView(minimal);
		assert.ok(view.selectedBg);
		assert.ok(view.onSelected);
		assert.ok(view.borderSubtle);
	});
});

describe("FilledItem", () => {
	it("renders label", () => {
		const { lastFrame } = render(
			withTheme(<FilledItem label="Pick me" />),
		);
		assert.ok(lastFrame()!.includes("Pick me"));
	});

	it("selected state uses theme colors", () => {
		const { lastFrame } = render(
			withTheme(<FilledItem isSelected={true} label="Pick me" />),
		);
		const frame = lastFrame()!;
		assert.ok(frame.includes("Pick me"));
	});
});
