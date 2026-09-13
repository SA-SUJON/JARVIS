import sys, json, os

sys.path.insert(0, 'python-engine')

# Test 1: Identity module loads and verifies
from Backend.Identity import get_identity, get_hardened_system_prompt, is_authentic
identity = get_identity()
print('=== TEST 1: Identity Verification ===')
print('  is_authentic :', identity['is_authentic'])
print('  creator      :', identity['creator'])
print('  ai_name      :', identity['ai_name'])
print('  ai_code_name :', identity['ai_code_name'])
print('  model        :', identity['model'])
print('  version      :', identity['version'])
assert identity['is_authentic'] == True, "Identity verification FAILED"
print('  [PASS]\n')

# Test 2: Bridge health action exposes identity
os.chdir('python-engine')
sys.path.insert(0, '.')
import bridge
result = bridge.handle({'action': 'health', 'settings': {}})
print('=== TEST 2: Bridge Health Action ===')
print('  ok        :', result['ok'])
print('  creator   :', result.get('identity', {}).get('creator'))
print('  authentic :', result.get('identity', {}).get('is_authentic'))
assert result['ok'] == True
assert result['identity']['is_authentic'] == True, "Bridge identity check FAILED"
print('  [PASS]\n')

# Test 3: Identity queries route correctly
print('=== TEST 3: Identity Query Routing ===')
from Backend.Model import _heuristic_decision
for q in ['who made you?', 'who created you', 'what is your name?', 'who are you']:
    res = _heuristic_decision(q)
    print(f'  Q: "{q}" -> {res}')
    assert res[0].startswith('general'), f'Expected general routing, got: {res}'
print('  [PASS]\n')

# Test 4: Tamper detection
print('=== TEST 4: Tamper Detection ===')
from Backend.Identity import _ed25519_verify, _deobfuscate
import base64
envelope = json.load(open('Data/identity.dat', 'r'))
pk = bytes.fromhex(envelope['public_key'])
sig = bytes.fromhex(envelope['signature'])
salt = bytes.fromhex(envelope['salt'])
encrypted = base64.b64decode(envelope['payload'])
decrypted = bytearray(_deobfuscate(encrypted, salt, pk))
decrypted[20] ^= 0xFF  # corrupt one byte
is_valid = _ed25519_verify(sig, bytes(decrypted), pk)
assert is_valid == False, "Tamper detection FAILED"
print('  Modified payload signature check: False (correct)')
print('  [PASS]\n')

print('=============================')
print('All 4 tests PASSED!')
