import asyncio
import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from pool import session_pool
from session import active_sessions, _cancel_existing_session, _handle_session_startup, _run_session


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Warming up Gemini session pool...", flush=True)
    await session_pool.warmup()
    yield


app = FastAPI(lifespan=lifespan)


@app.websocket("/live/{user_id}")
async def live_ws(websocket: WebSocket, user_id: str):
    await websocket.accept()
    print(f"ln320: WebSocket connected for user {user_id}", flush=True)
    await _cancel_existing_session(user_id)

    try:
        task_prompt, captions = await _handle_session_startup(websocket)
        if not task_prompt:
            print(f"ln326: no task prompt received, closing session for user {user_id}", flush=True)
            return
        print(f"ln328: task prompt received, starting session for user {user_id}", flush=True)
        session_task = asyncio.create_task(_run_session(websocket, task_prompt, captions))
        active_sessions[user_id] = session_task

        try:
            await session_task
        except asyncio.CancelledError:
            print(f"ln335: session cancelled for user {user_id}", flush=True)
        except Exception as e:
            print(f"ln337: session error for user {user_id}: {e}", flush=True)
            traceback.print_exc()

    except WebSocketDisconnect:
        print(f"ln341: user {user_id} disconnected during startup", flush=True)
    finally:
        active_sessions.pop(user_id, None)
        print(f"ln344: WebSocket for user {user_id} closed", flush=True)
