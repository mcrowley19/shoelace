import asyncio
from google.genai.types import LiveConnectConfig, AudioTranscriptionConfig

from config import client, BASE_SYSTEM_INSTRUCTION, POOL_SIZE


class GeminiSessionPool:
    """
    Maintains a pool of pre-warmed Gemini Live sessions so that users get an
    instant session instead of waiting 1-3s for the API handshake.
    """

    def __init__(self, size: int):
        self._size = size
        self._queue: asyncio.Queue = asyncio.Queue(maxsize=size)

    async def _make_session(self):
        connect_cm = client.aio.live.connect(
            model="gemini-2.0-flash-live-preview-04-09",
            config=LiveConnectConfig(
                response_modalities=["AUDIO"],
                output_audio_transcription=AudioTranscriptionConfig(),
                system_instruction=BASE_SYSTEM_INSTRUCTION,
            ),
        )
        session = await asyncio.wait_for(connect_cm.__aenter__(), timeout=15)
        return session, connect_cm

    async def _add_one(self):
        try:
            pair = await self._make_session()
            try:
                self._queue.put_nowait(pair)
                print("Pool: session added", flush=True)
            except asyncio.QueueFull:
                _, connect_cm = pair
                try:
                    await connect_cm.__aexit__(None, None, None)
                except Exception:
                    pass
        except Exception as e:
            print(f"Pool: failed to create session: {e}", flush=True)

    async def warmup(self):
        """Fill the pool at server startup."""
        tasks = [asyncio.create_task(self._add_one()) for _ in range(self._size)]
        await asyncio.gather(*tasks, return_exceptions=True)

    async def acquire(self):
        """
        Return a (session, connect_cm) pair immediately from the pool if available,
        otherwise fall back to a fresh connection. Always replenishes in the background.
        """
        try:
            pair = self._queue.get_nowait()
        except asyncio.QueueEmpty:
            pair = await self._make_session()
        asyncio.create_task(self._add_one())  
        return pair

    async def close_pair(self, pair):
        _, connect_cm = pair
        try:
            await connect_cm.__aexit__(None, None, None)
        except Exception:
            pass


session_pool = GeminiSessionPool(POOL_SIZE)
