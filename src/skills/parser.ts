import matter from "gray-matter";
import type { ParsedSkill, ParsedSkillSection } from "./types.js";
import { createHash } from "node:crypto";

export const PARSER_VERSION = 1;

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function computeContentHash(rawText: string, parserVersion: number): string {
  return sha256(`${rawText}\n<!-- parser_version: ${parserVersion} -->`);
}

/**
 * Extract the first sentence from a block of text.
 * If the first non-empty line doesn't look like a complete sentence
 * (starts with code block, list, or is very short), fall back to the heading.
 */
function extractDescription(body: string, heading: string): string {
  const lines = body.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return heading;

  const first = lines[0]!;
  // If it starts with a code fence, list marker, or is very short, use heading
  if (
    first.startsWith("```") ||
    first.startsWith("-") ||
    first.startsWith("*") ||
    first.startsWith("#") ||
    first.match(/^\d+\./) ||
    first.length < 20
  ) {
    return heading;
  }

  // Take first sentence (up to first period followed by space or end of line)
  const sentenceMatch = first.match(/^(.+?[.!?])(?:\s|$)/);
  if (sentenceMatch) {
    return sentenceMatch[1]!;
  }

  return first.length <= 120 ? first : heading;
}

/**
 * Split markdown body into ## sections.
 * Returns an array of { heading, body } objects.
 * Content before the first ## is treated as a section with heading "".
 */
function splitIntoSections(markdown: string): ParsedSkillSection[] {
  const lines = markdown.split("\n");
  const sections: ParsedSkillSection[] = [];
  let currentHeading = "";
  let currentBody: string[] = [];

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.*)$/);
    if (h2Match) {
      const body = currentBody.join("\n").trim();
      if (body.length > 0 || currentHeading) {
        sections.push({
          heading: currentHeading,
          body,
        });
      }
      currentHeading = h2Match[1]!.trim();
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }

  // Flush final section
  const finalBody = currentBody.join("\n").trim();
  if (finalBody.length > 0 || currentHeading) {
    sections.push({
      heading: currentHeading,
      body: finalBody,
    });
  }

  return sections;
}

/**
 * Parse a standard skill file (.agents/skills/*.md, .github/skills/*.md, .kimiflare/skills/*.md).
 * Expects YAML frontmatter with at least `name`.
 */
export function parseSkillFile(filePath: string, rawText: string): ParsedSkill {
  const parsed = matter(rawText);
  const name = typeof parsed.data.name === "string" ? parsed.data.name : "";
  const description = typeof parsed.data.description === "string" ? parsed.data.description : "";

  if (!name) {
    throw new Error(`Skill file missing required 'name' field: ${filePath}`);
  }

  const sections = splitIntoSections(parsed.content);

  // If no ## sections, treat the entire body as one section
  if (sections.length === 0) {
    sections.push({ heading: name, body: parsed.content.trim() });
  }

  // If the first section has an empty heading (content before first ##),
  // use the skill name as its heading
  const firstSection = sections[0];
  if (firstSection && firstSection.heading === "") {
    firstSection.heading = name;
  }

  return {
    name,
    description,
    filePath,
    contentHash: computeContentHash(rawText, PARSER_VERSION),
    parserVersion: PARSER_VERSION,
    sections,
  };
}

/**
 * Parse AGENTS.md: each ## section becomes a virtual skill.
 */
export function parseAgentsMd(filePath: string, rawText: string): ParsedSkill[] {
  const sections = splitIntoSections(rawText);
  const skills: ParsedSkill[] = [];

  for (const section of sections) {
    if (!section.heading) continue;

    const description = extractDescription(section.body, section.heading);

    skills.push({
      name: section.heading,
      description,
      filePath,
      contentHash: computeContentHash(rawText, PARSER_VERSION),
      parserVersion: PARSER_VERSION,
      sections: [{ heading: section.heading, body: section.body }],
    });
  }

  return skills;
}
