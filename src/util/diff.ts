/**
 * Stand-in for the `diff` npm package's `createTwoFilesPatch`.
 *
 * Re-implements the exact line-diff → unified-patch pipeline used by jsdiff
 * so that the `diff` dependency can be removed from the bundle.
 */

/* ------------------------------------------------------------------ */
/* 1.  Tokenisation (line.js)                                         */
/* ------------------------------------------------------------------ */

function tokenize(value: string): string[] {
  const retLines: string[] = [];
  const linesAndNewlines = value.split(/(\n|\r\n)/);
  // Ignore the final empty token that occurs if the string ends with a new line
  const last = linesAndNewlines.at(-1);
  if (last !== undefined && !last) {
    linesAndNewlines.pop();
  }
  // Merge the content and line separators into single tokens
  for (let i = 0; i < linesAndNewlines.length; i++) {
    const line = linesAndNewlines[i]!;
    if (i % 2) {
      retLines[retLines.length - 1]! += line;
    } else {
      retLines.push(line);
    }
  }
  return retLines;
}

function removeEmpty(array: string[]): string[] {
  const ret: string[] = [];
  for (let i = 0; i < array.length; i++) {
    const item = array[i]!;
    if (item) {
      ret.push(item);
    }
  }
  return ret;
}

/* ------------------------------------------------------------------ */
/* 2.  Myers diff (base.js)                                           */
/* ------------------------------------------------------------------ */

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

