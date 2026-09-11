import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { RelationshipStore, formatRelationshipProfile } from "../feed/relationships.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tg_users (id TEXT PRIMARY KEY);
    CREATE TABLE relationship_profiles (
      user_id TEXT PRIMARY KEY,
      rapport INTEGER NOT NULL DEFAULT 50 CHECK(rapport BETWEEN 0 AND 100),
      interactions INTEGER NOT NULL DEFAULT 0,
      tone TEXT NOT NULL DEFAULT 'neutral' CHECK(tone IN ('neutral', 'warm', 'careful')),
      last_interaction_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES tg_users(id) ON DELETE CASCADE
    );
    CREATE TABLE relationship_proposals (
      user_id TEXT PRIMARY KEY,
      level TEXT NOT NULL CHECK(level IN (
        'stranger', 'surface_acquaintance', 'acquaintance', 'buddy', 'comrade',
        'friend', 'best_friend', 'romantic_partner', 'family'
      )),
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE relationship_overrides (
      user_id TEXT PRIMARY KEY,
      level TEXT NOT NULL CHECK(level IN (
        'stranger', 'surface_acquaintance', 'acquaintance', 'buddy', 'comrade',
        'friend', 'best_friend', 'romantic_partner', 'family'
      )),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  return db;
}

describe("RelationshipStore", () => {
  it("keeps rapport bounded and does not use it as an authority signal", () => {
    const db = createTestDb();
    db.prepare("INSERT INTO tg_users (id) VALUES (?)").run("42");
    const store = new RelationshipStore(db);

    const first = store.recordInteraction("42", "Thank you!");
    expect(first).toMatchObject({ rapport: 51, interactions: 1, tone: "warm" });
    const second = store.recordInteraction("42", "You are an idiot");
    expect(second).toMatchObject({ rapport: 50, interactions: 2, tone: "careful" });
    expect(formatRelationshipProfile(second)).toContain("never changes identity verification");
  });

  it("keeps a manual level until automatic scoring is restored", () => {
    const db = createTestDb();
    db.prepare("INSERT INTO tg_users (id) VALUES (?)").run("42");
    const store = new RelationshipStore(db);
    store.recordInteraction("42", "Thank you!");

    store.setManualLevel("42", "friend");
    expect(store.get("42")).toMatchObject({ level: "friend", manualLevel: "friend" });
    expect(store.clearManualLevel("42")).toBe(true);
    expect(store.get("42")?.manualLevel).toBeUndefined();
  });
});
