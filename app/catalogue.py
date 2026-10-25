"""The form's questions, read from static/questions.json (the same file the form page uses).

This module checks submissions against it, decides which answers need a manager's
attention, and turns stored values back into English labels for the admin portal.
"""
import json
import re
from pathlib import Path

PATH = Path(__file__).resolve().parent / "static" / "questions.json"
DATA = json.loads(PATH.read_text(encoding="utf-8"))

BRANCHES: dict[str, str] = {b["id"]: b["name"] for b in DATA["branches"]}
OPTION_SETS: dict[str, list[dict]] = DATA["optionSets"]
SERVICES: dict[str, str] = {o["value"]: o["en"] for o in OPTION_SETS["services"]}
QUESTIONS: list[dict] = DATA["questions"]
BY_KEY: dict[str, dict] = {q["key"]: q for q in QUESTIONS}
# Keys that hold an answer in `responses.answers` (branch and service have their own columns).
ANSWER_KINDS = ("stars", "choice", "multi")
ANSWER_KEYS = [q["key"] for q in QUESTIONS if q["kind"] in ANSWER_KINDS]
STEP_NAMES = {0: "Visit", 1: "Review", 2: "Optional"}

PHONE_RE = re.compile(r"^(03\d{9}|923\d{9})$")


class SubmissionError(ValueError):
    """A submission that does not match the questions."""


def _ordered(answers: dict) -> list[str]:
    return [v for v in answers.get("items") or [] if v != "other"]


def options(q: dict, answers: dict | None = None) -> list[dict]:
    """The options a customer could pick, given their earlier answers."""
    spec = q.get("options")
    if spec is None:
        return []
    if isinstance(spec, list):
        return spec
    if spec == "@ordered":
        menu = [o for o in OPTION_SETS["menu"] if o["value"] != "other"]
        if answers is None:
            return menu
        picked = set(_ordered(answers))
        return [o for o in menu if o["value"] in picked]
    return OPTION_SETS[spec[1:]]


def visible(q: dict, answers: dict) -> bool:
    """Mirror of the form's rule check (isVisible in form.js)."""
    w = q.get("when") or {}
    if "service" in w and answers.get("service") not in w["service"]:
        return False
    if "ordered_any" in w and not set(w["ordered_any"]) & set(answers.get("items") or []):
        return False
    if "ordered_min" in w and len(_ordered(answers)) < w["ordered_min"]:
        return False
    for key, allowed in (w.get("answer") or {}).items():
        if answers.get(key) not in allowed:
            return False
    return True


def title(q: dict, service: str | None = None) -> str:
    if "titleByService" in q:
        return q["titleByService"].get(service or "", {}).get("en", "")
    return q["title"]["en"]


def label(q: dict, value) -> str:
    """English text for a stored answer."""
    if value is None:
        return ""
    if q["kind"] == "stars":
        return f"{value}/5"
    labels = {o["value"]: o["en"] for o in options(q)}
    if isinstance(value, list):
        return ", ".join(labels.get(v, v) for v in value)
    return labels.get(value, value)


def clean(raw: dict) -> dict:
    """Check a submission's answers and return them in question order.

    Answers to questions the customer could not have seen are dropped, so a
    customer who switched from delivery to dine-in leaves no delivery answers.
    """
    unknown = set(raw) - set(ANSWER_KEYS) - {"branch", "service"}
    if unknown:
        raise SubmissionError(f"Unknown question '{sorted(unknown)[0]}'.")
    branch, service = raw.get("branch"), raw.get("service")
    if branch not in BRANCHES:
        raise SubmissionError("Please choose your branch.")
    if service not in SERVICES:
        raise SubmissionError("Please choose how you got your order.")

    answers: dict = {"branch": branch, "service": service}
    for q in QUESTIONS:
        key = q["key"]
        if q["kind"] not in ANSWER_KINDS or key not in raw or not visible(q, answers):
            continue
        value = raw[key]
        allowed = {o["value"] for o in options(q, answers)}
        if q["kind"] == "stars":
            if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 5:
                raise SubmissionError(f"'{title(q)}' needs 1 to 5 stars.")
        elif q["kind"] == "choice":
            if not isinstance(value, str) or value not in allowed:
                raise SubmissionError(f"Pick one of the listed answers for '{title(q)}'.")
        else:
            if (not isinstance(value, list) or not value or len(set(value)) != len(value)
                    or any(not isinstance(v, str) or v not in allowed for v in value)):
                raise SubmissionError(f"Pick from the listed answers for '{title(q)}'.")
        answers[key] = value

    for q in QUESTIONS:
        if q.get("required") and q["kind"] in ANSWER_KINDS and visible(q, answers) and q["key"] not in answers:
            raise SubmissionError(f"Please answer: {title(q)}")
    del answers["branch"], answers["service"]
    return answers


def would_return(answers: dict) -> str | None:
    value = answers.get("dine_again") or answers.get("order_again") or answers.get("takeaway_again")
    return {"definitely": "yes", "maybe": "maybe", "no": "no", "probably_not": "no"}.get(value)


# What makes a response "needs attention": any of these answers.
ATTENTION_RULES: list[tuple[str, object, str]] = [
    ("food", lambda v: v <= 2, "Food rated {v}/5"),
    ("staff_welcome", lambda v: v <= 2, "Staff welcome rated {v}/5"),
    ("cleanliness", lambda v: v <= 2, "Cleanliness rated {v}/5"),
    ("packaging_neat", lambda v: v <= 2, "Packaging rated {v}/5"),
    ("food_time", lambda v: v == "over_30", "Food took over 30 minutes"),
    ("ambiance", lambda v: v == "needs_improvement", "Ambiance needs improvement"),
    ("on_time", lambda v: v == "very_late", "Delivery very late"),
    ("arrived_hot", lambda v: v == "cold", "Food arrived cold"),
    ("delivery_complete", lambda v: v == "missing_items", "Items missing from order"),
    ("takeaway_complete", lambda v: v == "no", "Order incomplete"),
    ("rider_behaviour", lambda v: v == "poor", "Rider behaviour poor"),
    ("greeted_politely", lambda v: v == "no", "Staff not polite"),
    ("ready_on_arrival", lambda v: v == "no", "Order not ready on arrival"),
]


def issues(answers: dict) -> list[str]:
    found = [msg.format(v=answers[key]) for key, bad, msg in ATTENTION_RULES
             if key in answers and bad(answers[key])]
    if would_return(answers) == "no":
        found.append("Would not come back")
    return found


def valid_phone(phone: str | None) -> bool:
    return bool(PHONE_RE.match(re.sub(r"\D", "", phone or "")))
