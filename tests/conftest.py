"""Test set-up. Needs TEST_DATABASE_URL pointing at a throwaway PostgreSQL database:
every run wipes it."""
import os

import psycopg
import pytest

TEST_DB = os.getenv("TEST_DATABASE_URL")
if not TEST_DB:
    pytest.skip("Set TEST_DATABASE_URL to run the API tests.", allow_module_level=True)

os.environ.update({
    "DATABASE_URL": TEST_DB, "DATABASE_URL_UNPOOLED": "", "COOKIE_SECURE": "false",
    "ADMIN_USERNAME": "admin", "ADMIN_PASSWORD": "1234", "DB_POOL_MAX": "1",
})

with psycopg.connect(TEST_DB, autocommit=True) as _conn:
    _conn.execute("DROP SCHEMA public CASCADE")
    _conn.execute("CREATE SCHEMA public")


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture()
def admin(client):
    r = client.post("/api/admin/login", json={"username": "admin", "password": "1234"})
    assert r.status_code == 200, r.text
    return client
