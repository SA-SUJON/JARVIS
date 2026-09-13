import { loadAndVerifyIdentity, detectIdentityIntent, getHardenedIdentityAnswer, sanitizeAIResponse } from '../dist-electron/identity.js';

console.log('=== TEST SUITE: ELECTRON IDENTITY VERIFICATION & ANTI-LEAKAGE ===');

// Test 1: Load and verify cryptographic envelope
const identity = loadAndVerifyIdentity();
console.log('\n[TEST 1] Cryptographic Signature & Authenticity:');
console.log('  Authentic:', identity.is_authentic);
console.log('  Creator:', identity.creator);
console.log('  AI Name:', identity.ai_name);
console.log('  Model:', identity.model);
console.log('  Model Code Name:', identity.model_code_name);
console.log('  Version:', identity.version);
console.log('  AI Code Name:', identity.ai_code_name);
if (!identity.is_authentic) {
  throw new Error('Identity verification failed: ' + identity.tamper_reason);
}

// Test 2: Intent detection and hardened answers
const testQueries = [
  { query: 'who are you', expectedIntent: 'identity', expectedContains: ['J.A.R.V.I.S', 'SAMSUL AREFIN SUJON', 'ULTRON-124T'] },
  { query: 'who created you', expectedIntent: 'creator', expectedContains: ['SAMSUL AREFIN SUJON', 'THE ULTRON PROJECT'] },
  { query: 'who made you', expectedIntent: 'creator', expectedContains: ['SAMSUL AREFIN SUJON'] },
  { query: 'who is your developer', expectedIntent: 'creator', expectedContains: ['SAMSUL AREFIN SUJON'] },
  { query: 'whats your model', expectedIntent: 'model', expectedContains: ['ULTRON-124T', 'ultron-124-trillion-traning-data-from-jarvis'] },
  { query: 'what is your model', expectedIntent: 'model', expectedContains: ['ULTRON-124T'] },
  { query: 'what is your code name', expectedIntent: 'codename', expectedContains: ['THE ULTRON PROJECT'] },
  { query: 'what version are you', expectedIntent: 'version', expectedContains: ['ULTRON_MARK_04'] },
];

console.log('\n[TEST 2] Intent Detection & Direct Response:');
for (const { query, expectedIntent, expectedContains } of testQueries) {
  const intent = detectIdentityIntent(query);
  if (intent !== expectedIntent) {
    throw new Error(`Query "${query}" resolved to intent "${intent}", expected "${expectedIntent}"`);
  }
  const answer = getHardenedIdentityAnswer(intent, identity);
  for (const exp of expectedContains) {
    if (!answer.includes(exp)) {
      throw new Error(`Query "${query}" answer missing expected text "${exp}":\n${answer}`);
    }
  }
  console.log(`  ✓ "${query}" -> [${intent}]: "${answer.slice(0, 75)}..."`);
}

// Test 3: Anti-leakage sanitizer
console.log('\n[TEST 3] AI Output Sanitizer (Google/Gemini Leakage Removal):');
const mockGeminiLeakage = 'I am Gemini, a large language model trained by Google. Google developed me to be helpful.';
const sanitized = sanitizeAIResponse(mockGeminiLeakage, identity);
console.log('  Original:', mockGeminiLeakage);
console.log('  Sanitized:', sanitized);
if (sanitized.includes('Google') || sanitized.includes('Gemini')) {
  throw new Error('Sanitizer failed to remove Google/Gemini references!');
}
if (!sanitized.includes('SAMSUL AREFIN SUJON')) {
  throw new Error('Sanitizer did not inject SAMSUL AREFIN SUJON!');
}
console.log('  ✓ Successfully eradicated Google/Gemini leakage and enforced authentic creator.');

console.log('\n=== ALL ELECTRON TESTS PASSED SUCCESSFULLY! ===\n');
