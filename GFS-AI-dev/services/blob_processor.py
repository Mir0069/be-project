import logging
import tempfile
import uuid
import requests

from test_api import _run_test_pipeline

logger = logging.getLogger("gfs.pipeline")


class PermanentProcessingError(Exception):
    """Raised for failures that will never succeed on retry."""
    pass


def process_document(
    project_id: str,
    document_id: str,
    blob_url: str,
) -> dict:

    run_id = str(uuid.uuid4())[:8]

    logger.info(
        "Starting processing | project_id=%s | document_id=%s",
        project_id,
        document_id,
    )

    with tempfile.TemporaryDirectory(prefix="gfs_blob_") as temp_folder:

        # Download PDF
        try:
            response = requests.get(blob_url, timeout=120)
        except requests.Timeout:
            raise  # transient — will be abandoned and retried
        except requests.ConnectionError:
            raise  # transient — will be abandoned and retried

        if response.status_code == 404:
            raise PermanentProcessingError(f"Blob not found: {blob_url}")

        if response.status_code == 403:
            raise PermanentProcessingError(f"Blob access denied (SAS token expired?): {blob_url}")

        response.raise_for_status()

        if len(response.content) == 0:
            raise PermanentProcessingError(f"Blob is empty: {blob_url}")

        pdf_path = f"{temp_folder}/downloaded.pdf"
        with open(pdf_path, "wb") as f:
            f.write(response.content)

        # Run pipeline
        result = _run_test_pipeline(
            pdf_path=pdf_path,
            temp_folder=temp_folder,
            run_id=run_id,
        )

        logger.info(
            "Completed processing | project_id=%s | document_id=%s",
            project_id,
            document_id,
        )

        return result