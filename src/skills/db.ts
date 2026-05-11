import type Database from "better-sqlite3";
import type { ParsedSkill, ParsedSkillSection, SectionResult } from "./types.js";

export function initSkillsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      file_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      parser_version INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skill_sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_id INTEGER NOT NULL,
      heading TEXT NOT NULL,
      body TEXT NOT NULL,
      embedding BLOB NOT NULL,
      FOREIGN KEY (skill_id) REFERENCES skill_index(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_skill_path ON skill_index(file_path);
  `);
}

export function getSkillByPath(
  db: Database.Database,
  filePath: string
): { id: number; contentHash: string; parserVersion: number } | null {
  const row = db
    .prepare("SELECT id, content_hash, parser_version FROM skill_index WHERE file_path = ?")
    .get(filePath) as { id: number; content_hash: string; parser_version: number } | undefined;
  if (!row) return null;
  return { id: row.id, contentHash: row.content_hash, parserVersion: row.parser_version };
}

export function upsertSkill(db: Database.Database, skill: ParsedSkill): number {
  const existing = getSkillByPath(db, skill.filePath);
  const now = Date.now();

  if (existing) {
    // Update
    db.prepare(
      `UPDATE skill_index
       SET name = ?, description = ?, content_hash = ?, parser_version = ?, updated_at = ?
       WHERE id = ?`
    ).run(skill.name, skill.description, skill.contentHash, skill.parserVersion, now, existing.id);

    // Delete old sections (CASCADE would work if we deleted the skill row,
    // but since we're updating in place, manually delete sections)
    db.prepare("DELETE FROM skill_sections WHERE skill_id = ?").run(existing.id);
    return existing.id;
  }

  // Insert
  const result = db
    .prepare(
      `INSERT INTO skill_index (name, description, file_path, content_hash, parser_version, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(skill.name, skill.description, skill.filePath, skill.contentHash, skill.parserVersion, now);
  return Number(result.lastInsertRowid);
}

export function insertSections(
  db: Database.Database,
  skillId: number,
  sections: ParsedSkillSection[],
  embeddings: Float32Array[]
): void {
  const insert = db.prepare(
    `INSERT INTO skill_sections (skill_id, heading, body, embedding)
     VALUES (?, ?, ?, ?)`
  );
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    const embedding = embeddings[i]!;
    insert.run(skillId, section.heading, section.body, Buffer.from(embedding.buffer));
  }
}

export function deleteOrphanedSkills(db: Database.Database, existingPaths: string[]): number {
  if (existingPaths.length === 0) {
    const result = db.prepare("DELETE FROM skill_index").run();
    return Number(result.changes);
  }

  const placeholders = existingPaths.map(() => "?").join(",");
  const result = db
    .prepare(`DELETE FROM skill_index WHERE file_path NOT IN (${placeholders})`)
    .run(...existingPaths);
  return Number(result.changes);
}

export function listAllSectionRows(
  db: Database.Database
): Array<{
  id: number;
  heading: string;
  body: string;
  embedding: Buffer;
  name: string;
  description: string;
  file_path: string;
}> {
  return db
    .prepare(
      `SELECT s.id, s.heading, s.body, s.embedding, i.name, i.description, i.file_path
       FROM skill_sections s
       JOIN skill_index i ON s.skill_id = i.id`
    )
    .all() as Array<{
    id: number;
    heading: string;
    body: string;
    embedding: Buffer;
    name: string;
    description: string;
    file_path: string;
  }>;
}

export function rowToSectionResult(
  row: ReturnType<typeof listAllSectionRows>[number]
): Omit<SectionResult, "similarity"> {
  return {
    id: row.id,
    heading: row.heading,
    body: row.body,
    name: row.name,
    description: row.description,
    filePath: row.file_path,
  };
}
