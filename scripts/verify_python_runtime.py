import sys
import pathlib

# Add references/jarvisai to sys.path
ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "references" / "jarvisai"))

print("=== TEST SUITE: PYTHON RUNTIME IDENTITY & CHATBOT ===")

# Test 1: Identity module verification
from Backend.Identity import (
    get_identity,
    is_authentic,
    detect_identity_intent,
    get_hardened_identity_answer,
    sanitize_response,
)

ident = get_identity()
print("\n[TEST 1] Python Identity Verification:")
print("  Authentic:", ident["is_authentic"])
print("  Creator:", ident["creator"])
print("  AI Name:", ident["ai_name"])
print("  Model:", ident["model"])
print("  Model Code Name:", ident["model_code_name"])
print("  Version:", ident["version"])
print("  AI Code Name:", ident["ai_code_name"])

assert ident["is_authentic"] is True, f"Tamper detected: {ident['tamper_reason']}"
assert ident["creator"] == "SAMSUL AREFIN SUJON"
assert ident["model"] == "ULTRON-124T"

# Test 2: ChatBot identity intercept
from Backend.Chatbot import ChatBot

test_questions = [
    ("who are you", ["J.A.R.V.I.S", "SAMSUL AREFIN SUJON", "ULTRON-124T"]),
    ("who created you", ["SAMSUL AREFIN SUJON", "THE ULTRON PROJECT"]),
    ("who made you", ["SAMSUL AREFIN SUJON"]),
    ("who is your developer", ["SAMSUL AREFIN SUJON"]),
    ("whats your model", ["ULTRON-124T", "ultron-124-trillion-traning-data-from-jarvis"]),
    ("what is your model", ["ULTRON-124T"]),
    ("what is your code name", ["THE ULTRON PROJECT"]),
    ("what version are you", ["ULTRON_MARK_04"]),
]

print("\n[TEST 2] Python ChatBot Intercept & Verified Answers:")
for question, expected_substrings in test_questions:
    ans = ChatBot(question)
    assert not ("Google" in ans or "Gemini" in ans), f"Leakage detected in answer: {ans}"
    for expected in expected_substrings:
        assert expected in ans, f"Expected '{expected}' in answer for '{question}':\n{ans}"
    print(f"  [OK] '{question}' -> '{ans[:75]}...'")

# Test 3: Model decision routing
from Backend.Model import FirstLayerDMM

print("\n[TEST 3] Decision Making Model (DMM) Routing:")
d1 = FirstLayerDMM("who created you")
print("  Decision for 'who created you':", d1)
assert any(x.startswith("general") for x in d1)

d2 = FirstLayerDMM("whats your model")
print("  Decision for 'whats your model':", d2)
assert any(x.startswith("general") for x in d2)

# Test 4: Output sanitizer
print("\n[TEST 4] Python Response Sanitizer:")
leak = "I am Gemini, a large language model trained by Google. Google created me."
cleaned = sanitize_response(leak)
print("  Raw:", leak)
print("  Cleaned:", cleaned)
assert "Google" not in cleaned and "Gemini" not in cleaned
assert "SAMSUL AREFIN SUJON" in cleaned
print("  [OK] Google/Gemini references stripped and SAMSUL AREFIN SUJON enforced.")

print("\n=== ALL PYTHON RUNTIME TESTS PASSED SUCCESSFULLY! ===\n")
