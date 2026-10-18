"""Bound actual request bytes, including chunked uploads without a length header."""
import asyncio
from fastapi import HTTPException


async def bounded_body(request, maximum, *, seconds=10):
    body = bytearray()
    try:
        async with asyncio.timeout(seconds):
            async for chunk in request.stream():
                if len(body) + len(chunk) > maximum:
                    raise HTTPException(413, 'Request is too large.')
                body.extend(chunk)
    except TimeoutError:
        raise HTTPException(408, 'Request took too long.') from None
    return bytes(body)
