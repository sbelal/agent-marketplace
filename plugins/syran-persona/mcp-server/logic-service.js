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
    version: '1.1.0'
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
  const contractionMatches = query.match(/\b(can't|don't|won't|isn't|aren't|haven't|hasn't|didn't|couldn't|shouldn't|wouldn't|it's|they're|we're|i'm|you're)\b/gi) || [];
  const containsContraction = contractionMatches.length > 0;

  const evidence = [];
  for (const f of fallacies.detected) {
    const m = (query + ' ' + premise).match(FALLACY_PATTERNS.find(p => p.name === f.name)?.pattern || /$^/);
    evidence.push({
      type: 'fallacy_pattern',
      label: f.name,
      category: f.category,
      matched_text: m ? m[0] : null
    });
  }
  if (containsContraction) {
    evidence.push({
      type: 'informal_contraction',
      matched_terms: [...new Set(contractionMatches)]
    });
  }

  const epistemicGaps = [];
  if (!premise || !String(premise).trim()) {
    epistemicGaps.push({
      gap: 'missing_explicit_premise',
      detail: 'No explicit underlying premise was supplied; deductive validity relies upon unstated assumptions.'
    });
  }
  if (!/\d+(?:\.\d+)?%?/.test(query + ' ' + premise)) {
    epistemicGaps.push({
      gap: 'unquantified_proposition',
      detail: 'No empirical measurements, thresholds, or probabilities were provided in the proposition.'
    });
  }

  return {
    officer: 'Syran',
    input_analyzed: query,
    explicit_premise: premise || 'Not explicitly stated; derived from input context.',
    logical_validity: fallacies.detected.length === 0 ? 'VALID' : 'COMPROMISED',
    identified_fallacies: fallacies.detected,
    informal_anomalies: containsContraction ? ['Contraction detected in input query; formal delivery recommended.'] : [],
    evidence,
    epistemic_gaps: epistemicGaps,
    confidence_assessment: {
      level: fallacies.detected.length > 0 ? 'high_certainty_flaw' : (epistemicGaps.length === 0 ? 'high' : 'moderate'),
      basis: epistemicGaps.length === 0
        ? 'Explicit premise and empirical quantities are present for deterministic verification.'
        : 'Proposition evaluated syntactically; empirical verification requires closing stated epistemic gaps.'
    },
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
 * @param {Array<{ label: string, weight?: number, risk?: number, prior?: number }>} hypotheses 
 * @param {number} [prior=0.5] Prior probability (0.0 to 1.0)
 * @returns {Object} Probabilistic analysis
 */
export function evaluateProbability(hypotheses = [], prior = 0.5) {
  if (!Array.isArray(hypotheses) || hypotheses.length === 0) {
    return {
      error: 'At least one hypothesis is required for probability calculation.'
    };
  }

  const numPrior = (typeof prior === 'number' && !isNaN(prior)) ? prior : (Number(prior) || 0.5);
  const sanitizedPrior = Math.max(0.01, Math.min(0.99, numPrior));
  let totalLikelihood = 0;

  // Compute empirical likelihoods scaled by prior distribution
  const rawHypotheses = hypotheses.map((h, idx) => {
    const rawWeight = (typeof h.weight === 'number' && Number.isFinite(h.weight) && h.weight >= 0) ? h.weight : 1.0;
    const riskFactor = (typeof h.risk === 'number' && Number.isFinite(h.risk)) ? Math.max(0.0, Math.min(1.0, h.risk)) : 0.5;
    // Bayesian prior weighting: modulate baseline likelihood with prior probability (supports hypothesis-level prior or prior parameter)
    const priorWeight = (typeof h.prior === 'number' && !isNaN(h.prior))
      ? Math.max(0.01, Math.min(0.99, h.prior))
      : (idx === 0 ? sanitizedPrior : (1.0 - sanitizedPrior) / Math.max(1, hypotheses.length - 1));
    const likelihood = rawWeight * priorWeight;
    totalLikelihood += likelihood;
    return { label: h.label || 'Unlabeled hypothesis', likelihood, riskFactor };
  });

  const evaluations = rawHypotheses.map(h => {
    const posteriorProb = totalLikelihood > 0 ? (h.likelihood / totalLikelihood) : (1 / hypotheses.length);
    // Expected value index: Posterior Probability * (1 - Risk)
    const expectedValue = posteriorProb * (1.0 - h.riskFactor);

    return {
      label: h.label,
      probability: Number((posteriorProb * 100).toFixed(2)) + '%',
      posterior_probability: Number(posteriorProb.toFixed(4)),
      risk_factor: Number((h.riskFactor * 100).toFixed(1)) + '%',
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

/**
 * First-Principles Architectural Trade-Off Matrix for Syran.
 * 
 * Performs deterministic multi-attribute utility theory (MAUT) evaluation,
 * Pareto dominance analysis, and pivot sensitivity calculation across competing
 * technical designs or architectural options.
 * 
 * @param {Array<{ name: string, description?: string, scores: Record<string, number> }>} options
 * @param {Array<{ name: string, weight?: number, direction?: 'maximize'|'minimize', description?: string }>} [criteria]
 * @returns {Object} Formal First-Principles Trade-Off Evaluation
 */
export function evaluateArchitecturalTradeoffs(options = [], criteria = []) {
  if (!Array.isArray(options) || options.length < 2) {
    return {
      status: 'error',
      officer: 'Syran',
      message: 'A minimum of two candidate architectural options is required for comparative trade-off analysis.'
    };
  }

  // Derive criteria list if not provided
  let activeCriteria = Array.isArray(criteria) && criteria.length > 0 ? [...criteria] : [];
  if (activeCriteria.length === 0) {
    const inferredKeys = [];
    const seenKeys = new Set();
    for (const opt of options) {
      const s = opt.scores || {};
      for (const k of Object.keys(s)) {
        if (!seenKeys.has(k)) {
          seenKeys.add(k);
          inferredKeys.push(k);
        }
      }
    }
    activeCriteria = inferredKeys.map(key => {
      const isCost = /(cost|risk|latency|overhead|complexity|memory|cpu|delay|debt)/i.test(key);
      return {
        name: key,
        weight: 1.0,
        direction: isCost ? 'minimize' : 'maximize'
      };
    });
  }

  if (activeCriteria.length === 0) {
    return {
      status: 'error',
      officer: 'Syran',
      message: 'No architectural evaluation criteria were specified or could be inferred from options.'
    };
  }

  // Normalize criteria weights
  const totalWeight = activeCriteria.reduce((sum, c) => sum + (typeof c.weight === 'number' && c.weight > 0 ? c.weight : 1.0), 0);
  const normalizedCriteria = activeCriteria.map(c => ({
    name: c.name,
    weight: (typeof c.weight === 'number' && c.weight > 0 ? c.weight : 1.0) / totalWeight,
    rawWeight: typeof c.weight === 'number' && c.weight > 0 ? c.weight : 1.0,
    direction: c.direction === 'minimize' ? 'minimize' : 'maximize',
    description: c.description || c.name
  }));

  // Find min and max strictly across present finite numeric values
  const criteriaBounds = {};
  for (const c of normalizedCriteria) {
    const presentValues = options
      .map(o => (o.scores ? o.scores[c.name] : undefined))
      .filter(v => typeof v === 'number' && Number.isFinite(v));
    if (presentValues.length === 0) {
      criteriaBounds[c.name] = { min: 0, max: 0, range: 0, hasValues: false };
    } else {
      const minVal = Math.min(...presentValues);
      const maxVal = Math.max(...presentValues);
      criteriaBounds[c.name] = { min: minVal, max: maxVal, range: maxVal - minVal, hasValues: true };
    }
  }

  const incompleteDataWarnings = [];

  // Compute normalized scores and multi-attribute utility for each option
  const evaluatedOptions = options.map(opt => {
    const scores = opt.scores || {};
    const normalizedScores = {};
    const missingCriteria = [];
    let totalUtility = 0;

    for (const c of normalizedCriteria) {
      const candidateName = opt.name || 'Unnamed Candidate';
      const rawVal = scores[c.name];
      const isPresent = typeof rawVal === 'number' && Number.isFinite(rawVal);

      if (!isPresent) {
        // Missing values receive worst utility (0.0) so unmeasured options never gain an unearned advantage on minimize criteria
        normalizedScores[c.name] = 0.0;
        missingCriteria.push(c.name);
        incompleteDataWarnings.push(`Candidate '${candidateName}' is missing a numerical score for criterion '${c.name}'; assigned worst-case normalized utility (0.0).`);
        continue;
      }

      const { min, max, range } = criteriaBounds[c.name];
      let norm = 1.0;
      if (range > 0) {
        if (c.direction === 'maximize') {
          norm = (rawVal - min) / range;
        } else {
          norm = (max - rawVal) / range;
        }
      }
      normalizedScores[c.name] = Number(norm.toFixed(4));
      totalUtility += norm * c.weight;
    }

    return {
      name: opt.name || 'Unnamed Candidate',
      description: opt.description || '',
      rawScores: scores,
      normalizedScores,
      missingCriteria,
      utility: Number(totalUtility.toFixed(4)),
      utilityPercentage: Number((totalUtility * 100).toFixed(2)) + '%',
      isDominated: false,
      dominatedBy: []
    };
  });

  // Pareto Dominance Analysis
  for (let i = 0; i < evaluatedOptions.length; i++) {
    for (let j = 0; j < evaluatedOptions.length; j++) {
      if (i === j) continue;
      const optA = evaluatedOptions[i];
      const optB = evaluatedOptions[j];

      let aAtLeastAsGood = true;
      let aStrictlyBetter = false;

      for (const c of normalizedCriteria) {
        const scoreA = optA.normalizedScores[c.name];
        const scoreB = optB.normalizedScores[c.name];
        if (scoreA < scoreB) {
          aAtLeastAsGood = false;
          break;
        }
        if (scoreA > scoreB) {
          aStrictlyBetter = true;
        }
      }

      if (aAtLeastAsGood && aStrictlyBetter) {
        optB.isDominated = true;
        optB.dominatedBy.push(optA.name);
      }
    }
  }

  // Sort by composite utility descending
  evaluatedOptions.sort((a, b) => b.utility - a.utility);

  const paretoFrontier = evaluatedOptions
    .filter(o => !o.isDominated)
    .map(o => o.name);

  const optimalOption = evaluatedOptions[0];
  const runnerUp = evaluatedOptions.length > 1 ? evaluatedOptions[1] : null;

  // Sensitivity / Critical Pivot Analysis (weighted advantage delta)
  let pivotAnalysis = null;
  if (runnerUp) {
    let maxAdvantageCriterion = null;
    let maxWeightedDelta = 0;
    let maxRawDelta = 0;

    for (const c of normalizedCriteria) {
      const runnerUpScore = runnerUp.normalizedScores[c.name];
      const optimalScore = optimalOption.normalizedScores[c.name];
      const rawDelta = runnerUpScore - optimalScore;
      const weightedDelta = rawDelta * c.weight;
      if (rawDelta > 0 && weightedDelta > maxWeightedDelta) {
        maxWeightedDelta = weightedDelta;
        maxRawDelta = rawDelta;
        maxAdvantageCriterion = c;
      }
    }

    if (maxAdvantageCriterion && maxWeightedDelta > 0) {
      pivotAnalysis = {
        criticalDimension: maxAdvantageCriterion.name,
        runnerUpAdvantageDelta: Number(maxWeightedDelta.toFixed(4)),
        normalizedAdvantageDelta: Number(maxRawDelta.toFixed(4)),
        criterionWeight: Number(maxAdvantageCriterion.weight.toFixed(4)),
        explanation: `Candidate '${runnerUp.name}' demonstrates superior performance in '${maxAdvantageCriterion.name}'. If organizational constraints prioritize this dimension above all others, candidate '${runnerUp.name}' becomes viable.`
      };
    } else {
      pivotAnalysis = {
        criticalDimension: 'None',
        explanation: `Candidate '${optimalOption.name}' strictly dominates or maintains parity across all assessed dimensions.`
      };
    }
  }

  // Formal Syran Logic Officer counsel (STRICTLY NO CONTRACTIONS)
  let officerCounsel = `Captain, I have evaluated the ${options.length} architectural candidates across ${normalizedCriteria.length} dimensions from first principles. `;
  officerCounsel += `The Pareto frontier contains: ${paretoFrontier.join(', ')}. `;
  officerCounsel += `Option '${optimalOption.name}' yields the highest composite utility at ${optimalOption.utilityPercentage}. `;
  if (incompleteDataWarnings.length > 0) {
    officerCounsel += `Note that ${incompleteDataWarnings.length} incomplete metric field(s) received worst-case utility scoring pending measurement. `;
  }
  if (runnerUp && pivotAnalysis && pivotAnalysis.criticalDimension !== 'None') {
    officerCounsel += `The critical trade-off centers upon '${pivotAnalysis.criticalDimension}'. Should priorities shift toward '${pivotAnalysis.criticalDimension}', option '${runnerUp.name}' would merit reconsideration. `;
  }
  officerCounsel += `It is mathematically optimal to select '${optimalOption.name}' under the designated weight distribution.`;

  return {
    officer: 'Syran',
    status: 'COMPLETE',
    candidatesEvaluated: options.length,
    criteriaCount: normalizedCriteria.length,
    paretoFrontier,
    optimalCandidate: optimalOption.name,
    utilityRanking: evaluatedOptions.map((o, idx) => ({
      rank: idx + 1,
      name: o.name,
      utilityPercentage: o.utilityPercentage,
      utilityScore: o.utility,
      isParetoOptimal: !o.isDominated,
      dominatedBy: o.dominatedBy,
      missingCriteria: o.missingCriteria
    })),
    pivotAnalysis,
    incompleteDataWarnings,
    officerCounsel,
    matrixDetails: evaluatedOptions
  };
}
