"""
Vision Client Module — Azure OpenAI
=====================================
All Vision API calls in this project go through this file only.
"""

import base64
import io
import json
import mimetypes
import os
import random
import re
import time
from mimetypes import guess_type

from dotenv import load_dotenv
from openai import OpenAI, RateLimitError

# Load .env at module level
load_dotenv()

# Read environment variables at module level
AZURE_OPENAI_API_KEY    = (os.environ.get("AZURE_OPENAI_API_KEY") or os.environ.get("AZURE_OPENAI_KEY", "")).strip()
AZURE_OPENAI_BASE_URL   = (os.environ.get("AZURE_OPENAI_BASE_URL") or os.environ.get("AZURE_OPENAI_ENDPOINT") or "https://expedientai.services.ai.azure.com/api/projects/expedientAIProject/openai/v1").strip()
AZURE_OPENAI_DEPLOYMENT = (os.environ.get("AZURE_OPENAI_DEPLOYMENT") or os.environ.get("AZURE_OPENAI_CHAT_DEPLOYMENT") or "gpt-4o-mini").strip()

# Module-level constants
MAX_IMAGE_PX          = 2048
RATE_LIMIT_WAIT_S     = 5
RATE_LIMIT_MAX_RETRIES = 3    # max attempts on 429 or JSON parse failure
# Per-request network timeout for the Azure OpenAI API. Previously 300s, which
# let a single monster page (e.g. 55k-vector CAD sheet) wedge a vision worker
# for many minutes across retries and hang the whole project at
# vision_queue.join(). 120s fails such pages fast; the pipeline marks the page
# failed, clears its queue slot via task_done, and proceeds with partial
# results (plus the queue watchdog as a backstop). Normal pages complete in
# seconds-to-tens-of-seconds, well within budget. Override via env if needed.
try:
    VISION_API_TIMEOUT_S = float(os.environ.get("VISION_API_TIMEOUT_S", "120"))
except ValueError:
    VISION_API_TIMEOUT_S = 120.0

SYSTEM_INSTRUCTION = (
    "You are a JSON extraction engine specialising in architectural shop drawings. "
    "Output ONLY a single valid JSON object that strictly adheres to the requested JSON keys. "
    "Do NOT invent new keys, do not change uppercase enums to lowercase, and do not nest keys in the wrong parent object. "
    "No markdown code fences, no backticks, no preamble, no trailing commentary. "
    "Begin your response with { and end with }."
)


class CircuitBreaker:
    def __init__(self, failure_threshold: int = 3, cooldown_seconds: int = 30) -> None:
        self.failure_threshold = failure_threshold
        self.cooldown_seconds = cooldown_seconds
        self._failure_count = 0
        self._open_until = 0.0

    def allow_request(self) -> bool:
        if time.monotonic() < self._open_until:
            return False
        return True

    def record_success(self) -> None:
        self._failure_count = 0
        self._open_until = 0.0

    def record_failure(self) -> None:
        self._failure_count += 1
        if self._failure_count >= self.failure_threshold:
            self._open_until = time.monotonic() + self.cooldown_seconds


VISION_CIRCUIT_BREAKER = CircuitBreaker()


def _sleep_with_backoff(attempt: int, base_wait: int = RATE_LIMIT_WAIT_S) -> None:
    delay = min(base_wait * (2 ** attempt), 30)
    jitter = random.uniform(0, min(delay * 0.25, 2.0))
    time.sleep(delay + jitter)


# Internal helpers

def resize_image_bytes(image_bytes: bytes, mime_type: str = "image/png") -> bytes:
    """
    Resizes image bytes if either dimension exceeds MAX_IMAGE_PX.
    Falls back to original bytes if Pillow is not installed.
    """
    try:
        from PIL import Image

        buffer = io.BytesIO(image_bytes)
        with Image.open(buffer) as img:
            # Convert to RGB if needed (e.g. RGBA PNG)
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")

            # Resize if either dimension exceeds MAX_IMAGE_PX
            width, height = img.size
            if width > MAX_IMAGE_PX or height > MAX_IMAGE_PX:
                scale  = MAX_IMAGE_PX / max(width, height)
                new_w  = int(width  * scale)
                new_h  = int(height * scale)
                
                # Determine high-quality resampling filter (LANCZOS)
                resample_filter = None
                if hasattr(Image, "Resampling"):
                    resample_filter = Image.Resampling.LANCZOS
                elif hasattr(Image, "LANCZOS"):
                    resample_filter = Image.LANCZOS
                elif hasattr(Image, "ANTIALIAS"):
                    resample_filter = Image.ANTIALIAS
                else:
                    resample_filter = Image.BICUBIC
                
                img = img.resize((new_w, new_h), resample=resample_filter)

                out_buffer = io.BytesIO()
                fmt = "PNG" if mime_type == "image/png" else "JPEG"
                img.save(out_buffer, format=fmt)
                return out_buffer.getvalue()
    except ImportError:
        pass
    return image_bytes


