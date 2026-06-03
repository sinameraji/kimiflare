import { execSync } from "node:child_process";
import { platform } from "node:os";

export interface ClipboardResult {
  success: boolean;
  message: string;
}

export function writeToClipboard(text: string): ClipboardResult {
  const os = platform();
  try {
    if (os === "darwin") {
      execSync("pbcopy", { input: text, timeout: 5000 });
      return { success: true, message: "Copied to clipboard" };
    }
    if (os === "win32") {
      execSync("clip", { input: text, timeout: 5000 });
      return { success: true, message: "Copied to clipboard" };
    }
    // Linux — try xclip first, then xsel
    try {
      execSync("xclip -selection clipboard", { input: text, timeout: 5000 });
      return { success: true, message: "Copied to clipboard" };
    } catch {
      execSync("xsel --clipboard --input", { input: text, timeout: 5000 });
      return { success: true, message: "Copied to clipboard" };
    }
  } catch {
    return {
      success: false,
      message: "Clipboard not available — plan will be shown below",
    };
  }
}
