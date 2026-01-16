/**
 * Registry Integration Example
 *
 * This example demonstrates how to use the Registry class
 * to load, merge, and query action definitions.
 */

import { createAndLoadRegistry } from './registry.js';

async function main() {
  console.log('=== Action Registry Example ===\n');

  // Create and load registry
  console.log('Loading actions...');
  const { registry, result } = await createAndLoadRegistry({
    debug: false,
  });

  // Show load results
  console.log(`\nLoaded: ${result.namespaces.size} namespaces`);
  console.log(`Errors: ${result.errors.length}`);
  console.log(`Warnings: ${result.warnings.length}`);

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    for (const error of result.errors) {
      console.log(`  - ${error.type}: ${error.message} (${error.path})`);
    }
  }

  if (result.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const warning of result.warnings) {
      console.log(`  - ${warning.type}: ${warning.message}`);
    }
  }

  // Show statistics
  console.log('\n=== Registry Statistics ===');
  const stats = registry.getStats();
  console.log(`Namespaces: ${stats.namespaceCount}`);
  console.log(`Actions: ${stats.actionCount}`);
  console.log(`Selectors: ${stats.selectorCount}`);

  // List namespaces
  console.log('\n=== Namespaces ===');
  const namespaces = registry.getNamespaces();
  for (const [name, ns] of namespaces) {
    console.log(`\n${name} (v${ns.version})`);
    console.log(`  Description: ${ns.description}`);
    console.log(`  Source: ${ns.sourcePath}`);
    console.log(`  Actions: ${Object.keys(ns.actions).length}`);
    console.log(`  Selectors: ${Object.keys(ns.selectors).length}`);
  }

  // Show all actions
  console.log('\n=== All Actions ===');
  const actions = registry.getAllActions();
  for (const action of actions) {
    const deprecated = action.deprecated ? ' [DEPRECATED]' : '';
    console.log(`  ${action.fullName}${deprecated}`);
    console.log(`    ${action.description}`);
  }

  // Search example
  console.log('\n=== Search Example ===');
  console.log('Searching for "login"...');
  const searchResults = registry.search('login', {
    limit: 5,
  });

  for (const result of searchResults) {
    console.log(`\n  ${result.action.fullName} (score: ${result.score})`);
    console.log(`    ${result.action.description}`);
    console.log(`    Matches: ${result.matches.join(', ')}`);
  }

  // Get specific action
  if (registry.hasAction('common:login')) {
    console.log('\n=== Action Details: common:login ===');
    const action = registry.getAction('common:login')!;
    console.log(`Name: ${action.name}`);
    console.log(`Namespace: ${action.namespace}`);
    console.log(`Description: ${action.description}`);
    console.log(`Parameters: ${Object.keys(action.params).join(', ')}`);
    console.log(`Steps: ${action.steps.length}`);
    console.log(`Source: ${action.sourcePath}`);
  }

  // Debug info
  console.log('\n=== Debug Info ===');
  const debugInfo = registry.getDebugInfo();
  console.log(`Total namespaces tracked: ${debugInfo.namespaces.length}`);
  console.log(`Total actions tracked: ${debugInfo.actions.length}`);

  console.log('\n=== Done ===');
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { main };