def _read_image_as_data_url(image_path: str) -> str:
    """
    Reads an image file, resizes it if either dimension exceeds MAX_IMAGE_PX,
    and returns a base64-encoded data URL string.
    """
    mime_type, _ = guess_type(image_path)
    if not mime_type:
        mime_type = "image/jpeg"

    with open(image_path, "rb") as f:
        image_bytes = f.read()

    resized_bytes = resize_image_bytes(image_bytes, mime_type)
    encoded = base64.b64encode(resized_bytes).decode("utf-8")
    return f"data:{mime_type};base64,{encoded}"


def _extract_json_substring(text: str) -> str:
    """
    Extracts the first valid JSON object substring from the given text
    by finding the first '{' and the last '}'.
    """
    first_brace = text.find("{")
    last_brace  = text.rfind("}")

    if first_brace == -1 or last_brace == -1 or last_brace < first_brace:
        return text

    return text[first_brace : last_brace + 1]


def _extract_token_usage(completion) -> dict:
    """
    Extracts token usage information from an OpenAI completion object.
    """
    usage = getattr(completion, "usage", None)
    if not usage:
        return {
            "prompt_tokens":     0,
            "completion_tokens": 0,
            "total_tokens":      0,
            "reasoning_tokens":  0,
        }

    # reasoning_tokens lives inside completion_tokens_details on some models
    reasoning_tokens = 0
    details = getattr(usage, "completion_tokens_details", None)
    if details:
        reasoning_tokens = getattr(details, "reasoning_tokens", 0) or 0

    return {
        "prompt_tokens":     getattr(usage, "prompt_tokens",     0) or 0,
        "completion_tokens": getattr(usage, "completion_tokens", 0) or 0,
        "total_tokens":      getattr(usage, "total_tokens",      0) or 0,
        "reasoning_tokens":  reasoning_tokens,
    }


def _call_api(client: OpenAI, image_data_url: str, prompt: str) -> tuple:
    """
    Makes a single OpenAI chat completion call with a system message and a
    user message containing the image (as a data URL) and the text prompt.
    """
    completion = client.chat.completions.create(
        model=AZURE_OPENAI_DEPLOYMENT,
        messages=[
            {
                "role":    "system",
                "content": SYSTEM_INSTRUCTION,
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url":    image_data_url,
                            "detail": "high",
                        },
                    },
                    {
                        "type": "text",
                        "text": prompt,
                    },
                ],
            },
        ],
        seed=42,
        temperature=0.6,
        top_p=0.9,
    )

    raw_text    = completion.choices[0].message.content or ""
    token_usage = _extract_token_usage(completion)
    return raw_text, token_usage


# Public function

def call_vision(image_path: str, prompt: str) -> dict:
    """
    Sends an image and a prompt to the Azure OpenAI Vision API and returns
    the parsed JSON extraction result. No token limit is imposed.
    """
    if not AZURE_OPENAI_API_KEY:
        return {
            "ok":          False,
            "text":        None,
            "error":       "missing_api_key",
            "token_usage": {},
        }

    try:
        image_data_url = _read_image_as_data_url(image_path)
    except Exception as exc:
        return {
            "ok":          False,
            "text":        None,
            "error":       str(exc),
            "token_usage": {},
        }

    client = OpenAI(
        api_key  = AZURE_OPENAI_API_KEY,
        base_url = AZURE_OPENAI_BASE_URL,
        timeout  = VISION_API_TIMEOUT_S,
        max_retries = 3,
    )

    for attempt in range(2):
        if not VISION_CIRCUIT_BREAKER.allow_request():
            return {
                "ok": False,
                "text": None,
                "error": "circuit_open",
                "token_usage": {},
            }

        try:
            raw_text, token_usage = _call_api(client, image_data_url, prompt)
            VISION_CIRCUIT_BREAKER.record_success()

        except RateLimitError:
            VISION_CIRCUIT_BREAKER.record_failure()
            if attempt == 0:
                _sleep_with_backoff(attempt)
                continue
            else:
                return {
                    "ok":          False,
                    "text":        None,
                    "error":       "rate_limit_exceeded",
                    "token_usage": {},
                }

        except Exception as exc:
            VISION_CIRCUIT_BREAKER.record_failure()
            return {
                "ok":          False,
                "text":        None,
                "error":       str(exc),
                "token_usage": {},
            }

        json_substring = _extract_json_substring(raw_text)
        try:
            parsed_dict = json.loads(json_substring)
            return {
                "ok":          True,
                "text":        raw_text,
                "data":        parsed_dict,
                "error":       None,
                "token_usage": token_usage,
            }
        except (json.JSONDecodeError, ValueError):
            if attempt == 0:
                continue
            else:
                return {
                    "ok":          False,
                    "text":        raw_text,
                    "error":       "parse_failed",
                    "token_usage": token_usage,
                }

    return {
        "ok":          False,
        "text":        None,
        "error":       "unknown_error",
        "token_usage": {},
    }


