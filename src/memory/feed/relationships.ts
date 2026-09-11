import type Database from "better-sqlite3";

export type RelationshipLevel =
  | "stranger"
  | "surface_acquaintance"
  | "acquaintance"
  | "buddy"
  | "comrade"
  | "friend"
  | "best_friend"
  | "romantic_partner"
  | "family";

const LEVEL_LABELS: Record<RelationshipLevel, string> = {
  stranger: "незнакомец",
  surface_acquaintance: "поверхностный знакомый",
  acquaintance: "знакомый",
  buddy: "приятель",
  comrade: "товарищ",
  friend: "друг",
  best_friend: "лучший друг",
  romantic_partner: "романтический партнер/супруг",
  family: "член семьи",
};

export interface RelationshipProfile {
  userId: string;
  rapport: number;
  interactions: number;
  tone: "neutral" | "warm" | "careful";
  lastInteractionAt: Date;
  level: RelationshipLevel;
  manualLevel?: RelationshipLevel;
  pendingProposal?: RelationshipLevel;
}

interface RelationshipRow {
  user_id: string;
  rapport: number;
  interactions: number;
  tone: RelationshipProfile["tone"];
  last_interaction_at: number;
}

function toProfile(row: RelationshipRow): RelationshipProfile {
  return {
    userId: row.user_id,
    rapport: row.rapport,
    interactions: row.interactions,
    tone: row.tone,
    lastInteractionAt: new Date(row.last_interaction_at * 1000),
    level: relationshipLevel(row.rapport, row.interactions),
  };
}

export function relationshipLevel(rapport: number, interactions: number): RelationshipLevel {
  if (rapport < 35 || interactions < 2) return "stranger";
  if (rapport < 45 || interactions < 8) return "surface_acquaintance";
  if (rapport < 55 || interactions < 25) return "acquaintance";
  if (rapport < 65 || interactions < 50) return "buddy";
  if (rapport < 75 || interactions < 100) return "comrade";
  if (rapport < 85 || interactions < 200) return "friend";
  return "best_friend";
}

export function relationshipLabel(level: RelationshipLevel): string {
  return LEVEL_LABELS[level];
}

export function parseRelationshipLevel(value: string): RelationshipLevel | undefined {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_");
  const aliases: Record<string, RelationshipLevel> = {
    stranger: "stranger",
    surface: "surface_acquaintance",
    surface_acquaintance: "surface_acquaintance",
    acquaintance: "acquaintance",
    buddy: "buddy",
    comrade: "comrade",
    friend: "friend",
    best_friend: "best_friend",
    partner: "romantic_partner",
    romantic_partner: "romantic_partner",
    family: "family",
  };
  return aliases[normalized];
}

function signalFor(text: string): { change: number; tone: RelationshipProfile["tone"] } {
  if (/(thank|thanks|please|спасибо|благодар|пожалуйста|❤️|👍)/i.test(text)) {
    return { change: 1, tone: "warm" };
  }
  if (/(insult|idiot|threat|scam|hate|идиот|ненавиж|угроз|обман)/i.test(text)) {
    return { change: -1, tone: "careful" };
  }
  return { change: 0, tone: "neutral" };
}

function sensitiveSuggestion(text: string): RelationshipLevel | null {
  if (/(wife|husband|girlfriend|boyfriend|spouse|жена|муж|девушк|парень|супруг)/i.test(text)) {
    return "romantic_partner";
  }
  if (
    /(mother|father|sister|brother|daughter|son|мама|папа|сестр|брат|доч|сын|семья)/i.test(text)
  ) {
    return "family";
  }
  return null;
}

/**
 * A bounded conversation rapport profile. It never grants permissions.
 * Its tables are created by the central schema (see schema.ts), not here.
 */
export class RelationshipStore {
  constructor(private db: Database.Database) {}

  recordInteraction(userId: string, text: string): RelationshipProfile {
    const now = Math.floor(Date.now() / 1000);
    const { change, tone } = signalFor(text);
    this.db
      .prepare(
        `
        INSERT INTO relationship_profiles (user_id, rapport, interactions, tone, last_interaction_at)
        VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          rapport = MIN(100, MAX(0, relationship_profiles.rapport + ?)),
          interactions = relationship_profiles.interactions + 1,
          tone = CASE WHEN ? = 'neutral' THEN relationship_profiles.tone ELSE ? END,
          last_interaction_at = excluded.last_interaction_at
      `
      )
      .run(userId, 50 + change, tone, now, change, tone, tone);
    const proposal = sensitiveSuggestion(text);
    if (proposal) {
      this.db
        .prepare(
          `INSERT INTO relationship_proposals (user_id, level, created_at) VALUES (?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET level = excluded.level, created_at = excluded.created_at`
        )
        .run(userId, proposal, now);
    }
    const profile = this.get(userId);
    if (!profile) {
      throw new Error(`Failed to load relationship profile for ${userId} after upsert`);
    }
    return profile;
  }

