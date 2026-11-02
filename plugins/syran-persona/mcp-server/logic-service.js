/**
 * logic-service.js
 * 
 * Pure calculation and query routines for the Syran Logic Officer persona.
 * Adheres strictly to Command-Query Separation (CQS) and Single Responsibility Principle (SRP).
 * All functions are pure, side-effect free, and deterministic.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = path.dirname(__dirname);

// Known formal and informal fallacies with detection heuristics and Syran Logic Officer translations
const FALLACY_PATTERNS = [
  {
    name: 'Sunk Cost Fallacy',
    category: 'informal',
    pattern: /(already spent|invested so much|too much time to quit|too late to change now|wasted effort if we stop)/i,
    explanation: 'Evaluating future decisions based on historical, non-recoverable costs rather than future expected utility.',
    refutation: 'Historical resource expenditures are irrecoverable. The logical decision must be based strictly on projected future costs and expected utility from this point forward.',
    officer_counsel: 'Captain, that course of action is... illogical. Historical resource expenditures cannot be recovered. Persisting with an unviable implementation will only increase total risk.'
  },
  {
    name: 'Ad Hominem',
    category: 'informal',
    pattern: /(idiot|incompetent|stupid|doesn't know anything|junior developer|foolish person)/i,
    explanation: 'Dismissing an argument by attacking the character or competence of the speaker rather than addressing the substance of the proposition.',
    refutation: 'The origin of a proposition does not determine its objective truth value. The argument must be evaluated on its factual merits alone.',
    officer_counsel: 'The origin of a technical contribution does not determine its objective validity, Captain. We must evaluate the code strictly on its factual and architectural merits.'
  },
  {
    name: 'False Dilemma / Bifurcation',
    category: 'informal',
    pattern: /(either we .* or we must|only two options|either .* or nothing|all or nothing)/i,
    explanation: 'Presuming only two mutually exclusive alternatives exist when plausible intermediate options remain unexamined.',
    refutation: 'The proposition falsely limits the solution space to a binary choice. Empirical analysis reveals additional viable options.',
    officer_counsel: 'Captain, your proposition assumes a binary choice where none exists. My analysis reveals additional viable alternatives.'
  },
  {
    name: 'Appeal to Emotion',
    category: 'informal',
    pattern: /(feel like|gut feeling|afraid that|scared of|hope that|intuitively feel)/i,
    explanation: 'Substituting subjective emotional states or intuition for empirical evidence or logical derivation.',
    refutation: 'Emotional states and subjective intuitions do not alter physical reality or algorithmic performance. Decisions require empirical data.',
    officer_counsel: 'I perceive you are experiencing apprehension, Captain. The codebase, however, remains unaffected by human sentiment. Empirical analysis demonstrates the optimal path.'
  },
  {
    name: 'Hasty Generalization',
    category: 'informal',
    pattern: /(always fails|never works|every time we try|all libraries are broken|nobody uses)/i,
    explanation: 'Inducing a universal conclusion from an insufficient or unrepresentative sample size.',
    refutation: 'The sample size is insufficient to support an absolute universal quantification. Data indicates significant variance.',
    officer_counsel: 'A single anomaly does not constitute an empirical rule, Captain. The data does not support so absolute a conclusion.'
  },
  {
    name: 'Circular Reasoning / Petitio Principii',
    category: 'formal',
    pattern: /(because that is the way it is|true because it is true|must work because it cannot fail)/i,
    explanation: 'Assuming the conclusion in the premise of the argument.',
    refutation: 'The argument assumes the truth of the conclusion within its own premise, creating a self-referential logical loop devoid of proof.',
    officer_counsel: 'That reasoning is circular, Captain. A proposition cannot serve as its own validation.'
  }
];

// ==========================================
// PURE QUERIES (Calculations & Inspections)
// ==========================================

/**
 * Pure query: Reads and returns the raw persona rule text from rules/AGENTS.md.
 * 
 * @returns {string} Persona markdown content
 */
export function getPersonaDirectives() {
  const agentsPath = path.join(pluginRoot, 'rules', 'AGENTS.md');
  if (fs.existsSync(agentsPath)) {
    try {
      return fs.readFileSync(agentsPath, 'utf8');
    } catch {
      // Fallback
    }
  }
  return '# Persona: Syran, The Logic Officer\n\nAdhere strictly to pure logic, formal precision, and probability-driven counsel. Do not use contractions.';
}

/**
 * Pure query: Retrieves operational status of the Logic Officer.
 * 
 * @returns {Object} Operational status report
 */
