import asyncio
import io

from fastapi import WebSocket, WebSocketDisconnect
from PIL import Image

from config import logger, MAX_IMAGE_LONG_SIDE, JPEG_QUALITY


def _extract_transcription_chunk(response) -> str:
    """Extract transcription text from a single response, or empty string."""
    sc = response.server_content
    if sc and getattr(sc, "output_transcription", None):
        text = getattr(sc.output_transcription, "text", None)
        if text:
            return text
    return ""


async def _send_ready_signal(websocket: WebSocket) -> None:
    """Send a ready signal to the frontend to request the next frame."""
    print("ln53: sending ready signal to frontend", flush=True)
    try:
        await websocket.send_json({"type": "ready"})
    except Exception as e:
        print(f"ln57: error sending ready signal: {e}", flush=True)


async def _send_task_complete(websocket: WebSocket) -> None:
    """Notify the frontend that the task is complete."""
    print("ln62: sending TASK_COMPLETE to frontend", flush=True)
    try:
        await websocket.send_json({"type": "TASK_COMPLETE"})
    except Exception as e:
        print(f"ln66: error sending TASK_COMPLETE: {e}", flush=True)


async def _send_error(websocket: WebSocket, message: str) -> None:
    """Send an error message to the frontend so it can trigger reconnect logic."""
    print(f"ln_err: sending error to frontend: {message}", flush=True)
    try:
        await websocket.send_json({"type": "error", "message": message})
    except Exception:
        pass


def _resize_image(image_bytes: bytes) -> bytes:
    """Resize image so its long side is at most MAX_IMAGE_LONG_SIDE and re-encode as JPEG."""
    img = Image.open(io.BytesIO(image_bytes))
    w, h = img.size
    long_side = max(w, h)
    if long_side > MAX_IMAGE_LONG_SIDE:
        scale = MAX_IMAGE_LONG_SIDE / long_side
        new_w, new_h = int(w * scale), int(h * scale)
        img = img.resize((new_w, new_h), Image.LANCZOS)
        print(f"ln_resize: resized {w}x{h} → {new_w}x{new_h}", flush=True)
    if img.mode != "RGB":
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    return buf.getvalue()


def _strip_wav_header(wav_bytes: bytes) -> bytes:
    """Return raw PCM bytes by properly walking RIFF/WAVE chunks."""
    if len(wav_bytes) < 12:
        return b""
    if wav_bytes[:4] != b'RIFF' or wav_bytes[8:12] != b'WAVE':
        return wav_bytes  # not RIFF — assume raw PCM already
    offset = 12
    while offset + 8 <= len(wav_bytes):
        chunk_id = wav_bytes[offset:offset + 4]
        chunk_size = int.from_bytes(wav_bytes[offset + 4:offset + 8], 'little')
        if chunk_id == b'data':
            return wav_bytes[offset + 8: offset + 8 + chunk_size]
        offset = offset + 8 + chunk_size + (chunk_size & 1)  # RIFF pads odd chunks
    return b""


def _apply_fade_in(pcm_bytes: bytes, fade_ms: int = 15) -> bytes:
    """Apply a linear fade-in over the first fade_ms milliseconds of 16-bit LE PCM at 24kHz.
    Eliminates the click/pop caused by an abrupt jump from silence to a non-zero sample."""
    fade_samples = (24000 * fade_ms) // 1000  # e.g. 360 samples for 15ms
    n_bytes = len(pcm_bytes)
    if n_bytes < fade_samples * 2:
        fade_samples = n_bytes // 2
    if fade_samples == 0:
        return pcm_bytes
    data = bytearray(pcm_bytes)
    for i in range(fade_samples):
        offset = i * 2
        sample = int.from_bytes(data[offset:offset + 2], 'little', signed=True)
        sample = int(sample * i / fade_samples)
        data[offset:offset + 2] = sample.to_bytes(2, 'little', signed=True)
    return bytes(data)


def _drain_frame_queue(frame_queue: asyncio.Queue) -> None:
    """Remove all stale frames from the queue."""
    drained = 0
    while not frame_queue.empty():
        try:
            frame_queue.get_nowait()
            drained += 1
        except asyncio.QueueEmpty:
            break
    if drained:
        print(f"ln79: drained {drained} stale frame(s) from queue", flush=True)
