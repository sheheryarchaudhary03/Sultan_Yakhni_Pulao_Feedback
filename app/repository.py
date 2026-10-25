"""All SQL for responses and the dashboard. Every query is parameterised."""
import secrets
from datetime import datetime
from zoneinfo import ZoneInfo

import psycopg
from psycopg.types.json import Jsonb

from . import catalogue
from .catalogue import SubmissionError
from .config import settings
from .db import pool
from .schemas import FeedbackIn, Filters

_REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
STAR_KEYS = [q["key"] for q in catalogue.QUESTIONS if q["kind"] == "stars"]


# ------------------------------------------------------------- submission
def _new_reference() -> str:
    day = datetime.now(ZoneInfo(settings.timezone)).strftime("%y%m%d")
    return f"SYP-{day}-" + "".join(secrets.choice(_REF_ALPHABET) for _ in range(5))


def create_response(payload: FeedbackIn, ip_hash: str | None, user_agent: str | None) -> str:
    answers = catalogue.clean(payload.answers)
    wants_offers = answers.get("offers") == "yes"
    if wants_offers and not catalogue.valid_phone(payload.phone):
        raise SubmissionError("Enter your mobile number to get offers, like 0300 1234567.")
    found = catalogue.issues(answers)
    row = (
        payload.answers["branch"], payload.answers["service"], payload.language, answers["food"],
        catalogue.would_return(answers), bool(found), Jsonb(found), Jsonb(answers), wants_offers,
        payload.name if wants_offers else None, payload.phone if wants_offers else None,
        payload.other_item if "other" in (answers.get("items") or []) else None,
        payload.comments, ip_hash, (user_agent or "")[:500] or None,
    )
    with pool.connection() as conn:
        for attempt in range(5):
            ref = _new_reference()
            try:
                with conn.transaction():
                    conn.execute(
                        "INSERT INTO responses (reference_code, branch, service, language, food_rating, "
                        " would_return, needs_attention, issues, answers, wants_offers, customer_name, "
                        " customer_phone, other_item, comments, ip_hash, user_agent) "
                        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                        (ref, *row),
                    )
                return ref
            except psycopg.errors.UniqueViolation:
                if attempt == 4:
                    raise
    raise RuntimeError("unreachable")


# ---------------------------------------------------------------- filters
def _where(f: Filters) -> tuple[str, list]:
    clauses, args = ["TRUE"], []
    if f.date_from:
        clauses.append("r.submitted_at >= (%s::date)::timestamp AT TIME ZONE %s")
        args += [f.date_from, settings.timezone]
    if f.date_to:
        clauses.append("r.submitted_at < (%s::date + 1)::timestamp AT TIME ZONE %s")
        args += [f.date_to, settings.timezone]
    if f.branch:
        clauses.append("r.branch = %s")
        args.append(f.branch)
    if f.service:
        clauses.append("r.service = %s")
        args.append(f.service)
    if f.q:
        like = "%" + f.q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        clauses.append(
            "(r.reference_code ILIKE %s OR r.customer_name ILIKE %s OR r.customer_phone ILIKE %s"
            " OR r.comments ILIKE %s OR r.other_item ILIKE %s OR r.admin_note ILIKE %s)"
        )
        args += [like] * 6
    if f.status:
        clauses.append("r.status = %s")
        args.append(f.status)
    if f.attention:
        clauses.append("r.needs_attention")
    if f.offers:
        clauses.append("r.wants_offers")
    return " AND ".join(clauses), args


def _named(row: dict) -> dict:
    row["branch_name"] = catalogue.BRANCHES.get(row["branch"], row["branch"])
    row["service_name"] = catalogue.SERVICES.get(row["service"], row["service"])
    return row


def _pct(part: int, whole: int) -> int | None:
    return round(100 * part / whole) if whole else None


