"""Minimal client for the pred.gg GraphQL API (https://pred.gg/gql).

Public queries (heroes, versions, player by id) work without a token.
Match history and statistics need an OAuth access token from a pred.gg
developer application. Credentials are read from environment variables,
never from files in the repo:

  PREDGG_CLIENT_ID       application client id
  PREDGG_CLIENT_SECRET   application client secret
  PREDGG_REFRESH_TOKEN   optional; used instead of client_credentials if set
  PREDGG_ACCESS_TOKEN    optional; a ready-made token (skips the token call)
"""
from __future__ import annotations

import os
import time

import requests

GQL_URL = "https://pred.gg/gql"
TOKEN_URL = "https://pred.gg/api/oauth2/token"
USER_AGENT = "pred-squad/1.0 (private squad dashboard)"


class PredGGError(RuntimeError):
    pass


class PredGG:
    def __init__(self, min_interval: float = 0.4, session: requests.Session | None = None):
        self.s = session or requests.Session()
        self.s.headers["User-Agent"] = USER_AGENT
        self.min_interval = min_interval
        self._last = 0.0
        self.token: str | None = os.environ.get("PREDGG_ACCESS_TOKEN") or None
        self.token_expires = float("inf") if self.token else 0.0

    # ---------- auth ----------
    @property
    def has_credentials(self) -> bool:
        return bool(self.token or (os.environ.get("PREDGG_CLIENT_ID") and os.environ.get("PREDGG_CLIENT_SECRET")))

    def _refresh_token(self) -> None:
        cid = os.environ.get("PREDGG_CLIENT_ID")
        secret = os.environ.get("PREDGG_CLIENT_SECRET")
        if not (cid and secret):
            return
        refresh = os.environ.get("PREDGG_REFRESH_TOKEN")
        data = {"grant_type": "refresh_token", "refresh_token": refresh} if refresh else {"grant_type": "client_credentials"}
        for attempt in range(4):
            try:
                r = self.s.post(TOKEN_URL, data=data, auth=(cid, secret), timeout=30)
            except requests.RequestException:
                if attempt == 3:
                    raise
                time.sleep(2 ** attempt)
                continue
            if r.status_code in (429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(min(30, 2 ** (attempt + 1)))
                continue
            break
        if r.status_code != 200:
            raise PredGGError(f"token request failed: HTTP {r.status_code} {r.text[:300]}")
        body = r.json()
        self.token = body["access_token"]
        self.token_expires = time.time() + int(body.get("expires_in", 3600)) - 60

    def _auth_header(self) -> dict:
        if self.token is None or time.time() >= self.token_expires:
            self._refresh_token()
        return {"Authorization": f"Bearer {self.token}"} if self.token else {}

    # ---------- queries ----------
    def query(self, q: str, variables: dict | None = None, retries: int = 4) -> dict:
        for attempt in range(retries + 1):
            wait = self.min_interval - (time.time() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.time()
            try:
                r = self.s.post(
                    GQL_URL,
                    json={"query": q, "variables": variables or {}},
                    headers={"Content-Type": "application/json", **self._auth_header()},
                    timeout=60,
                )
            except requests.RequestException as e:
                if attempt == retries:
                    raise PredGGError(f"network error: {e}") from e
                time.sleep(2 ** attempt)
                continue
            if r.status_code in (429, 500, 502, 503, 504) and attempt < retries:
                time.sleep(int(r.headers.get("Retry-After", 2 ** (attempt + 1))))
                continue
            if r.status_code != 200:
                raise PredGGError(f"HTTP {r.status_code}: {r.text[:300]}")
            body = r.json()
            errors = body.get("errors")
            if errors:
                msgs = "; ".join(f"{e.get('message')} at {e.get('path')}" for e in errors)
                if any(e.get("message") == "Forbidden" for e in errors):
                    raise PredGGError(f"Forbidden (needs a pred.gg API token with access): {msgs}")
                raise PredGGError(msgs)
            return body["data"]
        raise PredGGError("unreachable")
