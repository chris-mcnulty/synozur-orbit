"""Repackage the existing private recovery without changing its contact payload."""
import hashlib
import pathlib
import re
import zipfile

root = pathlib.Path("recovery-private")
original = (root / "synozur-outreach-recovery.sql").read_text()
old = "LEFT JOIN markets m ON m.id = p->>'market_id' AND m.tenant_domain = 'synozur.com'"
new = """LEFT JOIN markets m ON m.id = p->>'market_id'
      AND m.tenant_id IN (SELECT id FROM tenants WHERE domain = 'synozur.com')"""
assert original.count(old) == 1
corrected = original.replace(old, new)
corrected = re.sub(r"^BEGIN;\n", "", corrected, flags=re.M)
corrected = re.sub(r"^COMMIT;\n", "-- END OF RECOVERY BATCH\n", corrected, flags=re.M)
payload = r"\$orbit_recovery_payload\$([\s\S]*?)\$orbit_recovery_payload\$"
assert re.search(payload, original)[1] == re.search(payload, corrected)[1]
output = root / "outreach-recovery-console.sql"
output.write_text(corrected)
output.chmod(0o600)
readme = """PRIVATE DATA: do not share or publish.
This replaces the earlier recovery package.
Market ownership now uses markets.tenant_id -> tenants.id/domain.
No standalone BEGIN/COMMIT: the SQL console must wrap ALL statements in ONE batch transaction.
Keep BEGIN/END inside DO blocks. Select the entire file and run as one batch.
Do not execute individual statements.
Expected result: Recovery ready, 266 prospects, 40 touches.
Sending and consent remain held for review. Production has not been changed by preparing this file.
"""
archive = root / "outreach-recovery-console.zip"
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
    z.write(output, output.name)
    z.writestr("README.txt", readme)
archive.chmod(0o600)
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert z.read(output.name) == output.read_bytes()
print(f"Validated archive: {archive}; SQL bytes: {output.stat().st_size}; SHA256: {hashlib.sha256(output.read_bytes()).hexdigest()}")