import os
import requests
import logging
from services.backend_config import get_classifier_webhook_url

logger = logging.getLogger(__name__)

GFS_BEARER_TOKEN = os.getenv("GFS_BEARER_TOKEN")


def send_classifier_result(payload: dict):
    url = get_classifier_webhook_url()

    headers = {
        "Content-Type": "application/json",
    }
    if GFS_BEARER_TOKEN:
        headers["Authorization"] = f"Bearer {GFS_BEARER_TOKEN}"

    logger.info("Sending classifier result to backend...")

    response = requests.post(
        url,
        json=payload,
        headers=headers,
        timeout=30,
    )

    logger.info(
        "Backend responded | status=%d | body=%s",
        response.status_code,
        response.text,
    )

    response.raise_for_status()

    return response