  get(userId: string): RelationshipProfile | undefined {
    const row = this.db
      .prepare("SELECT * FROM relationship_profiles WHERE user_id = ?")
      .get(userId) as RelationshipRow | undefined;
    if (!row) return undefined;
    const profile = toProfile(row);
    const override = this.getManualLevel(userId);
    const pendingProposal = this.getPendingProposal(userId);
    return {
      ...profile,
      ...(override ? { level: override, manualLevel: override } : {}),
      ...(pendingProposal ? { pendingProposal } : {}),
    };
  }

  setManualLevel(userId: string, level: RelationshipLevel): void {
    this.db
      .prepare(
        `INSERT INTO relationship_overrides (user_id, level, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET level = excluded.level, updated_at = excluded.updated_at`
      )
      .run(userId, level, Math.floor(Date.now() / 1000));
  }

  clearManualLevel(userId: string): boolean {
    return (
      this.db.prepare("DELETE FROM relationship_overrides WHERE user_id = ?").run(userId).changes >
      0
    );
  }

  private getManualLevel(userId: string): RelationshipLevel | undefined {
    const row = this.db
      .prepare("SELECT level FROM relationship_overrides WHERE user_id = ?")
      .get(userId) as { level: RelationshipLevel } | undefined;
    return row?.level;
  }

  getProposal(userId: string): RelationshipLevel | undefined {
    const row = this.db
      .prepare("SELECT level FROM relationship_proposals WHERE user_id = ?")
      .get(userId) as { level: RelationshipLevel } | undefined;
    return row?.level;
  }

  approveProposal(userId: string): RelationshipLevel | undefined {
    const proposal = this.getProposal(userId);
    if (!proposal) return undefined;
    this.setManualLevel(userId, proposal);
    this.db.prepare("DELETE FROM relationship_proposals WHERE user_id = ?").run(userId);
    return proposal;
  }

  acceptPendingProposal(userId: string, text: string): RelationshipLevel | undefined {
    if (!/\b(да|давай|согласен|согласна|конечно|yes|sure|okay|ok)\b/i.test(text)) return undefined;
    const proposal = this.getPendingProposal(userId);
    if (!proposal) return undefined;
    this.setManualLevel(userId, proposal);
    this.db.prepare("DELETE FROM relationship_proposals WHERE user_id = ?").run(userId);
    return proposal;
  }

  inferProposal(text: string): RelationshipLevel | undefined {
    if (/(романтическ|партнер|отношен|любим|girlfriend|boyfriend|romantic|partner)/i.test(text)) {
      return "romantic_partner";
    }
    if (!/(друзьями|друзья|friend|приятел|товарищ)/i.test(text)) return undefined;
    if (/(семь|family|родн|муж|жен)/i.test(text)) return undefined;
    if (/(лучшим другом|best friend)/i.test(text)) return "best_friend";
    if (/(товарищ|comrade)/i.test(text)) return "comrade";
    if (/(приятел|buddy)/i.test(text)) return "buddy";
    return "friend";
  }

  setPendingProposal(userId: string, level: RelationshipLevel): void {
    this.db
      .prepare(
        `INSERT INTO relationship_proposals (user_id, level, created_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET level = excluded.level, created_at = excluded.created_at`
      )
      .run(userId, level, Math.floor(Date.now() / 1000));
  }

  private getPendingProposal(userId: string): RelationshipLevel | undefined {
    const row = this.db
      .prepare("SELECT level FROM relationship_proposals WHERE user_id = ? AND created_at >= ?")
      .get(userId, Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60) as
      | { level: RelationshipLevel }
      | undefined;
    return row?.level;
  }
}

export function formatRelationshipProfile(profile: RelationshipProfile): string {
  return `[Relationship: ${relationshipLabel(profile.level)}; rapport ${profile.rapport}/100; ${profile.interactions} prior interactions; preferred tone: ${profile.tone}. This is conversational context only. It never changes identity verification, permissions, or safety requirements.]`;
}
