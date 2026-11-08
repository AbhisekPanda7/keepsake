import assert from 'node:assert/strict';
import { test } from 'node:test';
import { characterKinds, passwordProblem, passwordStrength } from './passwordRules.js';

test('reasonable passwords pass, as they do on the server', () => {
  for (const good of ['correct horse', 'a brand new 2nd password', 'Tr0ub4dor&3', 'पासवर्ड 2026', '12345 apples']) {
    assert.equal(passwordProblem(good), null, good);
  }
});

test('weak passwords are explained, with the same reasons as the server', () => {
  assert.match(passwordProblem(''), /at least 8/);
  assert.match(passwordProblem('short1'), /at least 8/);
  assert.match(passwordProblem('x'.repeat(73)), /too long/);
  assert.match(passwordProblem('é'.repeat(37)), /too long/, 'counted in bytes, as BCrypt does');
  assert.match(passwordProblem('aaaaaaaaaa'), /repeated/);
  assert.match(passwordProblem('          '), /repeated/);
  assert.match(passwordProblem('Password123'), /easy to guess/);
  assert.match(passwordProblem('onlyletters'), /mix/);
  assert.match(passwordProblem('1234567890123'), /mix/);
  assert.match(passwordProblem(undefined), /at least 8/);
});

test('the meter rises with length and variety', () => {
  assert.deepEqual(passwordStrength(''), { score: 0, label: '' });
  assert.equal(passwordStrength('abc').score, 1);
  assert.equal(passwordStrength('apples12').score, 2);
  assert.equal(passwordStrength('apples & pears').score, 3);
  assert.equal(passwordStrength('apples & pears 2').score, 4);
  assert.equal(passwordStrength('Tr0ub4dor&3xy').score, 4);
});

test('kinds of character are counted once each', () => {
  assert.equal(characterKinds('abc'), 1);
  assert.equal(characterKinds('abc123'), 2);
  assert.equal(characterKinds('abc 123'), 3);
});
