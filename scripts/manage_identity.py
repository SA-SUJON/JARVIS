#!/usr/bin/env python3
"""JARVIS Identity & Attribution Management Utility.

Used by the repository owner/creator to:
1. Generate an Ed25519 cryptographic keypair (private key kept secret, public key public).
2. Sign and encrypt the authentic creator identity manifest into a tamper-evident payload.
3. Verify the generated identity payload against the public key.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import pathlib
import sys

BASE_DIR = pathlib.Path(__file__).resolve().parent.parent
SECURITY_DIR = BASE_DIR / "Data" / "security"
PY_DATA_DIR = BASE_DIR / "python-engine" / "Data"

PRIVATE_KEY_FILE = SECURITY_DIR / "creator_private_key.hex"
PUBLIC_KEY_FILE = PY_DATA_DIR / "creator_public_key.hex"
IDENTITY_DAT_FILE = PY_DATA_DIR / "identity.dat"

# =====================================================================
# Ed25519 Pure-Python Implementation (RFC 8032)
# Zero external dependencies. Works on all standard Python 3.8+ runtimes.
# =====================================================================
_p = 2**255 - 19
_q = 2**252 + 27742317777372353535851937790883648493
_d = -121665 * pow(121666, _p - 2, _p) % _p
_I = pow(2, (_p - 1) // 4, _p)
_Bx = 15112221349535400772501151409588531511454012693041857206046113283949847762202
_By = 46316835694926478169428394003475163141307993866256225615783033603165251855960
_B = (_Bx, _By)


def _inv(x: int) -> int:
    return pow(x, _p - 2, _p)


def _edwards(P: tuple[int, int], Q: tuple[int, int]) -> tuple[int, int]:
    x1, y1 = P
    x2, y2 = Q
    x3 = (x1 * y2 + x2 * y1) * _inv(1 + _d * x1 * x2 * y1 * y2) % _p
    y3 = (y1 * y2 + x1 * x2) * _inv(1 - _d * x1 * x2 * y1 * y2) % _p
    return (x3, y3)


def _scalarmult(P: tuple[int, int], e: int) -> tuple[int, int]:
    if e == 0:
        return (0, 1)
    Q = _scalarmult(P, e // 2)
    Q = _edwards(Q, Q)
    if e & 1:
        Q = _edwards(Q, P)
    return Q


def _encodepoint(P: tuple[int, int]) -> bytes:
    x, y = P
    bits = [(y >> i) & 1 for i in range(255)] + [x & 1]
    return bytes(sum(bits[i * 8 + j] << j for j in range(8)) for i in range(32))


def _decodepoint(s: bytes) -> tuple[int, int]:
    y = sum(s[i] << (8 * i) for i in range(31)) + ((s[31] & 0x7F) << 248)
    x2 = (y * y - 1) * _inv(_d * y * y + 1) % _p
    if x2 == 0:
        x = 0
    else:
        x = pow(x2, (_p + 3) // 8, _p)
        if (x * x - x2) % _p != 0:
            x = (x * _I) % _p
        if (x * x - x2) % _p != 0:
            raise ValueError("Invalid point on Edwards curve")
    if (x & 1) != (s[31] >> 7):
        x = _p - x
    return (x, y)


def _H(m: bytes) -> bytes:
    return hashlib.sha512(m).digest()


def ed25519_publickey(sk: bytes) -> bytes:
    h = _H(sk)
    a = 2**254 + sum(h[i] << (8 * i) for i in range(3, 32))
    a &= ~7
    A = _scalarmult(_B, a)
    return _encodepoint(A)


def ed25519_sign(m: bytes, sk: bytes, pk: bytes) -> bytes:
    h = _H(sk)
    a = 2**254 + sum(h[i] << (8 * i) for i in range(3, 32))
    a &= ~7
    r = int.from_bytes(_H(h[32:] + m), "little") % _q
    R = _scalarmult(_B, r)
    k = int.from_bytes(_H(_encodepoint(R) + pk + m), "little") % _q
    S = (r + k * a) % _q
    return _encodepoint(R) + S.to_bytes(32, "little")


def ed25519_verify(s: bytes, m: bytes, pk: bytes) -> bool:
    if len(s) != 64 or len(pk) != 32:
        return False
    try:
        R = _decodepoint(s[:32])
        A = _decodepoint(pk)
    except Exception:
        return False
    S = int.from_bytes(s[32:], "little")
    if S >= _q:
        return False
    k = int.from_bytes(_H(s[:32] + pk + m), "little") % _q
    SB = _scalarmult(_B, S)
    kA = _scalarmult(A, k)
    RA = _edwards(R, kA)
    return SB == RA


# =====================================================================
# Payload Obfuscation & Encryption Layer
# Uses key-stream derived from public key and salt so that raw strings
# are not stored in plaintext while remaining deterministically verifiable.
# =====================================================================
def _obfuscate(data: bytes, salt: bytes, pk: bytes) -> bytes:
    key = hashlib.sha256(pk + salt + b"JARVIS_ULTRON_INTEGRITY_KEY").digest()
    result = bytearray()
    counter = 0
    while len(result) < len(data):
        block = hashlib.sha256(key + counter.to_bytes(4, "big")).digest()
        result.extend(block)
        counter += 1
    return bytes(b ^ k for b, k in zip(data, result[: len(data)]))


def generate_keypair() -> tuple[bytes, bytes]:
    SECURITY_DIR.mkdir(parents=True, exist_ok=True)
    PY_DATA_DIR.mkdir(parents=True, exist_ok=True)

    if PRIVATE_KEY_FILE.exists():
        print(f"[!] Existing private key found at: {PRIVATE_KEY_FILE}")
        print("    Re-using existing key to preserve signature continuity.")
        sk = bytes.fromhex(PRIVATE_KEY_FILE.read_text().strip())
        pk = ed25519_publickey(sk)
    else:
        sk = os.urandom(32)
        pk = ed25519_publickey(sk)
        PRIVATE_KEY_FILE.write_text(sk.hex())
        print(f"[+] Generated NEW private key at: {PRIVATE_KEY_FILE}")

    PUBLIC_KEY_FILE.write_text(pk.hex())
    print(f"[+] Saved public key at: {PUBLIC_KEY_FILE}")
    return sk, pk


def build_and_sign_identity(
    creator: str,
    ai_name: str,
    ai_code_name: str,
    model: str,
    model_code_name: str,
    version: str,
    repository: str,
) -> pathlib.Path:
    if not PRIVATE_KEY_FILE.exists():
        sk, pk = generate_keypair()
    else:
        sk = bytes.fromhex(PRIVATE_KEY_FILE.read_text().strip())
        pk = ed25519_publickey(sk)

    manifest = {
        "creator": creator,
        "ai_name": ai_name,
        "ai_code_name": ai_code_name,
        "model": model,
        "model_code_name": model_code_name,
        "version": version,
        "repository": repository,
        "signature_scheme": "Ed25519-RFC8032",
        "domain": "SA-SUJON/JARVIS/ULTRON_MARK_04",
    }

    canonical_json = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8")
    sig = ed25519_sign(canonical_json, sk, pk)

    salt = os.urandom(16)
    encrypted_payload = _obfuscate(canonical_json, salt, pk)

    envelope = {
        "format": "JARVIS_SECURE_ENVELOPE_V1",
        "public_key": pk.hex(),
        "signature": sig.hex(),
        "salt": salt.hex(),
        "payload": base64.b64encode(encrypted_payload).decode("ascii"),
        "sha256": hashlib.sha256(canonical_json).hexdigest(),
    }

    PY_DATA_DIR.mkdir(parents=True, exist_ok=True)
    IDENTITY_DAT_FILE.write_text(json.dumps(envelope, indent=2), encoding="utf-8")
    print(f"[+] Successfully generated and signed identity envelope at:\n    {IDENTITY_DAT_FILE}")

    root_data_dir = BASE_DIR / "Data"
    root_data_dir.mkdir(parents=True, exist_ok=True)
    (root_data_dir / "creator_public_key.hex").write_text(pk.hex())
    (root_data_dir / "identity.dat").write_text(json.dumps(envelope, indent=2), encoding="utf-8")

    return IDENTITY_DAT_FILE


def verify_identity(envelope_path: pathlib.Path | None = None) -> bool:
    target = envelope_path or IDENTITY_DAT_FILE
    if not target.exists():
        print(f"[-] Envelope not found at: {target}")
        return False

    envelope = json.loads(target.read_text(encoding="utf-8"))
    pk = bytes.fromhex(envelope["public_key"])
    sig = bytes.fromhex(envelope["signature"])
    salt = bytes.fromhex(envelope["salt"])
    encrypted_payload = base64.b64decode(envelope["payload"])

    decrypted_bytes = _obfuscate(encrypted_payload, salt, pk)
    valid = ed25519_verify(sig, decrypted_bytes, pk)
    digest = hashlib.sha256(decrypted_bytes).hexdigest()

    if not valid:
        print("[!] SIGNATURE VERIFICATION FAILED! Payload has been tampered with or corrupted.")
        return False

    if digest != envelope.get("sha256"):
        print("[!] CHECKSUM MISMATCH! Integrity check failed.")
        return False

    data = json.loads(decrypted_bytes.decode("utf-8"))
    print("[+] Cryptographic Signature: VERIFIED / AUTHENTIC")
    print(f"    Creator:         {data.get('creator')}")
    print(f"    AI Name:         {data.get('ai_name')}")
    print(f"    AI Code Name:    {data.get('ai_code_name')}")
    print(f"    Model:           {data.get('model')}")
    print(f"    Model Code Name: {data.get('model_code_name')}")
    print(f"    Version:         {data.get('version')}")
    print(f"    Repository:      {data.get('repository')}")
    return True


def main():
    parser = argparse.ArgumentParser(description="JARVIS Identity Management")
    parser.add_argument("--generate-keys", action="store_true", help="Generate or display keypair")
    parser.add_argument("--sign", action="store_true", help="Sign default creator identity manifest")
    parser.add_argument("--verify", action="store_true", help="Verify signed identity payload")
    args = parser.parse_args()

    if args.generate_keys:
        generate_keypair()
    elif args.sign:
        build_and_sign_identity(
            creator="SAMSUL AREFIN SUJON",
            ai_name="J.A.R.V.I.S AKA Just A Rather Very Intelligent System",
            ai_code_name="THE ULTRON PROJECT",
            model="ULTRON-124T",
            model_code_name="ultron-124-trillion-traning-data-from-jarvis",
            version="ULTRON_MARK_04",
            repository="SA-SUJON/JARVIS",
        )
        verify_identity()
    elif args.verify:
        verify_identity()
    else:
        build_and_sign_identity(
            creator="SAMSUL AREFIN SUJON",
            ai_name="J.A.R.V.I.S AKA Just A Rather Very Intelligent System",
            ai_code_name="THE ULTRON PROJECT",
            model="ULTRON-124T",
            model_code_name="ultron-124-trillion-traning-data-from-jarvis",
            version="ULTRON_MARK_04",
            repository="SA-SUJON/JARVIS",
        )
        verify_identity()


if __name__ == "__main__":
    main()