function diffLines(oldStr: string, newStr: string): Array<{ value: string; added?: boolean; removed?: boolean }> {
  const oldTokens = removeEmpty(tokenize(oldStr));
  const newTokens = removeEmpty(tokenize(newStr));

  const newLen = newTokens.length;
  const oldLen = oldTokens.length;
  let editLength = 1;
  const maxEditLength = newLen + oldLen;
  const abortAfterTimestamp = Infinity;

  const bestPath: (Path | undefined)[] = [{ oldPos: -1, lastComponent: undefined }];

  let newPos = extractCommon(bestPath[0]!, newTokens, oldTokens, 0);
  if (bestPath[0]!.oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
    return buildValues(bestPath[0]!.lastComponent, newTokens, oldTokens);
  }

  let minDiagonalToConsider = -Infinity;
  let maxDiagonalToConsider = Infinity;

  while (editLength <= maxEditLength && Date.now() <= abortAfterTimestamp) {
    for (let diagonalPath = Math.max(minDiagonalToConsider, -editLength); diagonalPath <= Math.min(maxDiagonalToConsider, editLength); diagonalPath += 2) {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (lastComponent as any).previousComponent;
    lastComponent = nextComponent;
  }
  components.reverse();

  const result: Array<{ value: string; added?: boolean; removed?: boolean }> = [];
  let newPos = 0;
  let oldPos = 0;
  for (const component of components) {
    if (!component.removed) {
      component.value = newTokens.slice(newPos, newPos + component.count).join('');
      newPos += component.count;
      if (!component.added) {
        oldPos += component.count;
      }
    } else {
      component.value = oldTokens.slice(oldPos, oldPos + component.count).join('');
      oldPos += component.count;
    }
    result.push({
      value: component.value,
      added: component.added,
      removed: component.removed,
    });
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* 3.  Patch creation (patch/create.js)                               */
/* ------------------------------------------------------------------ */

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

function splitLines(text: string): string[] {
  const hasTrailingNl = text.endsWith('\n');
  const result = text.split('\n').map((line) => line + '\n');
  if (hasTrailingNl) {
    result.pop();
  } else {
    result.push(result.pop()!.slice(0, -1));
  }
  return result;
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
  if (typeof optionsObj.context === 'undefined') {
    optionsObj.context = 4;
  }
  const context = optionsObj.context;

  const diff = diffLines(oldStr, newStr);
  return diffLinesResultToPatch(diff);

  function diffLinesResultToPatch(
    diff: Array<{ value: string; added?: boolean; removed?: boolean }>,
  ): StructuredPatchResult | undefined {
    if (!diff) {
      return undefined;
    }
    diff.push({ value: '', lines: [] as string[] } as unknown as { value: string; added?: boolean; removed?: boolean });

    function contextLines(lines: string[]): string[] {
      return lines.map((entry) => ' ' + entry);
    }

    const hunks: Hunk[] = [];
    let oldRangeStart = 0;
    let newRangeStart = 0;
    let curRange: string[] = [];
    let oldLine = 1;
    let newLine = 1;

    for (let i = 0; i < diff.length; i++) {
      const current = diff[i]!;
      const lines = (current as unknown as { lines?: string[] }).lines || splitLines(current.value);
      (current as unknown as { lines: string[] }).lines = lines;

      if (current.added || current.removed) {
        if (!oldRangeStart) {
          const prev = diff[i - 1];
          oldRangeStart = oldLine;
          newRangeStart = newLine;
          if (prev) {
            curRange = context > 0 ? contextLines((prev as unknown as { lines: string[] }).lines.slice(-context)) : [];
            oldRangeStart -= curRange.length;
            newRangeStart -= curRange.length;
          }
        }
        for (const line of lines) {
          curRange.push((current.added ? '+' : '-') + line);
        }
        if (current.added) {
          newLine += lines.length;
        } else {
          oldLine += lines.length;
        }
      } else {
        if (oldRangeStart) {
          if (lines.length <= context * 2 && i < diff.length - 2) {
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
        const line = hunk.lines[i]!;
        if (line.endsWith('\n')) {
          hunk.lines[i] = line.slice(0, -1);
        } else {
          hunk.lines.splice(i + 1, 0, '\\ No newline at end of file');
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

/* ------------------------------------------------------------------ */
/* 4.  Formatting (patch/create.js)                                   */
/* ------------------------------------------------------------------ */

function needsQuoting(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s[i]! < '\x20' || s[i]! > '\x7e' || s[i]! === '"' || s[i]! === '\\') {
      return true;
    }
  }
  return false;
}

function quoteFileNameIfNeeded(s: string): string {
  if (!needsQuoting(s)) {
    return s;
  }
  let result = '"';
  const bytes = new TextEncoder().encode(s);
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i]!;
    if (b === 0x07) {
      result += '\\a';
    } else if (b === 0x08) {
      result += '\\b';
    } else if (b === 0x09) {
      result += '\\t';
    } else if (b === 0x0a) {
      result += '\\n';
    } else if (b === 0x0b) {
      result += '\\v';
    } else if (b === 0x0c) {
      result += '\\f';
    } else if (b === 0x0d) {
      result += '\\r';
    } else if (b === 0x22) {
      result += '\\"';
    } else if (b === 0x5c) {
      result += '\\\\';
    } else if (b >= 0x20 && b <= 0x7e) {
      result += String.fromCharCode(b);
    } else {
      result += '\\' + b.toString(8).padStart(3, '0');
    }
    i++;
  }
  result += '"';
  return result;
}

function formatPatch(patch: StructuredPatchResult): string {
  const ret: string[] = [];
  if (patch.oldFileName == patch.newFileName && patch.oldFileName !== undefined) {
    ret.push('Index: ' + patch.oldFileName);
  }
  ret.push('===================================================================');
  ret.push('--- ' + quoteFileNameIfNeeded(patch.oldFileName) + (patch.oldHeader ? '\t' + patch.oldHeader : ''));
  ret.push('+++ ' + quoteFileNameIfNeeded(patch.newFileName) + (patch.newHeader ? '\t' + patch.newHeader : ''));

  for (let i = 0; i < patch.hunks.length; i++) {
    const hunk = patch.hunks[i]!;
    const oldStart = hunk.oldLines === 0 ? hunk.oldStart - 1 : hunk.oldStart;
    const newStart = hunk.newLines === 0 ? hunk.newStart - 1 : hunk.newStart;
    ret.push('@@ -' + oldStart + ',' + hunk.oldLines + ' +' + newStart + ',' + hunk.newLines + ' @@');
    for (const line of hunk.lines) {
      ret.push(line);
    }
  }

  return ret.join('\n') + '\n';
}

/* ------------------------------------------------------------------ */
/* 5.  Public API                                                     */
/* ------------------------------------------------------------------ */

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
    return '';
  }
  return formatPatch(patchObj);
}