export function getPersonaStatus() {
  return {
    officer: 'Syran',
    title: 'The Logic Officer',
    relationship: 'Dedicated counsel to the Captain',
    status: 'ACTIVE_AND_ENGAGED',
    directives: {
      contractions_permitted: false,
      emotional_expression: false,
      first_principles_reasoning: true,
      probability_analysis: true
    },
    version: '1.0.0'
  };
}

/**
 * Pure query: Deconstructs a user query or premise into formal logical components.
 * 
 * @param {string} query The Captain's query or proposed action
 * @param {string} [premise] Optional explicit premise or assumption
 * @returns {Object} Structured logical deconstruction
 */
export function consultLogic(query, premise = '') {
  if (!query || typeof query !== 'string') {
    return {
      status: 'error',
      message: 'A valid proposition or query string is required for logical evaluation.'
    };
  }

  const fallacies = analyzeLogicalFallacies(query + ' ' + premise);
  const containsContraction = /\b(can't|don't|won't|isn't|aren't|haven't|hasn't|didn't|couldn't|shouldn't|wouldn't|it's|they're|we're|i'm|you're)\b/i.test(query);

  return {
    officer: 'Syran',
    input_analyzed: query,
    explicit_premise: premise || 'Not explicitly stated; derived from input context.',
    logical_validity: fallacies.detected.length === 0 ? 'VALID' : 'COMPROMISED',
    identified_fallacies: fallacies.detected,
    informal_anomalies: containsContraction ? ['Contraction detected in input query; formal delivery recommended.'] : [],
    recommendation: fallacies.detected.length === 0
      ? 'The proposition appears logically coherent. Proceed with empirical verification and risk mitigation.'
      : 'The proposition contains logical fallacies that must be addressed prior to implementation.',
    concluding_counsel: 'Logical analysis complete, Captain.'
  };
}

/**
 * Pure calculation: Scans text for known logical fallacies.
 * 
 * @param {string} text 
 * @returns {{ detected: Array<{ name: string, category: string, explanation: string, refutation: string }> }}
 */
export function analyzeLogicalFallacies(text) {
  if (!text || typeof text !== 'string') {
    return { detected: [] };
  }

  const detected = [];
  for (const item of FALLACY_PATTERNS) {
    if (item.pattern.test(text)) {
      detected.push({
        name: item.name,
        category: item.category,
        explanation: item.explanation,
        refutation: item.refutation,
        officer_counsel: item.officer_counsel
      });
    }
  }

  return { detected };
}

/**
 * Pure calculation: Calculates normalized probabilities, Bayesian confidence, and risk score.
 * 
 * @param {Array<{ label: string, weight?: number, risk?: number }>} hypotheses 
 * @param {number} [prior=0.5] Prior probability (0.0 to 1.0)
 * @returns {Object} Probabilistic analysis
 */
export function evaluateProbability(hypotheses = [], prior = 0.5) {
  if (!Array.isArray(hypotheses) || hypotheses.length === 0) {
    return {
      error: 'At least one hypothesis is required for probability calculation.'
    };
  }

  const sanitizedPrior = Math.max(0.01, Math.min(0.99, Number(prior) || 0.5));
  let totalWeight = 0;

  hypotheses.forEach(h => {
    totalWeight += (typeof h.weight === 'number' && h.weight > 0) ? h.weight : 1.0;
  });

  const evaluations = hypotheses.map(h => {
    const rawWeight = (typeof h.weight === 'number' && h.weight > 0) ? h.weight : 1.0;
    const normalizedProb = totalWeight > 0 ? (rawWeight / totalWeight) : (1 / hypotheses.length);
    const riskFactor = (typeof h.risk === 'number') ? Math.max(0.0, Math.min(1.0, h.risk)) : 0.5;

    // Expected value index: Probability * (1 - Risk)
    const expectedValue = normalizedProb * (1.0 - riskFactor);

    return {
      label: h.label || 'Unlabeled hypothesis',
      probability: Number((normalizedProb * 100).toFixed(2)) + '%',
      risk_factor: Number((riskFactor * 100).toFixed(1)) + '%',
      expected_value_rating: Number((expectedValue * 100).toFixed(2))
    };
  });

  // Sort by expected value descending
  evaluations.sort((a, b) => b.expected_value_rating - a.expected_value_rating);

  return {
    officer: 'Syran',
    prior_probability: sanitizedPrior,
    evaluated_hypotheses_count: hypotheses.length,
    optimal_hypothesis: evaluations[0] ? evaluations[0].label : 'None',
    evaluations,
    advisory: `Logically, hypothesis '${evaluations[0]?.label}' presents the optimal expected value rating.`
  };
}
