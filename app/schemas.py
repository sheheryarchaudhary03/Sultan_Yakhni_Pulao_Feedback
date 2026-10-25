"""Request validation. Checks that depend on the questions live in catalogue.clean."""
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, field_validator

Status = Literal["new", "reviewed", "actioned", "archived"]
STATUSES = ("new", "reviewed", "actioned", "archived")


class _Model(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


def _blank_to_none(v):
    if isinstance(v, str) and v.strip() == "":
        return None
    return v


class FeedbackIn(_Model):
    language: Literal["en", "ur"] = "en"
    answers: dict[str, StrictInt | StrictStr | list[StrictStr]] = Field(max_length=80)
    comments: str | None = Field(default=None, max_length=1000)
    other_item: str | None = Field(default=None, max_length=80)
    name: str | None = Field(default=None, max_length=80)
    phone: str | None = Field(default=None, max_length=20)
    # Honeypot: hidden from people, bots tend to fill it.
    website: str | None = Field(default=None, max_length=200)

    _blanks = field_validator("comments", "other_item", "name", "phone", "website", mode="before")(_blank_to_none)


class LoginIn(_Model):
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=200)


class PasswordChangeIn(_Model):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=8, max_length=72)

    @field_validator("new_password")
    @classmethod
    def _strength(cls, v):
        if len(v.encode("utf-8")) > 72:
            raise ValueError("Password is too long.")
        if v.isdigit() or v.isalpha():
            raise ValueError("Use a mix of letters and numbers.")
        return v


class ResponseUpdate(_Model):
    status: Status | None = None
    admin_note: str | None = Field(default=None, max_length=2000)


class Filters(_Model):
    date_from: date | None = None
    date_to: date | None = None
    branch: str | None = Field(default=None, max_length=60, pattern=r"^[a-z0-9-]+$")
    service: Literal["dine_in", "takeaway", "delivery"] | None = None
    q: str | None = Field(default=None, max_length=100)
    status: Status | None = None
    attention: bool = False
    offers: bool = False

    _blanks = field_validator("date_from", "date_to", "branch", "service", "q", "status", mode="before")(_blank_to_none)
