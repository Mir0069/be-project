import os
from urllib.parse import urlparse, urlunparse


BACKEND_WEBHOOK_PATH = "/api/v1/outlook/ai-result"


def get_app_base_url() -> str:
    configured = (os.getenv("APP_BASE_URL") or "").rstrip("/")
    if configured:
        return configured

    webhook_url = (os.getenv("WEBHOOK_URL") or "").rstrip("/")
    if webhook_url:
        parsed = urlparse(webhook_url)
        path = parsed.path
        marker_index = path.find(BACKEND_WEBHOOK_PATH)
        if marker_index != -1:
            base_path = path[:marker_index].rstrip("/")
            return urlunparse((parsed.scheme, parsed.netloc, base_path, "", "", "")).rstrip("/")
        if parsed.scheme and parsed.netloc:
            return urlunparse((parsed.scheme, parsed.netloc, "", "", "", "")).rstrip("/")

    raise RuntimeError(
        "Backend base URL is not configured. Set APP_BASE_URL or WEBHOOK_URL."
    )


def get_classifier_webhook_url() -> str:
    # WEBHOOK_URL may be a full endpoint or just a base host. Always ensure the
    # result targets the backend's ai-result path — a bare host (or any URL
    # missing the path) would otherwise POST to "/" and 404.
    webhook_url = (os.getenv("WEBHOOK_URL") or "").strip().rstrip("/")
    if webhook_url:
        if BACKEND_WEBHOOK_PATH in urlparse(webhook_url).path:
            return webhook_url
        return f"{webhook_url}{BACKEND_WEBHOOK_PATH}"

    return f"{get_app_base_url()}{BACKEND_WEBHOOK_PATH}"
