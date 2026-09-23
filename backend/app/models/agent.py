from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, Field, AliasChoices
import uuid

class STTConfig(BaseModel):
    provider: str = "sarvam"
    model: str = "saaras:v3"
    language: str = "hi-IN"
    apiKey: Optional[str] = None

class LLMConfig(BaseModel):
    provider: str = "groq"
    model: str = "llama-3.3-70b-versatile"
    temperature: float = 0.7
    apiKey: Optional[str] = None

class TTSConfig(BaseModel):
    provider: str = "sarvam"
    model: str = "bulbul:v3"
    voice: str = "neha"
    pace: float = 1.0
    apiKey: Optional[str] = None

class VADConfig(BaseModel):
    activation_threshold: float = 0.5
    min_speech_duration: float = 0.3
    min_silence_duration: float = 0.8
    padding_duration: float = 0.1

class ToolConfig(BaseModel):
    name: str
    tool_type: str = Field(default="webhook", validation_alias=AliasChoices("tool_type", "type"))
    method: str = "POST"
    url: str
    headers: Dict[str, str] = Field(default_factory=dict)
    apiKey: Optional[str] = None # Support for custom API key
    body_template: Optional[str] = None
    schema_params: Dict[str, Any] = Field(default_factory=dict, alias="schema")

class AgentConfig(BaseModel):
    id: Optional[str] = Field(default_factory=lambda: str(uuid.uuid4()), validation_alias=AliasChoices("id", "agent_id"))
    agentName: str = "New Agent"
    description: str = ""
    status: str = "draft"
    language: str = "hi-IN"
    prompt: str = ""
    stt: STTConfig = Field(default_factory=STTConfig)
    llm: LLMConfig = Field(default_factory=LLMConfig)
    tts: TTSConfig = Field(default_factory=TTSConfig)
    vad: VADConfig = Field(default_factory=VADConfig)
    first_message: str = "Hello! How can I help you today?"
    expressive_mode: bool = False
    termination_keywords: str = ""
    # Allow List of full configs (for GET) or List of IDs (for POST link)
    tools: List[Union[ToolConfig, str]] = Field(default_factory=list)

    class Config:
        populate_by_name = True
