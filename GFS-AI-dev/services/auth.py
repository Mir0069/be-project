# services/auth.py
# ---------------------------------------------------------------------
# Handles authentication with the GFS backend.
# Returns a fresh JWT access token for API calls.
# ---------------------------------------------------------------------

import logging
import os

import requests
from services.backend_config import get_app_base_url

logger = logging.getLogger(__name__)

def get_authenticated_session() -> requests.Session:
    """
    Authenticate with the GFS backend and return a session carrying auth cookies.

    Raises:
        RuntimeError: If authentication fails.
    """
    email = os.getenv("GFS_EMAIL", "systemadmin@smartmfg.com")
    password = os.getenv("GFS_PASSWORD", "Smartmfg@2026")

    if not email or not password:
        raise RuntimeError(
            "GFS_EMAIL or GFS_PASSWORD is missing from the .env file."
        )

    session = requests.Session()
    login_url = f"{get_app_base_url()}/api/v1/auth/login"

    payload = {
        "email": email,
        "password": password,
    }

    logger.info("Authenticating with GFS backend...")

    try:
        response = session.post(
            login_url,
            json=payload,
            timeout=15,
        )

    except requests.RequestException as exc:
        raise RuntimeError(f"Authentication request failed: {exc}") from exc

    if response.status_code != 200:
        raise RuntimeError(
            f"Authentication failed ({response.status_code}): {response.text}"
        )

    try:
        data = response.json()
    except ValueError as exc:
        raise RuntimeError(
            "Authentication response was not valid JSON."
        ) from exc

    if not session.cookies.get("accessToken"):
        raise RuntimeError(
            f"Could not find access token cookie in login response: {data}"
        )

    logger.info("Successfully authenticated with GFS backend.")

    return session


def get_access_token() -> str:
    """Authenticate and return the accessToken cookie value."""
    session = get_authenticated_session()
    token = session.cookies.get("accessToken")
    if not token:
        raise RuntimeError("Could not find access token cookie after login.")
    return token