def call_vision_batch(image_blocks: list, prompt: str, max_completion_tokens: int = 16384, **kwargs) -> dict:
    """
    Send a batch of pre-encoded image_url blocks and a prompt to the Azure
    OpenAI vision model in a single API request.
    """
    if not AZURE_OPENAI_API_KEY:
        return {
            "ok":          False,
            "text":        None,
            "error":       "missing_api_key",
            "token_usage": {},
        }

    client = OpenAI(
        api_key  = AZURE_OPENAI_API_KEY,
        base_url = AZURE_OPENAI_BASE_URL,
        timeout  = VISION_API_TIMEOUT_S,
        max_retries = 3,
    )

    messages = [
        {
            "role":    "system",
            "content": SYSTEM_INSTRUCTION,
        },
        {
            "role": "user",
            "content": [{"type": "text", "text": prompt}] + image_blocks,
        },
    ]

    raw_text    = ""
    token_usage = {}

    for attempt in range(RATE_LIMIT_MAX_RETRIES):
        if not VISION_CIRCUIT_BREAKER.allow_request():
            return {
                "ok": False,
                "text": None,
                "error": "circuit_open",
                "token_usage": {},
            }

        base_wait = RATE_LIMIT_WAIT_S * (2 ** attempt)

        try:
            completion  = client.chat.completions.create(
                model    = AZURE_OPENAI_DEPLOYMENT,
                messages = messages,
                max_completion_tokens = max_completion_tokens,
                response_format = { "type": "json_object" },
                seed = 42,
            )
            raw_text      = completion.choices[0].message.content or ""
            finish_reason = completion.choices[0].finish_reason
            token_usage   = _extract_token_usage(completion)
            VISION_CIRCUIT_BREAKER.record_success()

            if finish_reason == "length":
                print(
                    f"      [WARNING] finish_reason=length — model was truncated. "
                    f"completion_tokens={token_usage.get('completion_tokens','?')}, "
                    f"reasoning_tokens={token_usage.get('reasoning_tokens','?')}. "
                    f"JSON output may be incomplete."
                )
            else:
                print(f"      [finish_reason] {finish_reason}")

        except RateLimitError as exc:
            VISION_CIRCUIT_BREAKER.record_failure()
            retry_after = None
            if hasattr(exc, "response") and exc.response is not None:
                raw_header = exc.response.headers.get("retry-after-ms")
                if raw_header:
                    try:
                        retry_after = int(raw_header) / 1000.0
                    except ValueError:
                        pass
            wait = retry_after if retry_after else base_wait
            if attempt < RATE_LIMIT_MAX_RETRIES - 1:
                _sleep_with_backoff(attempt, base_wait=max(int(wait), 1))
                continue
            return {
                "ok":          False,
                "text":        None,
                "error":       "rate_limit_exceeded",
                "token_usage": {},
            }

        except Exception as exc:
            VISION_CIRCUIT_BREAKER.record_failure()
            return {
                "ok":          False,
                "text":        None,
                "error":       str(exc),
                "token_usage": {},
            }

        json_substring = _extract_json_substring(raw_text)
        try:
            parsed_dict = json.loads(json_substring)
            return {
                "ok":          True,
                "text":        raw_text,
                "data":        parsed_dict,
                "error":       None,
                "token_usage": token_usage,
            }
        except (json.JSONDecodeError, ValueError):
            if attempt < RATE_LIMIT_MAX_RETRIES - 1:
                continue
            return {
                "ok":          False,
                "text":        raw_text,
                "error":       "parse_failed",
                "token_usage": token_usage,
            }

    return {
        "ok":          False,
        "text":        None,
        "error":       "unknown_error",
        "token_usage": {},
    }