# --------------------------------------------------------------- dashboard
def stats(f: Filters) -> dict:
    where, args = _where(f)
    with pool.connection() as conn:
        s = conn.execute(
            "SELECT count(*) AS total, round(avg(r.food_rating)::numeric, 2) AS avg_food, "
            "  count(r.would_return) AS return_n, "
            "  count(*) FILTER (WHERE r.would_return = 'yes') AS return_yes, "
            "  count(*) FILTER (WHERE r.needs_attention) AS attention, "
            "  count(*) FILTER (WHERE r.needs_attention AND r.status = 'new') AS attention_open, "
            "  count(*) FILTER (WHERE r.status = 'new') AS unreviewed, "
            "  count(*) FILTER (WHERE r.wants_offers) AS offers "
            f"FROM responses r WHERE {where}",
            args,
        ).fetchone()
        food = {r["v"]: r["n"] for r in conn.execute(
            f"SELECT r.food_rating AS v, count(*) AS n FROM responses r WHERE {where} GROUP BY 1", args
        )}
        services = {r["v"]: r["n"] for r in conn.execute(
            f"SELECT r.service AS v, count(*) AS n FROM responses r WHERE {where} GROUP BY 1", args
        )}
        branches = {r["branch"]: r for r in conn.execute(
            "SELECT r.branch, count(*) AS n, round(avg(r.food_rating)::numeric, 2) AS avg_food, "
            "  count(r.would_return) AS return_n, count(*) FILTER (WHERE r.would_return = 'yes') AS return_yes, "
            "  count(*) FILTER (WHERE r.needs_attention) AS attention "
            f"FROM responses r WHERE {where} GROUP BY r.branch",
            args,
        )}
        star_sql = ", ".join(
            f"round(avg((r.answers->>%s)::numeric), 2) AS a{i}, count(r.answers->%s) AS n{i}"
            for i in range(len(STAR_KEYS))
        )
        star_args = [k for k in STAR_KEYS for _ in (0, 1)]
        stars = conn.execute(f"SELECT {star_sql} FROM responses r WHERE {where}", star_args + args).fetchone()

    branch_ids = [f.branch] if f.branch else list(catalogue.BRANCHES) + [b for b in branches if b not in catalogue.BRANCHES]
    by_branch = []
    for b in branch_ids:
        r = branches.get(b) or {"n": 0, "avg_food": None, "return_n": 0, "return_yes": 0, "attention": 0}
        by_branch.append({
            "branch": b, "name": catalogue.BRANCHES.get(b, b), "total": r["n"],
            "avg_food": float(r["avg_food"]) if r["avg_food"] is not None else None,
            "return_pct": _pct(r["return_yes"], r["return_n"]), "attention": r["attention"],
        })
    by_branch.sort(key=lambda x: -x["total"])
    return {
        "total": s["total"],
        "avg_food": float(s["avg_food"]) if s["avg_food"] is not None else None,
        "return_pct": _pct(s["return_yes"], s["return_n"]),
        "return_n": s["return_n"],
        "attention": s["attention"],
        "attention_open": s["attention_open"],
        "unreviewed": s["unreviewed"],
        "offers": s["offers"],
        "food_dist": [{"value": v, "n": food.get(v, 0)} for v in (5, 4, 3, 2, 1)],
        "by_service": [{"value": v, "label": name, "n": services.get(v, 0)} for v, name in catalogue.SERVICES.items()],
        "by_branch": by_branch,
        "star_questions": [
            {"key": k, "title": catalogue.title(catalogue.BY_KEY[k]),
             "avg": float(stars[f"a{i}"]) if stars[f"a{i}"] is not None else None, "n": stars[f"n{i}"]}
            for i, k in enumerate(STAR_KEYS)
        ],
    }


