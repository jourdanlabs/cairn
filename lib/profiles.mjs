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

  data: {
    name: 'data',
    label: 'Metric integrity — data documentation',
    terms: {
      vault: 'doc corpus', Vault: 'Doc corpus', vaults: 'doc corpora',
      receipt: 'provenance receipt', Receipt: 'Provenance receipt', receipts: 'provenance receipts',
      notes: 'docs', Notes: 'Docs', note: 'doc',
    },
    prefs: { strictness: 0.65 }, // between bank (0.6) and law (0.7): refuse readily, but glossary Qs are common
    cardKinds: {
      default: 'Prefer definitions, formulas stated in prose, owning teams, effective/change dates, and the systems each claim applies to.',
      metric: 'This is a METRIC definition card. Extract: the metric\'s definition as EACH source states it (verbatim differences matter), the formula or inclusion/exclusion rules, the grain and time window, the owning team or named owner, effective and last-reviewed dates, and known exceptions. Attribute every definition to its source document; if two sources define the metric differently, record BOTH with their sources — never merge or average them.',
      glossary: 'This is a GLOSSARY term card. Extract: the term\'s definition(s), who defined it and when, synonyms and near-synonyms in active use, and the dashboards/systems where it appears. Attribute everything to its source document.',
      source: 'This is a data SOURCE card. Extract: what the system or dataset contains, refresh cadence, named owner, known caveats or quality issues, and which metrics or dashboards documents say depend on it — each claim with its citing document.',
    },
  },

  civic: {
    name: 'civic',
    label: 'Public record integrity',
    terms: {
      vault: 'public record', Vault: 'Public record', vaults: 'public records',
      receipt: 'record cite', Receipt: 'Record cite', receipts: 'record cites',
      notes: 'records', Notes: 'Records', note: 'record',
    },
    prefs: { strictness: 0.75 }, // a government speaking on the record refuses by default
    cardKinds: {
      default: 'Prefer adopted actions, effective dates, vote outcomes, and which body acted. Attribute every fact to the record that states it; never merge what a draft proposes with what the council adopted.',
      ordinance: 'This is an ORDINANCE card. Extract: ordinance number and title, the code sections it adds, amends, or repeals, adoption date and the recorded vote, effective date, whether the passages show it as codified, and any ordinance or resolution it supersedes. Quote operative legal language exactly — never paraphrase a requirement, a number, or a deadline.',
      action: 'This is a COUNCIL ACTION card. Extract: the motion as the minutes record it, who moved and seconded, the vote BY NAME where the minutes give it, meeting date and agenda item, and what the action directs staff to do WITH DEADLINES. Only what the record states — never infer what "must have happened" between meetings.',
      official: 'This is an OFFICIAL card. Extract: full name, office or seat, term dates, appointments and committee assignments, and dated official actions. Never characterize performance, intent, or credibility — only what the record says, where.',
    },
  },

  energy: {
    name: 'energy',
    label: 'Process-safety document integrity',
    terms: {
      vault: 'controlled document set', Vault: 'Controlled document set', vaults: 'controlled document sets',
      receipt: 'audit receipt', Receipt: 'Audit receipt', receipts: 'audit receipts',
      notes: 'documents', Notes: 'Documents', note: 'document',
    },
    prefs: { strictness: 0.75 }, // a safety corpus refuses before it guesses
    cardKinds: {
      default: 'Prefer equipment identity (tag numbers, unit, service), numeric limits WITH UNITS copied exactly as written, revision and effective dates, and open action items.',
      procedure: 'This is a PROCEDURE card. Extract: procedure ID and revision, effective/last-review date, unit and equipment covered, every numeric limit or setpoint WITH UNITS copied exactly, required permits and PPE, and references to other procedures or MOCs. Attribute every limit to its source document. Never infer a step or a value the text does not state.',
      moc: 'This is an MOC (management of change) card. Extract: what changed and why, equipment and units affected, approval status with dates, and every required follow-up (procedure updates, drawing updates, training, PSSR) with whether the documents show it CLOSED or OPEN. A required action with no completion evidence is OPEN — never assume it was done.',
      equipment: 'This is an EQUIPMENT card. Extract: tag number, service and unit, design limits (MAWP, relief set pressures, trip points) with units, inspection and test dates with findings, and open recommendations. Never merge facts across different tag numbers, and never carry a value over from a similar equipment item.',
      lease: 'This is a LEASE card. Extract: lessor and lessee, effective date and primary term, royalty terms, and every obligation clause with its deadline (continuous operations, shut-in, Pugh, depth severance) QUOTED verbatim. Dates and deadlines must come from the text; never compute or extend a deadline.',
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
