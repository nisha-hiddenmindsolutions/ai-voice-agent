import json
from livekit import api
from ..core.config import settings

class LiveKitService:
    @staticmethod
    def generate_token(
        room_name: str, 
        identity: str, 
        agent_name: str = "voice-forge-agent-v5",
        metadata: dict = None
    ) -> str:
        """Generates a LiveKit AccessToken with room_create and agent dispatch grants."""
        metadata_json = json.dumps(metadata or {})
        
        token = (
            api.AccessToken(settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
            .with_identity(identity)
            .with_grants(api.VideoGrants(
                room_join=True,
                room=room_name,
                can_publish=True,
                can_subscribe=True,
                can_publish_data=True,
                room_create=True,
                room_admin=True
            ))
            .with_room_config(api.RoomConfiguration(
                agents=[api.RoomAgentDispatch(agent_name=agent_name, metadata=metadata_json)]
            ))
        )
        return token.to_jwt()

    @staticmethod
    async def list_rooms():
        """Lists active rooms for health check/monitoring."""
        api_url = settings.LIVEKIT_URL.replace("wss://", "https://").replace("ws://", "http://")
        async with api.LiveKitAPI(api_url, settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET) as lkapi:
            return await lkapi.room.list_rooms(api.ListRoomsRequest())

    @staticmethod
    async def dispatch_agent(room_name: str, agent_name: str, metadata: dict = None):
        """Explicitly dispatches an agent to a specific room."""
        api_url = settings.LIVEKIT_URL.replace("wss://", "https://").replace("ws://", "http://")
        metadata_json = json.dumps(metadata or {})
        
        async with api.LiveKitAPI(api_url, settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET) as lkapi:
            # In livekit-api 0.7.x, the path is lkapi.agent_dispatch.create_dispatch
            return await lkapi.agent_dispatch.create_dispatch(
                api.CreateAgentDispatchRequest(
                    agent_name=agent_name,
                    room=room_name,
                    metadata=metadata_json
                )
            )

livekit_service = LiveKitService()
