import os
import runpy
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("check-runner-hardcode.py")
violations = runpy.run_path(str(SCRIPT))["violations"]


class RunnerGuardTest(unittest.TestCase):
    def test_direct_runner_syntaxes(self):
        for value in (
            "ubuntu-latest",
            '"macos-latest" # comment',
            "windows-2022",
            "blacksmith-4vcpu-ubuntu-2404",
            "[self-hosted, ubuntu-24.04]",
            "\n      - self-hosted\n      - ubuntu-latest",
            "{labels: [ubuntu-latest]}",
            "${{ 'ubuntu-latest' }}",
        ):
            with self.subTest(value=value):
                self.assertTrue(violations(f"jobs:\n  build:\n    runs-on: {value}\n"))

    def test_matrix_syntaxes(self):
        for matrix in (
            "{runner: [ubuntu-latest, macos-latest]}",
            "\n        runner:\n          - ubuntu-latest",
            "\n        include:\n          - runner: windows-latest",
        ):
            with self.subTest(matrix=matrix):
                source = "jobs:\n  build:\n    runs-on: ${{ matrix.runner }}\n    strategy:\n      matrix: " + matrix
                self.assertTrue(violations(source))

    def test_unrelated_matrix_values_are_allowed(self):
        source = """
jobs:
  build:
    runs-on: ${{ vars.RUNNER_LINUX || 'ubuntu-latest' }}
    strategy:
      matrix:
        image: [ubuntu-latest]
        tag: [windows-latest]
        include:
          - container: macos-latest
    steps:
      - run: echo "${{ matrix.image }}"
"""
        self.assertEqual(violations(source), [])

    def test_referenced_nested_matrix_value_only(self):
        for reference in (
            "matrix.target.runner",
            "matrix['target']['runner']",
            "MATRIX.TARGET.RUNNER",
            "matrix['TARGET']['RUNNER']",
            "matrix . target . runner",
        ):
            source = """
jobs:
  build:
    runs-on: ${{ REFERENCE }}
    strategy:
      matrix:
        target:
          - runner: self-hosted
            image: ubuntu-latest
        include:
          - target:
              runner: RUNNER_VALUE
              image: windows-latest
""".replace("REFERENCE", reference)
            with self.subTest(reference=reference):
                self.assertEqual(violations(source.replace("RUNNER_VALUE", "self-hosted")), [])
                found = violations(source.replace("RUNNER_VALUE", "macos-latest"))
                self.assertEqual(len(found), 1)
                self.assertEqual(found[0][2], "strategy.matrix.target.runner")

    def test_dynamic_matrix_references_fail_closed(self):
        for reference in ("matrix[matrix.axis]", "join(matrix.*, '')", "toJSON(matrix)", "matrix.runner[0]"):
            with self.subTest(reference=reference):
                with self.assertRaisesRegex(ValueError, "matrix"):
                    violations("jobs:\n  build:\n    runs-on: ${{ " + reference + " }}\n")

    def test_expression_delimiter_in_string(self):
        source = """
jobs:
  build:
    runs-on: ${{ format('{0}{1}', '', matrix['}}']) }}
    strategy:
      matrix:
        '}}': [ubuntu-latest]
"""
        self.assertEqual(len(violations(source)), 1)

    def test_expression_valued_matrix_fails_closed(self):
        for matrix in (
            "${{ fromJSON('{\"runner\":[\"ubuntu-latest\"]}') }}",
            "${{ needs.prepare.outputs.matrix }}",
            "\n        include: ${{ fromJSON('[{\"runner\":\"ubuntu-latest\"}]') }}",
        ):
            with self.subTest(matrix=matrix), self.assertRaisesRegex(ValueError, "matrix"):
                violations("jobs:\n  build:\n    runs-on: ${{ matrix.runner }}\n    strategy:\n      matrix: " + matrix)

    def test_quoted_numeric_index_fails_closed(self):
        for index in ("'0'", "'1'", "0"):
            with self.subTest(index=index), self.assertRaisesRegex(ValueError, "matrix"):
                violations(
                    "jobs:\n  build:\n    runs-on: ${{ matrix.runner[" + index + "] }}\n"
                    "    strategy:\n      matrix:\n        runner: [ubuntu-latest]\n"
                )

    def test_expression_valued_selected_axis_fails_closed(self):
        for value in ("${{ fromJSON(needs.prepare.outputs.runners) }}", "${{ needs.prepare.outputs.runner }}"):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "matrix"):
                violations(
                    "jobs:\n  build:\n    runs-on: ${{ matrix.runner }}\n"
                    "    strategy:\n      matrix:\n        runner: " + value + "\n"
                )

    def test_recursive_runner_aliases_fail_closed(self):
        for source in (
            "jobs:\n  build:\n    runs-on: &loop [*loop]\n",
            "jobs:\n  build:\n    runs-on: ${{ matrix.runner }}\n"
            "    strategy:\n      matrix:\n        runner: &loop [*loop]\n",
        ):
            with self.subTest(source=source), self.assertRaisesRegex(ValueError, "循環"):
                violations(source)

    def test_reused_non_recursive_alias_is_allowed(self):
        self.assertEqual(violations(
            "x-label: &label self-hosted\njobs:\n  build:\n    runs-on: [*label, *label]\n"
        ), [])

    def test_matrix_named_properties_in_other_contexts_are_allowed(self):
        for reference in ("vars.MATRIX", "vars . MATRIX", "vars['MATRIX']", "inputs.matrix.runner"):
            with self.subTest(reference=reference):
                self.assertEqual(violations("jobs:\n  build:\n    runs-on: ${{ " + reference + " || 'self-hosted' }}\n"), [])

    def test_unresolvable_selected_path_fails_closed(self):
        for target in ("${{ fromJSON('{}') }}", "&loop [*loop]", "{image: self-hosted}"):
            with self.subTest(target=target), self.assertRaisesRegex(ValueError, "matrix"):
                violations(
                    "jobs:\n  build:\n    runs-on: ${{ matrix.target.runner }}\n"
                    "    strategy:\n      matrix:\n        target: " + target + "\n"
                )

    def test_variables_and_comments_are_allowed(self):
        source = """
jobs:
  build:
    runs-on: ${{ matrix.runner }}
    strategy:
      matrix:
        runner:
          - ${{ vars.RUNNER_LINUX || 'ubuntu-latest' }}
          - ${{ vars.RUNNER_LINUX_4VCPU || 'blacksmith-4vcpu-ubuntu-2404' }}
    # runs-on: macos-latest
    steps:
      - run: echo ubuntu-latest
  other:
    runs-on: ${{ vars.RUNNER_LINUX }}
"""
        self.assertEqual(violations(source), [])

    def test_alias_and_folded_scalar(self):
        source = """
x-runner: &runner
  - ubuntu-latest
jobs:
  build:
    runs-on: *runner
  other:
    runs-on: >-
      windows-latest
"""
        self.assertEqual(len(violations(source)), 2)

    def test_cli_fails_closed_and_reports_line(self):
        with tempfile.TemporaryDirectory() as directory:
            def run():
                return subprocess.run(
                    ["bash", str(SCRIPT.with_suffix(".sh")), directory],
                    env={**os.environ, "PATH": str(Path(sys.executable).parent) + os.pathsep + os.environ["PATH"]},
                    capture_output=True, text=True,
                )

            self.assertEqual(run().returncode, 1)
            path = Path(directory) / "ci.yaml"
            path.write_text("jobs:\n  build:\n    runs-on: ubuntu-latest\n")
            result = run()
            self.assertEqual(result.returncode, 1)
            self.assertIn("line=3", result.stdout)
            path.write_text("jobs: [")
            self.assertEqual(run().returncode, 1)
            path.write_text("jobs:\n  build:\n    runs-on: ${{ vars.RUNNER_LINUX }}\n")
            self.assertEqual(run().returncode, 0)

    def test_missing_parser_fails_closed(self):
        result = subprocess.run([sys.executable, "-S", str(SCRIPT)], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("PyYAML", result.stderr)


if __name__ == "__main__":
    unittest.main()
