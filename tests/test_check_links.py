"""check_links.classify: a down host is not a pile of broken links."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from check_links import classify  # noqa: E402


def _t(*pairs):
    return [(cid, "S", url) for cid, url in pairs]


def test_whole_host_connection_failure_is_unreachable_not_broken():
    targets = _t(("a", "https://down.example/1"), ("b", "https://down.example/2"))
    status = {"https://down.example/1": "URLError", "https://down.example/2": "TimeoutError"}
    ok, broken, unreachable = classify(targets, status)
    assert broken == [] and ok == []
    assert len(unreachable["down.example"]) == 2


def test_http_error_is_broken_even_if_it_is_the_only_page_on_the_host():
    ok, broken, unreachable = classify(
        _t(("a", "https://up.example/1")), {"https://up.example/1": 404}
    )
    assert [r[0] for r in broken] == ["a"] and unreachable == {}


def test_host_that_answers_elsewhere_keeps_its_connection_failures_as_broken():
    targets = _t(("a", "https://mixed.example/1"), ("b", "https://mixed.example/2"))
    status = {"https://mixed.example/1": 200, "https://mixed.example/2": "URLError"}
    ok, broken, unreachable = classify(targets, status)
    assert [r[0] for r in ok] == ["a"] and [r[0] for r in broken] == ["b"]
    assert unreachable == {}
