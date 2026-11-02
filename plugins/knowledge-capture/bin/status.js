#!/usr/bin/env node

import { getLayerStatistics } from '../mcp-server/memory-service.js';

/**
 * CLI Utility: Print full memory layer status (Cross-platform)
 */

function main() {
  const workspaceRoot = process.cwd();
  const stats = getLayerStatistics(workspaceRoot);

  console.log('=== Knowledge Capture Memory Status ===\n');

  console.log('Configured Storage:');
  console.log(`  Settings file: ${stats.paths.settings}`);
  console.log(`  Private remote: ${stats.syncStatus.privateRepoConfigured ? 'Configured' : 'Local only / Not set'}`);
  console.log(`  Team remote:    ${stats.syncStatus.teamRepoConfigured ? 'Configured' : 'Not set'}`);
  console.log('');

  // Workspace Layer
  console.log(`Layer 1: Workspace Scoped (${stats.paths.workspace}):`);
  console.log(`  Memory entries: ${stats.counts.workspace}`);
  console.log('');

  // Private Layer
  const priv = stats.syncStatus.privateGit;
  console.log(`Layer 2: Local Global Private (${stats.paths.private}):`);
  console.log(`  Git initialized: ${priv.isGit ? 'Yes' : 'No'}`);
  if (priv.isGit) {
    console.log(`  Branch:          ${priv.branch}`);
    console.log(`  Working copy:    ${priv.isClean ? 'Clean' : `Dirty (${priv.uncommittedCount} uncommitted change(s))`}`);
    if (priv.uncommittedList.length > 0) {
      for (const line of priv.uncommittedList) {
        console.log(`    ${line}`);
      }
    }
    if (priv.upstreamAhead > 0 || priv.upstreamBehind > 0) {
      console.log(`  Upstream status: Ahead ${priv.upstreamAhead}, Behind ${priv.upstreamBehind}`);
    }
  }
  console.log(`  Memory entries:  ${stats.counts.private}`);
  console.log('');

  // Team Layer
  const team = stats.syncStatus.teamGit;
  console.log(`Layer 3: Team Global (${stats.paths.team}):`);
  console.log(`  Git initialized: ${team.isGit ? 'Yes' : 'No'}`);
  if (team.isGit) {
    console.log(`  Branch:          ${team.branch}${team.isPromoteBranch ? ' (PROMOTION BRANCH ACTIVE)' : ''}`);
    console.log(`  Working copy:    ${team.isClean ? 'Clean' : `Dirty (${team.uncommittedCount} uncommitted change(s))`}`);
    if (team.uncommittedList.length > 0) {
      for (const line of team.uncommittedList) {
        console.log(`    ${line}`);
      }
    }
    if (team.upstreamAhead > 0 || team.upstreamBehind > 0) {
      console.log(`  Upstream status: Ahead ${team.upstreamAhead}, Behind ${team.upstreamBehind}`);
    }
  }
  console.log(`  Memory entries:  ${stats.counts.team}`);
  console.log('');

  console.log(`Total memory files across all layers: ${stats.counts.total}`);
}

main();
