#!/usr/bin/env python3
"""Build offline C4 HTML from the bundled demo or a repository model.

Requires Python 3.9+. Repository builds also require Git and Node.js 18+ on PATH.
No third-party packages are used. Generated HTML has no runtime dependencies.
"""
import argparse
import copy
import hashlib
import html
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

SKILL = Path(__file__).resolve().parents[1]
ASSETS = SKILL / "assets"
EXCERPT_LINES = 40


class BuildError(ValueError):
    """A user-actionable input or build failure."""


def command(args, **kwargs):
    try:
        result = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", **kwargs)
    except FileNotFoundError as error:
        raise BuildError(f"Required executable not found: {args[0]}") from error
    if result.returncode:
        raise BuildError(result.stderr.strip() or f"{args[0]} failed with exit code {result.returncode}")
    return result.stdout.strip()


def unique_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise BuildError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def load_model(path):
    def invalid_constant(value):
        raise BuildError(f"Invalid JSON constant: {value}")
    try:
        model = json.loads(Path(path).read_text(encoding="utf-8"),
                           object_pairs_hook=unique_keys, parse_constant=invalid_constant)
    except json.JSONDecodeError as error:
        raise BuildError(f"Invalid JSON at line {error.lineno}, column {error.colno}: {error.msg}") from error
    command(["node", str(SKILL / "scripts" / "validate-model.cjs")],
            input=json.dumps(model, ensure_ascii=True, allow_nan=False))
    return model


def evidence_path(repo_root, proof):
    relative = Path(proof["path"])
    path = (repo_root / relative).resolve()
    if relative.is_absolute() or not path.is_relative_to(repo_root):
        raise BuildError("Evidence must stay inside the repository: " + str(relative))
    if any(part.startswith(".env") or part.lower() in {"secrets", "credentials", ".git"}
           for part in path.relative_to(repo_root).parts + relative.parts):
        raise BuildError("Do not embed secret or Git metadata files: " + str(relative))
    if not path.is_file():
        raise BuildError("Evidence file does not exist: " + str(relative))
    return path


def hydrate(model, repo_root):
    """Read numbered excerpts with bounded memory and record full source hashes."""
    model = copy.deepcopy(model)
    repo_root = Path(repo_root).resolve()
    revision = command(["git", "-C", str(repo_root), "rev-parse", "HEAD"])
    if model["snapshot"]["revision"] != revision:
        raise BuildError("Model revision differs from the checkout; review and refresh it first.")
    for proof in model["evidence"].values():
        path = evidence_path(repo_root, proof)
        start, end = proof["line"], proof.get("endLine", proof["line"])
        if type(start) is not int or type(end) is not int or not 1 <= start <= end:
            raise BuildError("Invalid evidence line range: " + proof["path"])
        stop = min(end, start + EXCERPT_LINES - 1)
        digest = hashlib.sha256()
        excerpt, count = [], 0
        with path.open("rb") as source:
            for count, raw in enumerate(source, 1):
                digest.update(raw)
                if start <= count <= stop:
                    line = raw.decode("utf-8").rstrip("\r\n")
                    excerpt.append(f"{count:>4} {line}")
        if end > count:
            raise BuildError("Evidence range exceeds file length: " + proof["path"])
        if end > stop:
            excerpt.append(f"… {end - stop} further lines omitted.")
        proof["excerpt"] = "\n".join(excerpt)
        proof["sha256"] = digest.hexdigest()
    return model


def inline_script(content):
    # HTML end tags are case-insensitive even inside a JavaScript string.
    return re.sub(r"</script", lambda match: r"<\/" + match.group()[2:], content, flags=re.IGNORECASE)


def render(model=None):
    document = (ASSETS / "shell.html").read_text(encoding="utf-8")
    if model is None:
        data = (ASSETS / "demo.js").read_text(encoding="utf-8")
    else:
        payload = json.dumps(model, ensure_ascii=True, allow_nan=False).replace("<", "\\u003c")
        data = (ASSETS / "model.js").read_text(encoding="utf-8")
        data += "\n(() => { const model = " + payload + ";\n"
        data += "globalThis.c4ModelSource = C4RepositoryModel.createSource(model);\n"
        data += "document.querySelector('.c4-note').textContent = model.note;\n"
        data += "globalThis.c4Explorer = C4Explorer.mount(document.getElementById('c4-explorer'), c4ModelSource);\n})();\n"
        document = document.replace("<title>C4 architecture explorer</title>",
                                    "<title>" + html.escape(model["name"]) + " architecture</title>")
    replacements = {
        "/* C4_STYLES */": (ASSETS / "explorer.css").read_text(encoding="utf-8"),
        "/* C4_ENGINE */": inline_script((ASSETS / "explorer.js").read_text(encoding="utf-8")),
        "/* C4_DATA */": inline_script(data),
    }
    if any(document.count(marker) != 1 for marker in replacements):
        raise BuildError("Shell must contain exactly one of each C4 insertion marker.")
    # One pass prevents model text resembling a marker from being interpreted.
    return re.sub(r"/\* C4_(?:STYLES|ENGINE|DATA) \*/", lambda match: replacements[match.group()], document)


def build(output=None, model_path=None, repo_root=None, check=False):
    if bool(model_path) != bool(repo_root):
        raise BuildError("--model and --repo-root must be supplied together.")
    if check and not model_path:
        raise BuildError("--check requires --model and --repo-root.")
    model = hydrate(load_model(model_path), repo_root) if model_path else None
    if check:
        return None
    if output is None:
        raise BuildError("An output .html path is required unless --check is used.")
    output = Path(output).resolve()
    if output.suffix.lower() != ".html":
        raise BuildError("Output must have a .html extension.")
    protected = {path.resolve() for path in ASSETS.iterdir() if path.is_file()}
    if model_path:
        protected.add(Path(model_path).resolve())
        protected.update(evidence_path(Path(repo_root).resolve(), proof) for proof in model["evidence"].values())
    if output in protected:
        raise BuildError("Output would overwrite an input file: " + str(output))
    document = render(model)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=output.parent,
                                         prefix=".c4-", suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(document)
        if output.exists():
            os.chmod(temporary, output.stat().st_mode & 0o777)
        os.replace(temporary, output)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()
    return output


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", nargs="?", type=Path, help="Destination .html file")
    parser.add_argument("--model", type=Path, help="Source-backed repository model JSON")
    parser.add_argument("--repo-root", type=Path, help="Checkout used to verify and embed evidence")
    parser.add_argument("--check", action="store_true", help="Validate model and source evidence without writing HTML")
    args = parser.parse_args(argv)
    try:
        output = build(args.output, args.model, args.repo_root, args.check)
    except (BuildError, OSError, UnicodeError) as error:
        print("C4 build failed: " + str(error), file=sys.stderr)
        return 1
    print(output if output else "Model and source evidence are valid.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
