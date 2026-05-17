/* ------------------------------------------------------------------
   Inline replacement for the `diff` npm package (v7.0.0).
   Replicates createTwoFilesPatch with byte-for-byte identical output
   for the call signature used by DiffView:
     createTwoFilesPatch(path, path, before, after, "", "", { context: 2 })
   ------------------------------------------------------------------ */

/* ---------- tokenize (line.js) ---------- */
function tokenize(value: string, options: { stripTrailingCr?: boolean; newlineIsToken?: boolean } = {}): string[] {
  if (options.stripTrailingCr) {
    value = value.replace(/\r\n/g, "\n");
  }
  const retLines: string[] = [];
  const linesAndNewlines = value.split(/(\n|\r\n)/);
  // If the last element is empty, pop it (matches jsdiff behaviour)
  if (!linesAndNewlines[linesAndNewlines.length - 1]) {
    linesAndNewlines.pop();
  }
  for (let i = 0; i < linesAndNewlines.length; i++) {
    const line = linesAndNewlines[i]!;
    if (i % 2 && !options.newlineIsToken) {
      retLines[retLines.length - 1]! += line;
    } else {
      retLines.push(line);
    }
  }
  return retLines;
}

/* ---------- removeEmpty (base.js) ---------- */
function removeEmpty(array: string[]): string[] {
  const ret: string[] = [];
  for (let i = 0; i < array.length; i++) {
    if (array[i]) {
      ret.push(array[i]!);
    }
  }
  return ret;
}

/* ---------- diffLines (base.js Myers algorithm) ---------- */
interface DiffComponent {
  count: number;
  added?: boolean;
  removed?: boolean;
  value?: string;
  previousComponent?: DiffComponent;
}

interface Path {
  oldPos: number;
  lastComponent?: DiffComponent;
}

function diffLines(
  oldStr: string,
  newStr: string,
  options: { maxEditLength?: number; timeout?: number } = {},
): Array<{ value: string; added?: boolean; removed?: boolean; count?: number }> {
  const oldTokens = removeEmpty(tokenize(oldStr));
  const newTokens = removeEmpty(tokenize(newStr));

  const newLen = newTokens.length;
  const oldLen = oldTokens.length;
  let editLength = 1;
  let maxEditLength = newLen + oldLen;
  if (options.maxEditLength != null) {
    maxEditLength = Math.min(maxEditLength, options.maxEditLength);
  }
  const maxExecutionTime = options.timeout ?? Infinity;
  const abortAfterTimestamp = Date.now() + maxExecutionTime;

  const bestPath: (Path | undefined)[] = [{ oldPos: -1, lastComponent: undefined }];

  let newPos = extractCommon(bestPath[0]!, newTokens, oldTokens, 0);
  if (bestPath[0]!.oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
    return buildValues(bestPath[0]!.lastComponent, newTokens, oldTokens);
  }

  let minDiagonalToConsider = -Infinity;
  let maxDiagonalToConsider = Infinity;

  while (editLength <= maxEditLength && Date.now() <= abortAfterTimestamp) {
    for (
      let diagonalPath = Math.max(minDiagonalToConsider, -editLength);
      diagonalPath <= Math.min(maxDiagonalToConsider, editLength);
      diagonalPath += 2
    ) {
      let basePath: Path;
      const removePath = bestPath[diagonalPath - 1];
      const addPath = bestPath[diagonalPath + 1];
      if (removePath) {
        bestPath[diagonalPath - 1] = undefined;
      }
      let canAdd = false;
      if (addPath) {
        const addPathNewPos = addPath.oldPos - diagonalPath;
        canAdd = 0 <= addPathNewPos && addPathNewPos < newLen;
      }
      const canRemove = removePath && removePath.oldPos + 1 < oldLen;
      if (!canAdd && !canRemove) {
        bestPath[diagonalPath] = undefined;
        continue;
      }
      // Tie-breaker: prefer addPath when oldPos is smaller (matches jsdiff)
      if (!canRemove || (canAdd && removePath!.oldPos < addPath!.oldPos)) {
        basePath = addToPath(addPath!, true, false, 0);
      } else {
        basePath = addToPath(removePath!, false, true, 1);
      }
      newPos = extractCommon(basePath, newTokens, oldTokens, diagonalPath);
      if (basePath.oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
        return buildValues(basePath.lastComponent, newTokens, oldTokens);
      }
      bestPath[diagonalPath] = basePath;
      if (basePath.oldPos + 1 >= oldLen) {
        maxDiagonalToConsider = Math.min(maxDiagonalToConsider, diagonalPath - 1);
      }
      if (newPos + 1 >= newLen) {
        minDiagonalToConsider = Math.max(minDiagonalToConsider, diagonalPath + 1);
      }
    }
    editLength++;
  }

  return [];
}

