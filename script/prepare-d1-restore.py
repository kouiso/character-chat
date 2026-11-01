"""D1の外部キー検査を保ったまま復元できる順序へ並べ直す。"""
import argparse
import graphlib
import hashlib
import os
from pathlib import Path
import re
import sqlite3


def prepare(source: Path, destination: Path, expected_sha256: str) -> dict:
    contents = source.read_bytes()
    if hashlib.sha256(contents).hexdigest() != expected_sha256:
        raise ValueError("Backup digest mismatch")
    database = sqlite3.connect(":memory:")
    database.executescript(contents.decode("utf-8"))
    if database.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise ValueError("Source integrity check failed")
    if database.execute("PRAGMA foreign_key_check").fetchall():
        raise ValueError("Source has foreign key violations")

    tables = [row[0] for row in database.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    )]
    dependencies = {}
    for table in tables:
        escaped = table.replace('"', '""')
        dependencies[table] = set()
        for foreign_key in database.execute(f'PRAGMA foreign_key_list("{escaped}")'):
            column = foreign_key[3].replace('"', '""')
            populated = database.execute(
                f'SELECT EXISTS(SELECT 1 FROM "{escaped}" WHERE "{column}" IS NOT NULL)'
            ).fetchone()[0]
            if populated:
                dependencies[table].add(foreign_key[2])
    try:
        order = list(graphlib.TopologicalSorter(dependencies).static_order())
    except graphlib.CycleError as error:
        raise ValueError("Cyclic foreign keys require a reviewed restore strategy") from error

    definitions, inserts, remaining, sequence = [], {}, [], []
    for statement in database.iterdump():
        if statement in ("BEGIN TRANSACTION;", "COMMIT;"):
            continue
        if statement.startswith("CREATE TABLE"):
            definitions.append(statement)
        elif statement.startswith('DELETE FROM "sqlite_sequence"'):
            sequence.append(statement)
        elif statement.startswith("INSERT INTO"):
            match = re.match(r'INSERT INTO "((?:[^"]|"")+)"', statement)
            if not match:
                raise ValueError("Unexpected dump statement")
            table = match.group(1).replace('""', '"')
            if table == "sqlite_sequence":
                sequence.append(statement)
            else:
                inserts.setdefault(table, []).append(statement)
        else:
            remaining.append(statement)

    rows = {table: len(inserts.get(table, [])) for table in tables}
    statements = ["PRAGMA defer_foreign_keys=ON;", *definitions]
    for table in order:
        statements.extend(inserts.get(table, []))
    statements.extend(sequence)
    statements.extend(remaining)
    if "sqlite_stat1" in inserts:
        statements.append("ANALYZE;")
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        output.write("\n".join(statements) + "\n")
    database.close()
    return {"tables": len(tables), "rows": sum(rows.values()), "output_bytes": destination.stat().st_size}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--sha256", required=True)
    arguments = parser.parse_args()
    print(prepare(arguments.source, arguments.destination, arguments.sha256))
