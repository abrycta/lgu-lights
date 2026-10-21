"""`python -m lgu <command>`; `python -m lgu sources <archivekit command>` fills in the registry."""
from __future__ import annotations

import sys


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args:
        print(__doc__)
        return 2
    cmd, rest = args[0], args[1:]
    if cmd == "sources":
        from archivekit.cli import main as kit_main

        from .paths import REGISTRY_PATH
        if rest and "--registry" not in rest:
            rest = [rest[0], "--registry", str(REGISTRY_PATH), *rest[1:]]
        return int(kit_main(rest) or 0)
    from . import cli
    return cli.run(cmd, rest)


if __name__ == "__main__":
    sys.exit(main())
