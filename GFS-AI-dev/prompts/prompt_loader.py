# prompts/prompt_loader.py
from pathlib import Path

PROMPTS_DIR = Path(__file__).resolve().parent

def load_prompt(filename: str) -> str:
    """
    Load prompt markdown file and dynamically prepend common instructions if present.
    """
    common_path = PROMPTS_DIR / "0.common_instructions.md"
    target_path = PROMPTS_DIR / filename
    
    if not target_path.exists():
        raise FileNotFoundError(f"Prompt file not found: {target_path}")
        
    target_content = target_path.read_text(encoding="utf-8")
    
    if common_path.exists():
        common_content = common_path.read_text(encoding="utf-8")
        # Prepend the common instructions block to the target prompt
        return f"{common_content}\n\n{target_content}"
        
    return target_content
