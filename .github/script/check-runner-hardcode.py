import re
import sys
from pathlib import Path

try:
    import yaml
    from yaml.nodes import MappingNode, ScalarNode, SequenceNode
except ImportError:
    sys.exit("runner-hardcode-guard: PyYAML が必要です。.github/script/README.md のセットアップを実行してください")


RUNNER = re.compile(r"\b(?:(?:ubuntu|macos|windows)-[a-zA-Z0-9._-]+|blacksmith-[a-zA-Z0-9._-]+)")
EXPRESSION = re.compile(r"\$\{\{((?:'(?:''|[^'])*'|(?!\}\})[^'])*)\}\}", re.DOTALL)
RUNNER_VARIABLE = re.compile(r"^\s*vars\.RUNNER_[A-Z0-9_]+(?:\s*\|\|\s*'[^']*')?\s*$")
MATRIX_REFERENCE = re.compile(
    r"'(?:''|[^'])*'|(?<![\w-])(matrix)\b(?!-)((?:\s*\.\s*[a-zA-Z_][a-zA-Z0-9_-]*|\s*\[\s*'[^']+'\s*\])*)",
    re.IGNORECASE,
)
MATRIX_KEY = re.compile(r"\.\s*([a-zA-Z_][a-zA-Z0-9_-]*)|\[\s*'([^']+)'\s*\]")
MATRIX_ERROR = "runner の matrix 参照を静的に検査できません。固定プロパティか vars.RUNNER_* を使ってください"


def pairs(node):
    return node.value if isinstance(node, MappingNode) else []


def child(node, key):
    return next((value for name, value in pairs(node) if name.value == key), None)


def scalars(node, seen=None):
    if node is None:
        return
    seen = set() if seen is None else seen
    if id(node) in seen:
        raise ValueError("runner の循環エイリアスは検査できません")
    seen = seen | {id(node)}
    if isinstance(node, ScalarNode):
        yield node
    elif isinstance(node, SequenceNode):
        for value in node.value:
            yield from scalars(value, seen)
    elif isinstance(node, MappingNode):
        for _, value in node.value:
            yield from scalars(value, seen)


def select(node, path, seen=None):
    if node is None:
        return
    seen = set() if seen is None else seen
    if (id(node), path) in seen:
        raise ValueError(MATRIX_ERROR)
    seen = seen | {(id(node), path)}
    if not path:
        yield node
    elif isinstance(node, SequenceNode):
        for value in node.value:
            yield from select(value, path, seen)
    elif isinstance(node, MappingNode):
        for key, value in pairs(node):
            if key.value.casefold() == path[0].casefold():
                yield from select(value, path[1:], seen)
    else:
        raise ValueError(MATRIX_ERROR)


def runner_nodes(job):
    runner = child(job, "runs-on")
    yield "runs-on", runner
    matrix = child(child(job, "strategy"), "matrix")
    paths = set()
    for scalar in scalars(runner):
        for expression in EXPRESSION.finditer(scalar.value):
            for reference in MATRIX_REFERENCE.finditer(expression[1]):
                if reference[1] is not None:
                    if expression[1][:reference.start()].rstrip().endswith("."):
                        continue
                    tail = expression[1][reference.end():].lstrip()
                    if not reference[2] or tail.startswith(("[", ".")):
                        raise ValueError(MATRIX_ERROR)
                    path = tuple((dot or index).casefold() for dot, index in MATRIX_KEY.findall(reference[2]))
                    if any(key.isdecimal() for key in path):
                        raise ValueError(MATRIX_ERROR)
                    paths.add(path)
    # image/tag など、runner 選択に使わない軸は検査しない。
    for path in sorted(paths):
        if not isinstance(matrix, MappingNode):
            raise ValueError(MATRIX_ERROR)
        selected_nodes = []
        for node in (matrix, child(matrix, "include")):
            selected_nodes.extend(select(node, path))
        if not selected_nodes:
            raise ValueError(MATRIX_ERROR)
        for selected in selected_nodes:
            yield "strategy.matrix." + ".".join(path), selected


def violations(source):
    # 行単位の検索では複数行配列とアンカーの参照先を検査できない。
    root = yaml.compose(source, Loader=yaml.SafeLoader)
    if not isinstance(root, MappingNode):
        raise ValueError("ワークフローのルートはマッピングである必要があります")
    jobs = child(root, "jobs")
    if not isinstance(jobs, MappingNode):
        raise ValueError("jobs がありません")
    found = []
    for job_name, job in pairs(jobs):
        for field, node in runner_nodes(job):
            for scalar in scalars(node):
                if field.startswith("strategy.matrix.") and any(
                    not RUNNER_VARIABLE.fullmatch(expression[1])
                    for expression in EXPRESSION.finditer(scalar.value)
                ):
                    raise ValueError(MATRIX_ERROR)
                bare = EXPRESSION.sub(
                    lambda match: "" if RUNNER_VARIABLE.fullmatch(match[1]) else match[0],
                    scalar.value,
                )
                if RUNNER.search(bare):
                    found.append((scalar.start_mark.line + 1, job_name.value, field))
    return found


def main():
    directory = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".github/workflows")
    files = sorted({*directory.glob("*.yml"), *directory.glob("*.yaml")})
    if not files:
        print(f"::error::検査対象のワークフローがありません: {directory}")
        return 1
    errors = 0
    for path in files:
        try:
            found = violations(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, yaml.YAMLError) as error:
            print(f"::error file={path}::ワークフローを解析できません: {error}")
            errors += 1
            continue
        for line, job, field in found:
            print(f"::error file={path},line={line}::{job}.{field}: runner直書きは禁止。vars.RUNNER_* 経由で指定してください")
        errors += len(found)
    print(f"runner-hardcode-guard: errors={errors}")
    return int(errors > 0)


if __name__ == "__main__":
    sys.exit(main())
