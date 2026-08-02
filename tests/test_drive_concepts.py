"""Tests for the concept analysis over folder headers.

The point of using FCA rather than a heuristic is exactness, so these check
the properties that make it exact: every closed set is found, nothing that is
not closed is reported, and support is counted over files rather than over
distinct templates.
"""

from __future__ import annotations

from backend.driveaudit.concepts import (
    Concept,
    Signature,
    concepts,
    distinctive_concepts,
    name_for,
    propose_entities,
)


def signature(columns: str, files: int = 1) -> Signature:
    return Signature(columns=frozenset(columns.split()), files=files)


def test_a_shared_column_set_is_found_with_the_files_behind_it():
    # Two templates overlap on {ad, pasaport}; that intersection is a concept
    # holding for every file of both.
    found = concepts([
        signature("ad pasaport acente", files=10),
        signature("ad pasaport tutar", files=6),
    ], min_support=2)

    shared = next(c for c in found if c.intent == frozenset({"ad", "pasaport"}))
    assert shared.support == 16


def test_support_counts_files_not_templates():
    # One template used 40 times must outweigh three used once each; counting
    # templates would rank the rare arrangement first.
    found = concepts([
        signature("ad pasaport", files=40),
        signature("fis tutar", files=1),
    ], min_support=1)

    by_intent = {c.intent: c.support for c in found}
    assert by_intent[frozenset({"ad", "pasaport"})] == 40
    assert by_intent[frozenset({"fis", "tutar"})] == 1


def test_every_reported_set_is_actually_closed():
    # A closed set is exactly the shared columns of the files holding it: if
    # another column is present in all of them, the set was not closed.
    signatures = [
        signature("a b c", files=3),
        signature("a b d", files=4),
        signature("a e", files=2),
    ]
    found = concepts(signatures, min_support=1)

    for concept in found:
        holders = [s for s in signatures if concept.intent <= s.columns]
        common = frozenset.intersection(*[s.columns for s in holders])
        assert concept.intent == common, f"{set(concept.intent)} kapalı değil"


def test_a_set_below_the_support_floor_is_not_reported():
    found = concepts([
        signature("ad pasaport", files=10),
        signature("fis tutar", files=1),
    ], min_support=5)

    assert all(concept.support >= 5 for concept in found)
    assert not any("fis" in concept.intent for concept in found)


def test_an_empty_folder_yields_nothing_rather_than_failing():
    assert concepts([], min_support=2) == []


def test_distinctive_drops_a_shadow_of_a_bigger_concept():
    # {a,b} holding for exactly the same files as {a,b,c} says nothing extra;
    # keeping it would bury the real record types under near-duplicates.
    kept = distinctive_concepts([
        Concept(intent=frozenset({"a", "b", "c"}), support=10),
        Concept(intent=frozenset({"a", "b"}), support=10),
        Concept(intent=frozenset({"x", "y"}), support=4),
    ])

    intents = [concept.intent for concept in kept]
    assert frozenset({"a", "b", "c"}) in intents
    assert frozenset({"a", "b"}) not in intents
    assert frozenset({"x", "y"}) in intents


def test_a_single_column_is_not_a_record_type():
    kept = distinctive_concepts([Concept(intent=frozenset({"ad"}), support=99)])
    assert kept == []


def test_a_record_type_is_named_after_what_makes_it_different():
    # Naming it "Ad · Pasaport" would describe the passenger list the app
    # already has; the novel column is what distinguishes this one.
    known = frozenset({"ad", "pasaport"})
    assert name_for(frozenset({"ad", "pasaport", "komisyon"}), known) == "Komisyon"


def test_proposals_carry_the_columns_the_app_cannot_hold():
    proposals = propose_entities(
        [signature("ad pasaport komisyon acente", files=12)],
        known_columns=frozenset({"ad", "pasaport"}),
        min_support=3,
    )

    assert proposals
    proposal = proposals[0]
    assert proposal.files == 12
    assert set(proposal.missing) == {"acente", "komisyon"}
    assert "komisyon" in proposal.suggestion


def test_proposals_use_the_operator_s_own_spelling():
    # The analysis folds headers to compare them; what comes back out has to
    # be what the operator wrote, or the suggestion reads as gibberish.
    proposals = propose_entities(
        [signature("ad pasaport komisyon", files=5)],
        known_columns=frozenset({"ad", "pasaport"}),
        original_case={"komisyon": "Komisyon Tutarı", "ad": "Ad Soyad"},
        min_support=3,
    )

    assert "Komisyon Tutarı" in proposals[0].columns
    assert "Ad Soyad" in proposals[0].columns


def test_a_wide_folder_stays_bounded(monkeypatch):
    # A folder of free-text headers would otherwise build a lattice with no
    # end; the caps have to hold rather than the scan hanging.
    monkeypatch.setattr("backend.driveaudit.concepts.MAX_CONCEPTS", 50)
    signatures = [
        Signature(columns=frozenset(f"c{i}" for i in range(index, index + 12)), files=2)
        for index in range(60)
    ]

    found = concepts(signatures, min_support=1)

    assert len(found) <= 50
