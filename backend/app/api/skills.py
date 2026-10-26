"""/api/skills: AI skill pipeline configuration."""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.modules.code_conversion.skills_engine import DEFAULT_SKILLS, skill_engine
from app.state import state


logger = logging.getLogger("uvicorn.error")

router = APIRouter(tags=["skills"])


@router.get("/api/skills/list")
def list_skills():
    current_skills = state.get("skills")
    if not current_skills:
        return {
            "status": "success",
            "mode": state.get("skillMode", "skills"),
            "skills": [s.dict() for s in DEFAULT_SKILLS]
        }
    return {
        "status": "success",
        "mode": state.get("skillMode", "skills"),
        "skills": current_skills
    }


class SaveSkillsRequest(BaseModel):
    mode: str = "skills"
    skills: List[Dict[str, Any]]
    variables: Optional[Dict[str, Any]] = None


@router.post("/api/skills/save")
def save_skills(req: SaveSkillsRequest):
    state["skillMode"] = req.mode
    state["skills"] = req.skills
    if req.variables:
        state["variables"] = req.variables
    return {
        "status": "success",
        "message": f"Successfully updated {len(req.skills)} AI skills in registry.",
        "mode": req.mode,
        "skills": req.skills
    }


class TestSingleSkillRequest(BaseModel):
    skillId: str
    sampleInput: Optional[str] = None
    parameters: Optional[Dict[str, Any]] = None


@router.post("/api/skills/test-single")
def test_single_skill_route(req: TestSingleSkillRequest):
    res = skill_engine.test_single_skill(req.skillId, req.sampleInput, req.parameters)
    return res
