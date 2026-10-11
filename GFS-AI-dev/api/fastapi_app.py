from contextlib import asynccontextmanager
import logging
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from api.models import TriggerMessage, StageRequest, PipelineResponse
from dotenv import load_dotenv
load_dotenv()
from api.pipeline_runner import (
    run_new_project, run_stage_1, run_stage_2, run_stage_3,
    run_stage_4, run_stage_5, run_revision, read_from_mongo
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("gfs.api")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("GFS-AI API started.")
    yield
    logger.info("GFS-AI API stopped.")

app = FastAPI(title="GFS-AI Pipeline HTTP Interface", lifespan=lifespan)

@app.get("/")
def root():
    return {"status": "ok"}

@app.get("/health")
@app.post("/health")
def health():
    return {"status": "ok", "version": "1.0.0"}

@app.post("/process-payload")
def process_payload(request: TriggerMessage):
    completed_at_fn = lambda: datetime.now(timezone.utc).isoformat()
    try:
        trigger = request.trigger

        if trigger == "BEGIN_EXTRACTION":
            result = run_new_project(request)

        elif trigger == "STAGE_1_APPROVED_START_2":
            doc = request.unified_doc or read_from_mongo(request.project_id)
            result = run_stage_2(doc)

        elif trigger == "STAGE_2_APPROVED_START_3":
            doc = request.unified_doc or read_from_mongo(request.project_id)
            result = run_stage_3(doc)

        elif trigger == "STAGE_3_APPROVED_START_4":
            doc = request.unified_doc or read_from_mongo(request.project_id)
            result = run_stage_4(doc)

        elif trigger == "STAGE_4_APPROVED_START_5":
            doc = request.unified_doc or read_from_mongo(request.project_id)
            result = run_stage_5(doc)

        elif trigger == "STAGE_5_APPROVED_START_6":
            # Stage 6: build the {cell: value} dict for backend to write into
            # the Master Workbook template.
            from pipeline.stage6_excel import build_excel_output, build_proposal_excel_output
            doc = request.unified_doc or read_from_mongo(request.project_id)
            pricing_cells = build_excel_output(doc)
            proposal_cells = build_proposal_excel_output(doc)
            result = {
                "stage_6": {"status": "READY_FOR_EXCEL", "cells": pricing_cells},
                "stage_6_proposal": {"status": "READY_FOR_EXCEL", "cells": proposal_cells},
            }

        elif trigger == "REVISION":
            result = run_revision(request)

        else:
            raise HTTPException(status_code=400, detail=f"Unsupported trigger: {trigger}")

        from utils.io_utils import round_floats
        result = round_floats(result)

        return PipelineResponse(
            message_id=request.message_id,
            project_id=request.project_id,
            in_response_to=request.message_id,
            trigger=request.trigger,
            status="COMPLETE",
            output=result,
            completed_at=completed_at_fn()
        )

    except FileNotFoundError as e:
        return PipelineResponse(
            message_id=request.message_id,
            project_id=request.project_id,
            in_response_to=request.message_id,
            trigger=request.trigger,
            status="NO_DOCUMENTS",
            error=str(e),
            completed_at=completed_at_fn()
        )

    except Exception as e:
        logger.exception("Error during pipeline execution")
        return PipelineResponse(
            message_id=request.message_id,
            project_id=request.project_id,
            in_response_to=request.message_id,
            trigger=request.trigger,
            status="FAILED",
            error=str(e),
            completed_at=completed_at_fn()
        )

@app.post("/stage/1")
def stage_1(request: StageRequest):
    try:
        res = round_floats(run_stage_1(request.unified_doc))
        return {"project_id": request.project_id, "status": "COMPLETE", "output": res}
    except Exception as e:
        return {"project_id": request.project_id, "status": "FAILED", "error": str(e)}

@app.post("/stage/2")
def stage_2(request: StageRequest):
    try:
        res = round_floats(run_stage_2(request.unified_doc))
        return {"project_id": request.project_id, "status": "COMPLETE", "output": res}
    except Exception as e:
        return {"project_id": request.project_id, "status": "FAILED", "error": str(e)}

@app.post("/stage/3")
def stage_3(request: StageRequest):
    try:
        res = round_floats(run_stage_3(request.unified_doc))
        return {"project_id": request.project_id, "status": "COMPLETE", "output": res}
    except Exception as e:
        return {"project_id": request.project_id, "status": "FAILED", "error": str(e)}

@app.post("/stage/4")
def stage_4(request: StageRequest):
    try:
        res = round_floats(run_stage_4(request.unified_doc))
        return {"project_id": request.project_id, "status": "COMPLETE", "output": res}
    except Exception as e:
        return {"project_id": request.project_id, "status": "FAILED", "error": str(e)}

@app.post("/stage/5")
def stage_5(request: StageRequest):
    try:
        res = round_floats(run_stage_5(request.unified_doc))
        return {"project_id": request.project_id, "status": "COMPLETE", "output": res}
    except Exception as e:
        return {"project_id": request.project_id, "status": "FAILED", "error": str(e)}

@app.post("/stage/6")
def stage_6(request: StageRequest):
    try:
        from pipeline.stage6_excel import build_excel_output, build_proposal_excel_output
        pricing_cells = round_floats(build_excel_output(request.unified_doc))
        proposal_cells = round_floats(build_proposal_excel_output(request.unified_doc))
        return {
            "project_id": request.project_id,
            "status": "COMPLETE",
            "output": {
                "stage_6": {"status": "READY_FOR_EXCEL", "cells": pricing_cells},
                "stage_6_proposal": {"status": "READY_FOR_EXCEL", "cells": proposal_cells},
            },
        }
    except Exception as e:
        return {"project_id": request.project_id, "status": "FAILED", "error": str(e)}

