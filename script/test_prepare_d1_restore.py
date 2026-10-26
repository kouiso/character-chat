import hashlib
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest


spec = importlib.util.spec_from_file_location(
    "prepare_d1_restore", Path(__file__).with_name("prepare-d1-restore.py")
)
restore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore)


class RestoreStatisticsTest(unittest.TestCase):
    def test_restores_rows_and_rebuilds_index_statistics(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.sql"
            destination = Path(directory) / "restored.sql"
            with sqlite3.connect(":memory:") as original:
                original.executescript(
                    "CREATE TABLE item(id INTEGER PRIMARY KEY, category TEXT);"
                    "CREATE INDEX item_category ON item(category);"
                    "INSERT INTO item VALUES(1, 'a'), (2, 'a'), (3, 'b');"
                    "ANALYZE;"
                )
                source.write_text("\n".join(original.iterdump()), encoding="utf-8")
                expected_rows = original.execute("SELECT * FROM item ORDER BY id").fetchall()
                expected_stats = original.execute(
                    "SELECT tbl, idx, stat FROM sqlite_stat1 ORDER BY tbl, idx"
                ).fetchall()
            restore.prepare(source, destination, hashlib.sha256(source.read_bytes()).hexdigest())
            with sqlite3.connect(":memory:") as restored:
                restored.executescript(destination.read_text(encoding="utf-8"))
                self.assertEqual(
                    restored.execute("SELECT * FROM item ORDER BY id").fetchall(), expected_rows
                )
                self.assertEqual(
                    restored.execute(
                        "SELECT tbl, idx, stat FROM sqlite_stat1 ORDER BY tbl, idx"
                    ).fetchall(),
                    expected_stats,
                )
                self.assertEqual(restored.execute("PRAGMA integrity_check").fetchone(), ("ok",))


if __name__ == "__main__":
    unittest.main()
