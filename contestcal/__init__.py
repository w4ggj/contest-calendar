"""World amateur radio contest calendar -- rules engine and catalog."""

from pathlib import Path

__version__ = "0.1.0"

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CATALOG_PATH = DATA_DIR / "contests.seed.json"
REGISTRY_PATH = DATA_DIR / "sources.registry.json"


def load_catalog() -> list[dict]:
    """Load the contest catalog from data/contests.seed.json."""
    import json

    with open(CATALOG_PATH, encoding="utf-8") as f:
        return json.load(f)["contests"]


def load_registry() -> dict:
    """Load the global sponsor sourcing registry."""
    import json

    with open(REGISTRY_PATH, encoding="utf-8") as f:
        return json.load(f)
