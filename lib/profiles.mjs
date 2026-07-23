// CAIRN editions — one core, several faces. A profile changes VOCABULARY, default
// strictness, and the consolidation card kinds an operator gets — never the engine.
// The bank product, the personal second brain, and the law edition are the same server
// pointed at different corpora with different words on the door. Forking the core for a
// vertical is how products die of divergence; a profile is one object.
//
// Select with CAIRN_PROFILE=law (env) or the `profile` preference.

export const PROFILES = {
  personal: {
    name: 'personal',
    label: 'Personal archive',
    terms: {}, // the default UI language IS the personal language
    prefs: {},
    cardKinds: {
      default: 'Prefer identity facts (full name, role, relationships), decisions, and current status.',
    },
  },

  bank: {
    name: 'bank',
    label: 'Knowledge integrity — regulated corpus',
    terms: { vault: 'controlled corpus', Vault: 'Controlled corpus' },
    prefs: { strictness: 0.6 },
    cardKinds: {
      default: 'Prefer facts about ownership, effective dates, approval status, and controls.',
      policy: 'This is a POLICY card. Extract: what the policy requires, who it applies to, effective/review dates, the owning function, and exceptions. Attribute every requirement to its source document.',
      vendor: 'This is a VENDOR card. Extract: services provided, contract/renewal dates, risk tier, open findings, and named contacts.',
    },
  },

  law: {
    name: 'law',
    label: 'Matter integrity',
    // Whole-word swaps applied to UI text. The engine never sees these — a receipt is
    // still a receipt in the ledger; the profession calls it a pin cite on screen.
    terms: {
      vault: 'matter file', Vault: 'Matter file', vaults: 'matter files',
      receipt: 'pin cite', Receipt: 'Pin cite', receipts: 'pin cites',
      notes: 'documents', Notes: 'Documents', note: 'document',
    },
    prefs: { strictness: 0.7 }, // a matter file answers conservatively by default
    cardKinds: {
      default: 'Prefer identity facts, roles, relationships to the parties, and dated events.',
      witness: 'This is a WITNESS card. Extract: full name, role/affiliation, relationship to the parties, key testimony WITH DATES wherever the passages give them, prior statements, and any inconsistencies between statements. Never characterize credibility — only what was said, where.',
      issue: 'This is an ISSUE card. Extract: each position taken and BY WHOM, the documents/authorities cited for each position, key admissions, and open questions. Attribute every position; never state a position without its holder.',
      matter: 'This is a MATTER summary card. Extract: parties and counsel, claims and defenses, key dates and deadlines, procedural posture, and what is decided vs open.',
    },
  },
};

export function getProfile(name) {
  return PROFILES[String(name || '').toLowerCase()] || PROFILES.personal;
}

// Card-kind guidance for the consolidation prompt: the requested kind, else the
// profile's default angle.
export function kindGuidance(profile, kind) {
  const kinds = profile.cardKinds || {};
  return kinds[String(kind || '').toLowerCase()] || kinds.default || PROFILES.personal.cardKinds.default;
}