function addToPath(path: Path, added: boolean, removed: boolean, oldPosInc: number): Path {
  const last = path.lastComponent;
  if (last && last.added === added && last.removed === removed) {
    return {
      oldPos: path.oldPos + oldPosInc,
      lastComponent: {
        count: last.count + 1,
        added,
        removed,
        previousComponent: last.previousComponent,
      },
    };
  } else {
    return {
      oldPos: path.oldPos + oldPosInc,
      lastComponent: {
        count: 1,
        added,
        removed,
        previousComponent: last,
      },
    };
  }
}

function extractCommon(basePath: Path, newTokens: string[], oldTokens: string[], diagonalPath: number): number {
  const newLen = newTokens.length;
  const oldLen = oldTokens.length;
  let oldPos = basePath.oldPos;
  let newPos = oldPos - diagonalPath;
  let commonCount = 0;
  while (newPos + 1 < newLen && oldPos + 1 < oldLen && oldTokens[oldPos + 1] === newTokens[newPos + 1]) {
    newPos++;
    oldPos++;
    commonCount++;
  }
  if (commonCount) {
    basePath.lastComponent = {
      count: commonCount,
      previousComponent: basePath.lastComponent,
      added: false,
      removed: false,
    };
  }
  basePath.oldPos = oldPos;
  return newPos;
}

function buildValues(
  lastComponent: DiffComponent | undefined,
  newTokens: string[],
  oldTokens: string[],
): Array<{ value: string; added?: boolean; removed?: boolean }> {
  const components: DiffComponent[] = [];
  let nextComponent: DiffComponent | undefined;
  while (lastComponent) {
    components.push(lastComponent);
    nextComponent = lastComponent.previousComponent;
    delete lastComponent.previousComponent;
    lastComponent = nextComponent;
  }
  components.reverse();

  const result: Array<{ value: string; added?: boolean; removed?: boolean }> = [];
  let newPos = 0;
  let oldPos = 0;
  for (const component of components) {
    if (!component.removed) {
      component.value = newTokens.slice(newPos, newPos + component.count).join("");
      newPos += component.count;
      if (!component.added) {
        oldPos += component.count;
      }
    } else {
      component.value = oldTokens.slice(oldPos, oldPos + component.count).join("");
      oldPos += component.count;
    }
    result.push({ value: component.value!, added: component.added, removed: component.removed });
  }
  return result;
}

/* ---------- splitLines (create.js) ---------- */
function splitLines(text: string): string[] {
  const hasTrailingNl = text.endsWith("\n");
  const result = text.split("\n").map((line) => line + "\n");
  if (hasTrailingNl) {
    result.pop();
  } else {
    const last = result.pop();
    if (last !== undefined) {
      result.push(last.slice(0, -1));
    }
  }
  return result;
}

/* ---------- structuredPatch (create.js) ---------- */
interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

interface StructuredPatchResult {
  oldFileName: string;
  newFileName: string;
  oldHeader: string;
  newHeader: string;
  hunks: Hunk[];
}