def breakdown(f: Filters, key: str) -> dict | None:
    q = catalogue.BY_KEY.get(key)
    if q is None or q["kind"] not in catalogue.ANSWER_KINDS:
        return None
    where, args = _where(f)
    with pool.connection() as conn:
        respondents = conn.execute(
            f"SELECT count(*) AS n FROM responses r WHERE {where} AND r.answers ? %s", args + [key]
        ).fetchone()["n"]
        if q["kind"] == "multi":
            rows = conn.execute(
                "SELECT x AS v, count(*) AS n FROM responses r CROSS JOIN LATERAL jsonb_array_elements_text("
                "  CASE WHEN jsonb_typeof(r.answers->%s) = 'array' THEN r.answers->%s ELSE '[]'::jsonb END) AS x "
                f"WHERE {where} GROUP BY 1",
                [key, key] + args,
            ).fetchall()
        else:
            rows = conn.execute(
                f"SELECT r.answers->>%s AS v, count(*) AS n FROM responses r WHERE {where} AND r.answers ? %s GROUP BY 1",
                [key] + args + [key],
            ).fetchall()
    counts = {r["v"]: r["n"] for r in rows}
    if q["kind"] == "stars":
        items = [{"value": str(v), "label": f"{v} stars" if v > 1 else "1 star", "n": counts.get(str(v), 0)}
                 for v in (5, 4, 3, 2, 1)]
    else:
        items = [{"value": o["value"], "label": o["en"], "n": counts.pop(o["value"], 0)} for o in catalogue.options(q)]
        items += [{"value": v, "label": v, "n": n} for v, n in counts.items()]  # retired options
    return {"key": key, "title": catalogue.title(q), "kind": q["kind"], "respondents": respondents, "items": items}


# --------------------------------------------------------------- responses
SORTS = {
    "newest": "r.submitted_at DESC",
    "oldest": "r.submitted_at ASC",
    "food_low": "r.food_rating ASC, r.submitted_at DESC",
    "food_high": "r.food_rating DESC, r.submitted_at DESC",
}
_LIST_COLUMNS = (
    "r.id, r.reference_code, r.submitted_at, r.branch, r.service, r.language, r.food_rating, "
    "r.would_return, r.needs_attention, r.issues, r.status, r.customer_name, r.customer_phone, "
    "r.wants_offers, r.comments, r.other_item, r.admin_note"
)


def list_responses(f: Filters, page: int, page_size: int, sort: str) -> dict:
    where, args = _where(f)
    with pool.connection() as conn:
        total = conn.execute(f"SELECT count(*) AS n FROM responses r WHERE {where}", args).fetchone()["n"]
        rows = conn.execute(
            f"SELECT {_LIST_COLUMNS} FROM responses r WHERE {where} "
            f"ORDER BY {SORTS.get(sort, SORTS['newest'])} LIMIT %s OFFSET %s",
            args + [page_size, (page - 1) * page_size],
        ).fetchall()
    return {"total": total, "page": page, "page_size": page_size, "items": [_named(r) for r in rows]}


def answer_sections(answers: dict, service: str) -> list[dict]:
    """Answers grouped the way the form shows them, with English labels."""
    sections: list[dict] = [{"title": "Review", "rows": []}]
    for q in catalogue.QUESTIONS:
        if q["step"] == 0 or q["kind"] == "text":
            continue
        if q["kind"] == "group":
            sections.append({"title": catalogue.title(q, service), "rows": []})
            continue
        if q["key"] in answers:
            sections[-1]["rows"].append({"key": q["key"], "title": catalogue.title(q),
                                         "value": catalogue.label(q, answers[q["key"]])})
    return [s for s in sections if s["rows"]]


def response_detail(response_id: str) -> dict | None:
    with pool.connection() as conn:
        r = conn.execute(
            f"SELECT {_LIST_COLUMNS}, r.answers, r.updated_at FROM responses r WHERE r.id = %s", (response_id,)
        ).fetchone()
    if r is None:
        return None
    r["sections"] = answer_sections(r.pop("answers"), r["service"])
    return _named(r)


def update_response(response_id: str, status: str | None, note: str | None, set_note: bool) -> bool:
    sets, args = [], []
    if status is not None:
        sets.append("status = %s")
        args.append(status)
    if set_note:
        sets.append("admin_note = %s")
        args.append(note or None)
    if not sets:
        return True
    with pool.connection() as conn:
        cur = conn.execute(f"UPDATE responses SET {', '.join(sets)} WHERE id = %s", args + [response_id])
        return cur.rowcount == 1


def export_rows(f: Filters, limit: int = 50_000) -> list[dict]:
    where, args = _where(f)
    with pool.connection() as conn:
        rows = conn.execute(
            f"SELECT {_LIST_COLUMNS}, r.answers FROM responses r WHERE {where} "
            "ORDER BY r.submitted_at DESC LIMIT %s",
            args + [limit],
        ).fetchall()
    return [_named(r) for r in rows]
