"""Tests for scripts/rebiosys-pull-e2ee. Stdlib-only (unittest) — no pytest,
no new installs; the file has no .py-importable name so it is loaded by path
via importlib. Run with:

    python3 -m unittest scripts.rebiosys_pull_e2ee_test -v

(from the repo root) or directly:

    python3 scripts/rebiosys_pull_e2ee_test.py
"""
import importlib.util
import json
import subprocess
import unittest
from importlib.machinery import SourceFileLoader
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
SCRIPT_PATH = HERE / "rebiosys-pull-e2ee"

# The script has no .py suffix (matches the live rebiosys-pull naming
# convention), so spec_from_file_location can't infer a loader from the
# extension — hand it an explicit SourceFileLoader instead.
_loader = SourceFileLoader("rebiosys_pull_e2ee", str(SCRIPT_PATH))
spec = importlib.util.spec_from_loader("rebiosys_pull_e2ee", _loader)
assert spec
mod = importlib.util.module_from_spec(spec)
_loader.exec_module(mod)  # module __name__ != "__main__", so main() does not auto-run


class ProcessRecordTests(unittest.TestCase):
    def test_legacy_plaintext_record_passes_through_unchanged(self):
        rec = {"id": "abc", "kind": "query", "email": "a@example.com", "text": "hi"}
        out = mod.process_record(rec, private_key_b64="whatever", decrypt=lambda *_: self.fail("should not decrypt"))
        self.assertEqual(out, rec)

    def test_envelope_decrypts_successfully(self):
        rec = {"id": "abc", "kind": "query", "ciphertext_envelope": {"v": 1}}

        def fake_decrypt(envelope, key):
            self.assertEqual(envelope, {"v": 1})
            self.assertEqual(key, "the-key")
            return {"name": "Ada", "text": "decrypted text"}

        out = mod.process_record(rec, private_key_b64="the-key", decrypt=fake_decrypt)
        self.assertTrue(out["e2ee"])
        self.assertEqual(out["name"], "Ada")
        self.assertEqual(out["text"], "decrypted text")
        self.assertNotIn("ciphertext_envelope", out)
        self.assertNotIn("undecryptable", out)

    def test_envelope_decrypt_failure_is_kept_as_undecryptable(self):
        rec = {"id": "abc", "kind": "query", "ciphertext_envelope": {"v": 1}}

        def raising_decrypt(envelope, key):
            raise RuntimeError("cli_unseal: wrong key")

        out = mod.process_record(rec, private_key_b64="the-key", decrypt=raising_decrypt)
        self.assertTrue(out["undecryptable"])
        self.assertIn("wrong key", out["error"])
        # record is kept, not dropped
        self.assertEqual(out["id"], "abc")

    def test_envelope_with_no_private_key_is_undecryptable_not_dropped(self):
        rec = {"id": "abc", "kind": "query", "ciphertext_envelope": {"v": 1}}
        out = mod.process_record(rec, private_key_b64=None)
        self.assertTrue(out["undecryptable"])
        self.assertEqual(out["id"], "abc")
        self.assertIn("no rebiosys-e2ee private key", out["error"])


class NodeCliWiringTest(unittest.TestCase):
    """Real end-to-end check that decrypt_envelope's subprocess wiring to
    the Node CLI actually works — generates a fresh keypair + envelope via
    the real relay-crypto code (through tsx) and decrypts it through
    scripts.rebiosys-pull-e2ee's decrypt_envelope(), no fakes."""

    def test_decrypt_envelope_round_trip_via_real_node_cli(self):
        tsx_bin = REPO_ROOT / "node_modules" / ".bin" / "tsx"
        if not tsx_bin.exists():
            self.skipTest("workspace tsx binary not installed (run pnpm install)")

        gen_script = REPO_ROOT / "packages" / "relay-crypto" / "src" / "_test_gen_envelope.mts"
        gen_script.write_text(
            "import { generateKeyPair, seal } from \"./sealed_box.js\";\n"
            "const { publicJwk, privatePkcs8Base64 } = await generateKeyPair();\n"
            "const envelope = await seal(publicJwk, new TextEncoder().encode(JSON.stringify({ text: \"python wiring check\" })));\n"
            "process.stdout.write(JSON.stringify({ envelope, privateKey: privatePkcs8Base64 }));\n"
        )
        try:
            proc = subprocess.run(
                [str(tsx_bin), str(gen_script)],
                capture_output=True, text=True, timeout=30, cwd=str(REPO_ROOT),
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            fixture = json.loads(proc.stdout)
        finally:
            gen_script.unlink(missing_ok=True)

        plaintext = mod.decrypt_envelope(fixture["envelope"], fixture["privateKey"])
        self.assertEqual(plaintext, {"text": "python wiring check"})

    def test_decrypt_envelope_raises_on_wrong_key(self):
        tsx_bin = REPO_ROOT / "node_modules" / ".bin" / "tsx"
        if not tsx_bin.exists():
            self.skipTest("workspace tsx binary not installed (run pnpm install)")
        # A syntactically plausible but wrong base64 blob: decrypt_envelope
        # must raise (not silently return garbage) so process_record can
        # mark the record undecryptable.
        bogus_envelope = {"v": 1, "alg": "ECDH-ES+A256GCM", "epk": {}, "iv": "AAAAAAAAAAAAAAAA", "ct": "AAAA"}
        with self.assertRaises(Exception):
            mod.decrypt_envelope(bogus_envelope, "not-a-real-key")


if __name__ == "__main__":
    unittest.main()