function structuredPatch(
  oldFileName: string,
  newFileName: string,
  oldStr: string,
  newStr: string,
  oldHeader: string,
  newHeader: string,
  options?: { context?: number },
): StructuredPatchResult | undefined {
  const optionsObj = options ?? {};
  if (typeof optionsObj.context === "undefined") {
    optionsObj.context = 4;
  }
  const context = optionsObj.context;

  const diff = diffLines(oldStr, newStr);
  return diffLinesResultToPatch(diff);

  function diffLinesResultToPatch(
    diffResult: Array<{ value: string; added?: boolean; removed?: boolean }>,
  ): StructuredPatchResult | undefined {
    if (!diffResult) {
      return undefined;
    }
    diffResult.push({ value: "", lines: [] as string[] } as any);

    function contextLines(lines: string[]): string[] {
      return lines.map((entry) => " " + entry);
    }

    const hunks: Hunk[] = [];
    let oldRangeStart = 0;
    let newRangeStart = 0;
    let curRange: string[] = [];
    let oldLine = 1;
    let newLine = 1;

    for (let i = 0; i < diffResult.length; i++) {
      const current = diffResult[i]!;
      const lines = (current as any).lines || splitLines(current.value!);
      (current as any).lines = lines;

      if (current.added || current.removed) {
        if (!oldRangeStart) {
          const prev = diffResult[i - 1];
          oldRangeStart = oldLine;
          newRangeStart = newLine;
          if (prev) {
            curRange = context > 0 ? contextLines((prev as any).lines.slice(-context)) : [];
            oldRangeStart -= curRange.length;
            newRangeStart -= curRange.length;
          }
        }
        for (const line of lines) {
          curRange.push((current.added ? "+" : "-") + line);
        }
        if (current.added) {
          newLine += lines.length;
        } else {
          oldLine += lines.length;
        }
      } else {
        if (oldRangeStart) {
          if (lines.length <= context * 2 && i < diffResult.length - 2) {
            for (const line of contextLines(lines)) {
              curRange.push(line);
            }
          } else {
            const contextSize = Math.min(lines.length, context);
            for (const line of contextLines(lines.slice(0, contextSize))) {
              curRange.push(line);
            }
            const hunk: Hunk = {
              oldStart: oldRangeStart,
              oldLines: oldLine - oldRangeStart + contextSize,
              newStart: newRangeStart,
              newLines: newLine - newRangeStart + contextSize,
              lines: curRange,
            };
            hunks.push(hunk);
            oldRangeStart = 0;
            newRangeStart = 0;
            curRange = [];
          }
        }
        oldLine += lines.length;
        newLine += lines.length;
      }
    }

    for (const hunk of hunks) {
      for (let i = 0; i < hunk.lines.length; i++) {
        if (hunk.lines[i]!.endsWith("\n")) {
          hunk.lines[i] = hunk.lines[i]!.slice(0, -1);
        } else {
          hunk.lines.splice(i + 1, 0, "\\ No newline at end of file");
          i++;
        }
      }
    }

    return {
      oldFileName,
      newFileName,
      oldHeader,
      newHeader,
      hunks,
    };
  }
}

/* ---------- formatPatch (create.js) ---------- */
function formatPatch(patch: StructuredPatchResult): string {
  const ret: string[] = [];
  ret.push("Index: " + patch.oldFileName);
  ret.push("===================================================================");
  ret.push("--- " + patch.oldFileName + (typeof patch.oldHeader === "undefined" ? "" : "\t" + patch.oldHeader));
  ret.push("+++ " + patch.newFileName + (typeof patch.newHeader === "undefined" ? "" : "\t" + patch.newHeader));

  for (let i = 0; i < patch.hunks.length; i++) {
    const hunk = patch.hunks[i]!;
    const oldStart = hunk.oldLines === 0 ? hunk.oldStart - 1 : hunk.oldStart;
    const newStart = hunk.newLines === 0 ? hunk.newStart - 1 : hunk.newStart;
    ret.push("@@ -" + oldStart + "," + hunk.oldLines + " +" + newStart + "," + hunk.newLines + " @@");
    for (const line of hunk.lines) {
      ret.push(line);
    }
  }

  return ret.join("\n") + "\n";
}

/* ---------- createTwoFilesPatch (create.js) ---------- */
export function createTwoFilesPatch(
  oldFileName: string,
  newFileName: string,
  oldStr: string,
  newStr: string,
  oldHeader: string,
  newHeader: string,
  options?: { context?: number },
): string {
  const patchObj = structuredPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options);
  if (!patchObj) {
    return "";
  }
  return formatPatch(patchObj);
}
