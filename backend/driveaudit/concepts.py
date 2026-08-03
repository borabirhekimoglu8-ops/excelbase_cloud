"""Formal Concept Analysis over the folder's spreadsheets.

Association rules answer "these columns often appear together" heuristically.
FCA answers the same question exactly: from the file-by-column matrix it
derives every *closed* set of columns -- every group that is precisely the
shared vocabulary of some set of files -- and nothing else. Nothing is
sampled, nothing is thresholded away except by a support floor the caller
chooses, and there is no arrangement it can miss.

That exactness is why it is worth the trouble here. Each closed set is a
candidate record type: "these 6 columns are what 34 of your files have in
common" is a claim that can be checked by counting, not a suggestion someone
has to trust.

Still no model, still nothing leaving the machine: this reads the header names
the scanner already collected, never a cell.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# The lattice of a real folder can be large. These bound the work; both are
# generous next to any folder a person actually maintains.
MAX_CONCEPTS = 4_000
MAX_ATTRIBUTES = 120


@dataclass(frozen=True, slots=True)
class Signature:
    """One distinct header row, and how many files carry it."""

    columns: frozenset[str]
    files: int
    #: The folder these files sit in, if they share one. It is the operator's
    #: own word for this kind of record, which beats any name derived from
    #: column headers -- see ``name_for``.
    folder: str = ""


@dataclass(frozen=True, slots=True)
class Concept:
    """A closed column set and the number of files sharing it.

    ``intent`` is exactly the columns common to those files, and ``support``
    is how many files that is. Closed means no column can be added without
    losing a file -- which is what makes it a candidate record type rather
    than an arbitrary subset.
    """

    intent: frozenset[str]
    support: int

    @property
    def size(self) -> int:
        return len(self.intent)


@dataclass(slots=True)
class EntityProposal:
    """A record type the folder implies, with the evidence for it."""

    name: str
    columns: list[str]
    files: int
    #: Columns of this entity the application has no place for.
    missing: list[str] = field(default_factory=list)
    suggestion: str = ""

    def as_dict(self) -> dict:
        return {
            "name": self.name,
            "columns": list(self.columns),
            "files": self.files,
            "missing": list(self.missing),
            "suggestion": self.suggestion,
        }


def concepts(signatures: list[Signature], min_support: int = 2) -> list[Concept]:
    """Every closed column set holding for at least ``min_support`` files.

    Computed by intersecting header rows until the set of intersections stops
    growing, which yields exactly the intents of the concept lattice. Files
    with identical headers are collapsed into one signature first, so the work
    scales with the number of distinct templates -- a few dozen -- rather than
    with the number of files, which may be thousands.
    """
    if not signatures:
        return []

    # An enormous vocabulary is almost always a sign of free-text headers; the
    # rarest columns are dropped first because they carry the least evidence.
    frequency: dict[str, int] = {}
    for signature in signatures:
        for column in signature.columns:
            frequency[column] = frequency.get(column, 0) + signature.files
    allowed = frozenset(
        name for name, _count in
        sorted(frequency.items(), key=lambda item: item[1], reverse=True)[:MAX_ATTRIBUTES]
    )

    trimmed = [
        Signature(
            columns=signature.columns & allowed,
            files=signature.files,
            folder=signature.folder,
        )
        for signature in signatures
        if signature.columns & allowed
    ]
    if not trimmed:
        return []

    def support_of(intent: frozenset[str]) -> int:
        return sum(item.files for item in trimmed if intent <= item.columns)

    # The cap is checked while seeding as well as while expanding: a folder
    # with more distinct templates than the cap would otherwise blow straight
    # past it before the loop ever runs.
    seen: set[frozenset[str]] = set()
    queue: list[frozenset[str]] = []
    for signature in sorted(trimmed, key=lambda item: item.files, reverse=True):
        if len(seen) >= MAX_CONCEPTS:
            break
        if signature.columns not in seen:
            seen.add(signature.columns)
            queue.append(signature.columns)

    while queue and len(seen) < MAX_CONCEPTS:
        current = queue.pop()
        for signature in trimmed:
            candidate = current & signature.columns
            if candidate and candidate not in seen:
                seen.add(candidate)
                queue.append(candidate)

    found = [
        Concept(intent=intent, support=support_of(intent))
        for intent in seen
    ]
    # Largest first, and among equals the one backed by more files: a record
    # type with more fields says more than the trivial one-column concept.
    return sorted(
        (concept for concept in found if concept.support >= min_support and concept.size >= 1),
        key=lambda concept: (concept.size, concept.support),
        reverse=True,
    )


def distinctive_concepts(all_concepts: list[Concept], limit: int = 8) -> list[Concept]:
    """Drop concepts that say nothing their neighbours do not.

    The lattice contains every intersection, including many that are simply a
    smaller version of a bigger one holding for the same files. Keeping those
    would bury the handful of real record types under dozens of shadows.
    """
    kept: list[Concept] = []
    for concept in all_concepts:
        if concept.size < 2:
            continue
        redundant = any(
            concept.intent < other.intent and concept.support == other.support
            for other in kept
        )
        if redundant:
            continue
        kept.append(concept)
        if len(kept) >= limit:
            break
    return kept


def folder_for(intent: frozenset[str], signatures: list[Signature]) -> str:
    """The folder that best accounts for a record type.

    A concept can be shared by templates living in different folders, so the
    one backed by the most files wins rather than whichever was seen first.
    """
    weights: dict[str, int] = {}
    for signature in signatures:
        if signature.folder and intent <= signature.columns:
            weights[signature.folder] = weights.get(signature.folder, 0) + signature.files
    if not weights:
        return ""
    return max(sorted(weights), key=lambda name: weights[name])


def name_for(intent: frozenset[str], known: frozenset[str], folder: str = "") -> str:
    """A human label for a record type.

    The operator's folder name is used when there is one: they already named
    this kind of record when they filed it, and "Satış" reads as a record type
    where "Adet · Hat · Tutar" reads as a list of spare parts. That name also
    travels into the instruction handed to the development agent, so it is
    worth more than a mechanical one.

    Without a folder -- files loose at the root -- the columns are all there
    is, and preference goes to one the application does not already know: what
    makes this record type different from the passenger list is exactly the
    thing worth naming it after.
    """
    if folder:
        return folder
    novel = sorted(column for column in intent if column not in known)
    ordered = novel or sorted(intent)
    return " · ".join(part.title() for part in ordered[:3])


def propose_entities(
    signatures: list[Signature],
    known_columns: frozenset[str],
    original_case: dict[str, str] | None = None,
    min_support: int = 3,
) -> list[EntityProposal]:
    """Record types the folder implies, ready to hand to the operator."""
    labels = original_case or {}

    def display(column: str) -> str:
        return labels.get(column, column)

    proposals: list[EntityProposal] = []
    taken: set[str] = set()
    for concept in distinctive_concepts(concepts(signatures, min_support=min_support)):
        columns = [display(column) for column in sorted(concept.intent)]
        missing = [display(column) for column in sorted(concept.intent - known_columns)]
        name = name_for(concept.intent, known_columns, folder_for(concept.intent, signatures))
        # Two record types can share a folder, and then they would share a
        # name -- indistinguishable on screen, and two instructions that read
        # as one. The columns break the tie, which is what they are for.
        if name in taken:
            name = f"{name} · {name_for(concept.intent, known_columns)}"
        taken.add(name)
        proposals.append(EntityProposal(
            name=name,
            columns=columns,
            files=concept.support,
            missing=missing,
            suggestion=(
                f"Uygulamaya '{name}' adında bir kayıt tipi ekle. "
                f"Alanlar: {', '.join(columns)}. Liste, filtre, Excel içe/dışa aktarma olsun."
            ),
        ))
    return proposals
